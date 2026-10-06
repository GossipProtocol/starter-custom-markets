import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/server/db';
import { route } from '@/lib/server/handler';
import { assertLive } from '@/lib/server/env';
import { HttpError, requireCaller } from '@/lib/server/privy';
import { freshMarket } from '@/lib/server/reconcile';
import { marketDto, positionDto } from '@/lib/server/dto';

export const dynamic = 'force-dynamic';

/** Market detail, refreshed from the chain when the row is stale. With a
 *  bearer token, the caller's position comes along. */
export const GET = route(async (request: NextRequest, { params }) => {
  assertLive();
  const row = await prisma.market.findUnique({ where: { id: params.id } });
  if (!row) throw new HttpError(404, 'Market not found');
  const fresh = await freshMarket(row);
  const market = await prisma.market.findUniqueOrThrow({ where: { id: fresh.id }, include: { outcomes: true } });

  let position = null;
  if (request.headers.get('authorization')) {
    // A stale or invalid token must not hide the market, only the position.
    const caller = await requireCaller(request).catch(() => null);
    if (caller) {
      const p = await prisma.position.findUnique({ where: { marketId_wallet: { marketId: market.id, wallet: caller.wallet } } });
      position = p ? positionDto(p) : null;
    }
  }
  return NextResponse.json({ market: marketDto(market), position });
});
