import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { prisma } from '@/lib/server/db';
import { route } from '@/lib/server/handler';
import { HttpError, requireCaller } from '@/lib/server/privy';
import { assertChainConfig, isAdmin } from '@/lib/server/env';
import { buildIntent } from '@/lib/server/tx';
import { emergencyCancelIx } from '@/lib/chain/instructions';

export const dynamic = 'force-dynamic';

/** Admin only. Builds the emergency cancel; confirm it through
 *  `/api/markets/confirm`. Every position becomes refundable. */
export const POST = route(async (request: NextRequest, { params }) => {
  const caller = await requireCaller(request);
  const config = await assertChainConfig();
  if (!isAdmin(config, caller.wallet)) throw new HttpError(403, 'Only a program admin wallet can cancel markets');
  const market = await prisma.market.findUnique({ where: { id: params.id } });
  if (!market || market.status !== 'OPEN') throw new HttpError(409, 'Only open markets can be cancelled');

  const admin = new PublicKey(caller.wallet);
  const intent = await buildIntent({
    kind: 'CANCEL',
    userId: caller.userId,
    marketId: market.id,
    user: admin,
    instructions: [emergencyCancelIx(admin, new PublicKey(market.pda))],
    payload: { marketId: market.id },
  });
  return NextResponse.json({ intent });
});
