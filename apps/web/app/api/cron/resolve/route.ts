import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { prisma } from '@/lib/server/db';
import { requireCron } from '@/lib/server/cron-auth';
import { assertChainConfig } from '@/lib/server/env';
import { route } from '@/lib/server/handler';
import { HttpError } from '@/lib/server/privy';
import { adminKeypair, resolverKeypair } from '@/lib/server/rpc';
import { sendWithKeypair } from '@/lib/server/tx';
import { syncMarket, syncAllPositions } from '@/lib/server/reconcile';
import { resolveMarketIx, withdrawFeesIx } from '@/lib/chain/instructions';
import { usdcMint } from '@/lib/chain/pdas';
import { FEE_WITHDRAWAL_COOLDOWN_SECS } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Every five minutes: call the permissionless `resolve_market` on markets
 * past their close, then `withdraw_fees` on resolved markets past the 24
 * hour cooldown. Resolution needs no special key, so the resolver only pays
 * transaction fees. Withdrawal is admin-only in the audited program, so it
 * runs only when `ADMIN_SECRET_KEY` is set, and pays into the course fee
 * wallet's USDC account, which the program accepts only if that wallet is
 * its `PROTOCOL_TREASURY`.
 */
export const GET = route(async (request: NextRequest) => {
  const denied = requireCron(request);
  if (denied) return denied;
  const config = await assertChainConfig();
  const resolver = resolverKeypair();
  if (!resolver) throw new HttpError(503, 'RESOLVER_SECRET_KEY is not set');

  const now = new Date();
  const report = { resolved: [] as string[], feesWithdrawn: [] as string[], skipped: null as string | null, errors: [] as string[] };

  const due = await prisma.market.findMany({ where: { status: 'OPEN', resolveAt: { lte: now } }, take: 20 });
  for (const market of due) {
    try {
      const sig = await sendWithKeypair([resolveMarketIx(new PublicKey(market.pda))], resolver);
      await prisma.market.update({ where: { id: market.id }, data: { resolveTx: sig } });
      const fresh = await syncMarket(market);
      if (fresh) await syncAllPositions(fresh);
      report.resolved.push(market.id);
    } catch (e: any) {
      report.errors.push(`${market.id}: ${e.message}`);
    }
  }

  const admin = adminKeypair();
  if (!admin) {
    report.skipped = 'ADMIN_SECRET_KEY is not set; fees stay in the vaults until an admin withdraws';
    return NextResponse.json(report);
  }
  if (!config.admins.includes(admin.publicKey.toBase58())) {
    report.skipped = 'ADMIN_SECRET_KEY is not in MARKET_ADMIN_WALLETS; refusing to attempt withdrawals';
    return NextResponse.json(report);
  }

  const cooled = new Date(now.getTime() - FEE_WITHDRAWAL_COOLDOWN_SECS * 1000);
  const withFees = await prisma.market.findMany({
    where: { status: 'RESOLVED', feesWithdrawn: false, resolvedAt: { lte: cooled } },
    take: 20,
  });
  const treasury = new PublicKey(config.treasuryAta);
  const feeRecipient = new PublicKey(config.feeRecipient);
  for (const market of withFees) {
    try {
      await sendWithKeypair(
        [
          // Idempotent: a no-op once the course wallet's USDC account exists.
          createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, treasury, feeRecipient, usdcMint()),
          withdrawFeesIx(admin.publicKey, new PublicKey(market.pda), treasury),
        ],
        admin
      );
      await syncMarket(market);
      report.feesWithdrawn.push(market.id);
    } catch (e: any) {
      report.errors.push(`${market.id}: ${e.message}`);
    }
  }

  return NextResponse.json(report);
});
