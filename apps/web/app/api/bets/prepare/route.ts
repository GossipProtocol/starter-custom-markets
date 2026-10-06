import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import { z } from 'zod';
import { prisma } from '@/lib/server/db';
import { route } from '@/lib/server/handler';
import { HttpError, requireCaller } from '@/lib/server/privy';
import { assertLive } from '@/lib/server/env';
import { buildIntent } from '@/lib/server/tx';
import { connection } from '@/lib/server/rpc';
import { freshMarket } from '@/lib/server/reconcile';
import { marketDto } from '@/lib/server/dto';
import { placeBetIx } from '@/lib/chain/instructions';
import { usdcAta } from '@/lib/chain/pdas';
import { quote, usdc } from '@/lib/maths';
import { MAX_BET_USDC, MIN_BET_USDC, TIME_BUFFER_SECS } from '@/lib/config';

export const dynamic = 'force-dynamic';

const Body = z.object({
  marketId: z.string(),
  option: z.number().int().min(0),
  amountUsdc: z.number().min(MIN_BET_USDC).max(MAX_BET_USDC),
  /** Reject if the quoted payout ratio drops below this. Omit to accept any. */
  minPayoutBps: z.number().int().min(0).max(1_000_000).nullable().default(null),
});

/**
 * Step 1 of a bet. The caller is the verified Privy user; the wallet is the
 * one Privy says they hold. The amount is bounded here and floored by the
 * program. The server quotes with the same maths the chain runs, and the
 * quote is returned so the client can show the number it is about to sign.
 * The user pays the position rent, as the audited `place_bet` requires; a
 * sponsor, when configured, pays only the transaction fee.
 */
export const POST = route(async (request: NextRequest) => {
  assertLive();
  const caller = await requireCaller(request);
  const body = Body.parse(await request.json());

  const row = await prisma.market.findUnique({ where: { id: body.marketId } });
  if (!row) throw new HttpError(404, 'Market not found');
  const market = marketDto(await prisma.market.findUniqueOrThrow({ where: { id: (await freshMarket(row)).id }, include: { outcomes: true } }));
  if (market.status !== 'OPEN') throw new HttpError(409, 'Market is not open');
  if (body.option >= market.numOptions) throw new HttpError(400, 'No such option');
  const now = Math.floor(Date.now() / 1000);
  if (now > market.resolveAt - TIME_BUFFER_SECS) throw new HttpError(409, 'Betting has closed for this market');

  const user = new PublicKey(caller.wallet);
  const amount = usdc.toBase(body.amountUsdc);
  let balance = 0n;
  try {
    balance = (await getAccount(connection(), usdcAta(user))).amount;
  } catch {
    balance = 0n;
  }
  if (balance < amount) throw new HttpError(402, `Not enough USDC: you hold ${usdc.format(balance)} and need ${usdc.format(amount)}`);

  const q = quote({
    pools: market.outcomes.map((o) => BigInt(o.pool)),
    sharesTotal: market.outcomes.map((o) => BigInt(o.sharesTotal)),
    feeBps: market.feeBps,
    option: body.option,
    amount,
    now: BigInt(now),
    close: BigInt(market.resolveAt),
  });

  const intent = await buildIntent({
    kind: 'BET',
    userId: caller.userId,
    marketId: market.id,
    user,
    instructions: [
      placeBetIx({
        user,
        market: new PublicKey(market.pda),
        option: body.option,
        amount,
        minPayoutBps: body.minPayoutBps,
      }),
    ],
    payload: { marketId: market.id, option: body.option, amount: amount.toString() },
  });

  return NextResponse.json({
    intent,
    quote: {
      multiplierBps: q.multiplierBps.toString(),
      shares: q.shares.toString(),
      payout: q.payout.toString(),
      profit: q.profit.toString(),
      multiple: q.multiple,
    },
  });
});
