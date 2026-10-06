import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { prisma } from '@/lib/server/db';
import { route } from '@/lib/server/handler';
import { HttpError, requireCaller } from '@/lib/server/privy';
import { assertLive } from '@/lib/server/env';
import { buildIntent } from '@/lib/server/tx';
import { connection } from '@/lib/server/rpc';
import { freshMarket } from '@/lib/server/reconcile';
import { marketDto, positionValue } from '@/lib/server/dto';
import { claimIx } from '@/lib/chain/instructions';
import { positionPda } from '@/lib/chain/pdas';
import { decodePosition } from '@/lib/chain/layout';

export const dynamic = 'force-dynamic';

const Body = z.object({ marketId: z.string() });

/**
 * Step 1 of a claim. The kind (payout or refund) and the amount come from the
 * chain: the market account decides which instruction applies, the position
 * account decides whether anything is owed. The audited program has no
 * close instruction, so the position account stays open after the claim
 * with `claimed = true`; its rent is the user's and stays locked.
 */
export const POST = route(async (request: NextRequest) => {
  assertLive();
  const caller = await requireCaller(request);
  const body = Body.parse(await request.json());

  const row = await prisma.market.findUnique({ where: { id: body.marketId } });
  if (!row) throw new HttpError(404, 'Market not found');
  const fresh = await freshMarket(row, 0);
  const market = marketDto(await prisma.market.findUniqueOrThrow({ where: { id: fresh.id }, include: { outcomes: true } }));
  if (market.status !== 'RESOLVED' && market.status !== 'CANCELLED') throw new HttpError(409, 'Market has not settled yet');

  const user = new PublicKey(caller.wallet);
  const marketKey = new PublicKey(market.pda);
  const info = await connection().getAccountInfo(positionPda(marketKey, user));
  if (!info) throw new HttpError(404, 'No position on this market');
  const chain = decodePosition(info.data as Buffer);
  if (chain.claimed) throw new HttpError(409, 'Already claimed');

  const value = positionValue(market, {
    marketId: market.id,
    wallet: caller.wallet,
    option: chain.option,
    stake: chain.stakeAmount.toString(),
    shares: chain.shares.toString(),
    claimed: false,
    closed: false,
    betTx: null,
    claimTx: null,
  });
  if (!value.claimable) throw new HttpError(409, 'This position did not win');

  const intent = await buildIntent({
    kind: 'CLAIM',
    userId: caller.userId,
    marketId: market.id,
    user,
    instructions: [claimIx(value.claimable, user, marketKey)],
    payload: { marketId: market.id, kind: value.claimable, amount: value.payout.toString() },
  });
  return NextResponse.json({ intent, kind: value.claimable, amount: value.payout.toString() });
});
