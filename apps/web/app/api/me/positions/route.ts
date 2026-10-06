import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/server/db';
import { route } from '@/lib/server/handler';
import { assertLive } from '@/lib/server/env';
import { requireCaller } from '@/lib/server/privy';
import { positionWithMarket } from '@/lib/server/dto';

export const dynamic = 'force-dynamic';

/** The caller's positions, newest first, each with its market and what it
 *  is worth right now. */
export const GET = route(async (request: NextRequest) => {
  assertLive();
  const caller = await requireCaller(request);
  const rows = await prisma.position.findMany({
    where: { wallet: caller.wallet },
    include: { market: { include: { outcomes: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return NextResponse.json({ positions: rows.map((p) => positionWithMarket(p, p.market)) });
});
