import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { prisma } from '@/lib/server/db';
import { route } from '@/lib/server/handler';
import { HttpError, requireCaller } from '@/lib/server/privy';
import { assertLive } from '@/lib/server/env';
import { settleIntent } from '@/lib/server/tx';
import { syncMarket, syncPosition } from '@/lib/server/reconcile';
import { marketDto, positionDto } from '@/lib/server/dto';

export const dynamic = 'force-dynamic';

const Body = z.object({ intentId: z.string(), signedTransaction: z.string() });

/** Step 2 of a bet. After the transaction confirms, the position row is
 *  written from the account on chain, not from the request. */
export const POST = route(async (request: NextRequest) => {
  assertLive();
  const caller = await requireCaller(request);
  const body = Body.parse(await request.json());
  const settled = await settleIntent(body.intentId, body.signedTransaction, caller.userId, new PublicKey(caller.wallet));
  if (settled.kind !== 'BET') throw new HttpError(400, 'Wrong intent kind');

  const row = await prisma.market.findUniqueOrThrow({ where: { id: settled.payload.marketId } });
  const fresh = (await syncMarket(row)) ?? row;
  const position = await syncPosition(fresh, caller.wallet, caller.userId, { betTx: settled.signature });
  const market = await prisma.market.findUniqueOrThrow({ where: { id: fresh.id }, include: { outcomes: true } });
  return NextResponse.json({ signature: settled.signature, market: marketDto(market), position: position ? positionDto(position) : null });
});
