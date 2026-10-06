import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { prisma } from '@/lib/server/db';
import { route } from '@/lib/server/handler';
import { HttpError, requireCaller } from '@/lib/server/privy';
import { assertLive } from '@/lib/server/env';
import { settleIntent } from '@/lib/server/tx';
import { syncMarket, syncPosition } from '@/lib/server/reconcile';

export const dynamic = 'force-dynamic';

const Body = z.object({ intentId: z.string(), signedTransaction: z.string() });

/** Step 2 of a claim. The position account is re-read after the transaction
 *  lands; the row's `claimed` comes from the account, not the request. */
export const POST = route(async (request: NextRequest) => {
  assertLive();
  const caller = await requireCaller(request);
  const body = Body.parse(await request.json());
  const settled = await settleIntent(body.intentId, body.signedTransaction, caller.userId, new PublicKey(caller.wallet));
  if (settled.kind !== 'CLAIM') throw new HttpError(400, 'Wrong intent kind');

  const row = await prisma.market.findUniqueOrThrow({ where: { id: settled.payload.marketId } });
  const fresh = (await syncMarket(row)) ?? row;
  await prisma.position.updateMany({
    where: { marketId: fresh.id, wallet: caller.wallet },
    data: { claimTx: settled.signature },
  });
  await syncPosition(fresh, caller.wallet, caller.userId, { claimTx: settled.signature });
  return NextResponse.json({ signature: settled.signature, amount: settled.payload.amount, kind: settled.payload.kind });
});
