import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { prisma } from '@/lib/server/db';
import { route } from '@/lib/server/handler';
import { HttpError, requireCaller } from '@/lib/server/privy';
import { assertChainConfig, assertLive, isAdmin } from '@/lib/server/env';
import { buildIntent } from '@/lib/server/tx';
import { marketDto } from '@/lib/server/dto';
import { createMarketIx } from '@/lib/chain/instructions';
import { marketPda, newMarketIdHex } from '@/lib/chain/pdas';
import { MAX_OPTIONS, TIME_BUFFER_SECS } from '@/lib/config';
import { COURSE_FEE_BPS } from '@/lib/course-fee';

export const dynamic = 'force-dynamic';

/** Public list. Pending rows (create tx not yet seen on chain) stay hidden. */
export const GET = route(async () => {
  assertLive();
  const rows = await prisma.market.findMany({
    where: { status: { not: 'PENDING' } },
    include: { outcomes: true },
    orderBy: [{ status: 'asc' }, { resolveAt: 'asc' }],
    take: 100,
  });
  return NextResponse.json({ markets: rows.map(marketDto) });
});

const CreateBody = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(2000).default(''),
  options: z.array(z.string().trim().min(1).max(40)).min(2).max(MAX_OPTIONS),
  resolveAt: z.number().int(),
});

/**
 * Step 1 of creating a market. Admin only: the caller's wallet must be one
 * of the program's `ADMIN_WALLETS` (mirrored in `MARKET_ADMIN_WALLETS`), and
 * the program checks the same list when the transaction lands. The market
 * is opened with the course fee. The row is written as PENDING and becomes
 * OPEN only when `/api/markets/confirm` has seen the account.
 */
export const POST = route(async (request: NextRequest) => {
  const caller = await requireCaller(request);
  const config = await assertChainConfig();
  if (!isAdmin(config, caller.wallet)) throw new HttpError(403, 'Only a program admin wallet can create markets');

  const body = CreateBody.parse(await request.json());
  const now = Math.floor(Date.now() / 1000);
  if (body.resolveAt <= now + 2 * TIME_BUFFER_SECS) throw new HttpError(400, 'Close must be at least ten minutes away');

  const marketIdHex = newMarketIdHex();
  const pda = marketPda(marketIdHex).toBase58();
  const market = await prisma.market.create({
    data: {
      title: body.title,
      description: body.description,
      marketIdHex,
      pda,
      status: 'PENDING',
      numOptions: body.options.length,
      openAt: new Date(now * 1000),
      resolveAt: new Date(body.resolveAt * 1000),
      feeBps: config.feeBps,
      outcomes: { create: body.options.map((label, index) => ({ index, label })) },
    },
  });

  const intent = await buildIntent({
    kind: 'CREATE',
    userId: caller.userId,
    marketId: market.id,
    user: new PublicKey(caller.wallet),
    instructions: [
      createMarketIx({
        authority: new PublicKey(caller.wallet),
        marketIdHex,
        numOptions: body.options.length,
        resolveTimestamp: BigInt(body.resolveAt),
        feeBps: COURSE_FEE_BPS,
      }),
    ],
    payload: { marketId: market.id },
    computeUnits: 250_000,
  });
  return NextResponse.json({ marketId: market.id, intent });
});
