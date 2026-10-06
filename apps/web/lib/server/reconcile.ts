/**
 * The chain is the source of truth. The database is a cache the reconcile
 * cron rebuilds from program accounts.
 *
 * The product this came from had three sync routes with three decoders and
 * a "ghost bet" cleanup page, because the database was written by the
 * client after a bet and the chain was consulted only when something looked
 * wrong. Here the order is the other way round: a bet row is written only
 * after the position account has been read back, and the cron re-reads every
 * live market and every open position on a schedule.
 */
import { Market, MarketStatus, Prisma } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import { decodeMarket, decodePosition, POSITION_ACCOUNT_SIZE, POSITION_MARKET_OFFSET } from '@/lib/chain/layout';
import { positionPda, programId } from '@/lib/chain/pdas';
import { prisma } from './db';
import { connection } from './rpc';

const chainStatus: Record<'open' | 'resolved' | 'cancelled', MarketStatus> = {
  open: 'OPEN',
  resolved: 'RESOLVED',
  cancelled: 'CANCELLED',
};

/** Re-read one market account and write what it says. Returns the fresh row
 *  or null when the account does not exist yet. */
export async function syncMarket(market: Market): Promise<Market | null> {
  const info = await connection().getAccountInfo(new PublicKey(market.pda));
  if (!info) return null;
  const chain = decodeMarket(info.data as Buffer);

  const [row] = await prisma.$transaction([
    prisma.market.update({
      where: { id: market.id },
      data: {
        status: chainStatus[chain.status],
        numOptions: chain.numOptions,
        resolveAt: new Date(Number(chain.resolveTimestamp) * 1000),
        resolvedAt: chain.resolvedTimestamp > 0n ? new Date(Number(chain.resolvedTimestamp) * 1000) : null,
        feeBps: chain.protocolFeeBps,
        winningOption: chain.winningOption,
        feesWithdrawn: chain.feesWithdrawn,
        lastSyncedAt: new Date(),
      },
    }),
    ...chain.pools.map((pool, index) =>
      prisma.outcome.update({
        where: { marketId_index: { marketId: market.id, index } },
        data: { pool: new Prisma.Decimal(pool.toString()), sharesTotal: new Prisma.Decimal(chain.sharesTotal[index].toString()) },
      })
    ),
  ]);
  return row;
}

/** Read one wallet's position on a market straight from the chain and
 *  upsert it. Used right after a bet or a claim lands. */
export async function syncPosition(market: Market, wallet: string, userId?: string, tx?: { betTx?: string; claimTx?: string }) {
  const pda = positionPda(new PublicKey(market.pda), new PublicKey(wallet));
  const info = await connection().getAccountInfo(pda);
  if (!info) {
    // Never existed (the audited program never closes a position). Nothing is owed.
    await prisma.position.updateMany({ where: { pda: pda.toBase58() }, data: { claimed: true, closed: true, syncedAt: new Date() } });
    return null;
  }
  const chain = decodePosition(info.data as Buffer);
  return prisma.position.upsert({
    where: { pda: pda.toBase58() },
    update: {
      option: chain.option,
      stake: new Prisma.Decimal(chain.stakeAmount.toString()),
      shares: new Prisma.Decimal(chain.shares.toString()),
      claimed: chain.claimed,
      closed: false,
      syncedAt: new Date(),
      ...(userId ? { userId } : {}),
      ...(tx?.betTx ? { betTx: tx.betTx } : {}),
      ...(tx?.claimTx ? { claimTx: tx.claimTx } : {}),
    },
    create: {
      marketId: market.id,
      userId: userId ?? null,
      wallet,
      pda: pda.toBase58(),
      option: chain.option,
      stake: new Prisma.Decimal(chain.stakeAmount.toString()),
      shares: new Prisma.Decimal(chain.shares.toString()),
      claimed: chain.claimed,
      betTx: tx?.betTx ?? null,
      claimTx: tx?.claimTx ?? null,
    },
  });
}

/** Every position account on a market, including bets placed from outside
 *  the app. Rows the chain no longer has are marked closed. */
export async function syncAllPositions(market: Market): Promise<{ seen: number; closed: number }> {
  const accounts = await connection().getProgramAccounts(programId(), {
    filters: [{ dataSize: POSITION_ACCOUNT_SIZE }, { memcmp: { offset: POSITION_MARKET_OFFSET, bytes: market.pda } }],
  });
  const seen = new Set<string>();
  for (const { pubkey, account } of accounts) {
    const chain = decodePosition(account.data as Buffer);
    seen.add(pubkey.toBase58());
    const user = await prisma.user.findUnique({ where: { walletAddress: chain.user }, select: { id: true } });
    await prisma.position.upsert({
      where: { pda: pubkey.toBase58() },
      update: {
        option: chain.option,
        stake: new Prisma.Decimal(chain.stakeAmount.toString()),
        shares: new Prisma.Decimal(chain.shares.toString()),
        claimed: chain.claimed,
        closed: false,
        syncedAt: new Date(),
        ...(user ? { userId: user.id } : {}),
      },
      create: {
        marketId: market.id,
        userId: user?.id ?? null,
        wallet: chain.user,
        pda: pubkey.toBase58(),
        option: chain.option,
        stake: new Prisma.Decimal(chain.stakeAmount.toString()),
        shares: new Prisma.Decimal(chain.shares.toString()),
        claimed: chain.claimed,
      },
    });
  }
  const gone = await prisma.position.findMany({ where: { marketId: market.id, closed: false }, select: { id: true, pda: true } });
  const toClose = gone.filter((p) => !seen.has(p.pda)).map((p) => p.id);
  if (toClose.length) {
    await prisma.position.updateMany({ where: { id: { in: toClose } }, data: { claimed: true, closed: true, syncedAt: new Date() } });
  }
  return { seen: seen.size, closed: toClose.length };
}

/** The cron body. Markets that are open, or resolved with positions still
 *  unclaimed, get re-read. Pending markets are promoted once their account
 *  appears. */
export async function reconcileAll(limit = 50) {
  const markets = await prisma.market.findMany({
    where: {
      OR: [
        { status: 'PENDING' },
        { status: 'OPEN' },
        { status: { in: ['RESOLVED', 'CANCELLED'] }, positions: { some: { closed: false } } },
      ],
    },
    orderBy: { lastSyncedAt: 'asc' },
    take: limit,
  });
  const report = { markets: 0, positions: 0, closed: 0, missing: 0 };
  for (const market of markets) {
    const fresh = await syncMarket(market);
    if (!fresh) {
      report.missing++;
      continue;
    }
    report.markets++;
    const r = await syncAllPositions(fresh);
    report.positions += r.seen;
    report.closed += r.closed;
  }
  return report;
}

/** If the row is older than `maxAgeMs`, refresh it from the chain. Detail
 *  pages call this so a user never sees a pool the chain has moved past. */
export async function freshMarket(market: Market, maxAgeMs = 10_000): Promise<Market> {
  if (market.status === 'PENDING') return (await syncMarket(market)) ?? market;
  if (market.lastSyncedAt && Date.now() - market.lastSyncedAt.getTime() < maxAgeMs) return market;
  return (await syncMarket(market)) ?? market;
}
