import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { prisma } from '@/lib/server/db';
import { route } from '@/lib/server/handler';
import { HttpError, requireCaller } from '@/lib/server/privy';
import { assertLive } from '@/lib/server/env';
import { settleIntent } from '@/lib/server/tx';
import { syncMarket } from '@/lib/server/reconcile';
import { marketDto } from '@/lib/server/dto';

export const dynamic = 'force-dynamic';

const Body = z.object({ intentId: z.string(), signedTransaction: z.string() });

/** Step 2 of create (and of admin cancel). Submits the signed transaction,
 *  then reads the market account back. The row reflects the chain, not the
 *  request. */
export const POST = route(async (request: NextRequest) => {
  assertLive();
  const caller = await requireCaller(request);
  const body = Body.parse(await request.json());
  const settled = await settleIntent(body.intentId, body.signedTransaction, caller.userId, new PublicKey(caller.wallet));
  if (settled.kind !== 'CREATE' && settled.kind !== 'CANCEL') throw new HttpError(400, 'Wrong intent kind');

  const row = await prisma.market.findUnique({ where: { id: settled.payload.marketId } });
  if (!row) throw new HttpError(404, 'Market not found');
  const fresh = await syncMarket(row);
  if (!fresh) throw new HttpError(409, 'Transaction confirmed but the market account is not readable yet; retry');
  if (settled.kind === 'CREATE') await prisma.market.update({ where: { id: row.id }, data: { createTx: settled.signature } });

  const withOutcomes = await prisma.market.findUniqueOrThrow({ where: { id: row.id }, include: { outcomes: true } });
  return NextResponse.json({ signature: settled.signature, market: marketDto(withOutcomes) });
});
