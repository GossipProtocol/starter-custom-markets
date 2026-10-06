import { Market, Outcome, Position } from '@prisma/client';
import { feeFor, payoutFor } from '@/lib/maths';
import { MarketDto, PositionDto, PositionWithMarket } from '@/lib/types';

export function marketDto(m: Market & { outcomes: Outcome[] }): MarketDto {
  const outcomes = [...m.outcomes]
    .sort((a, b) => a.index - b.index)
    .map((o) => ({ index: o.index, label: o.label, pool: o.pool.toFixed(0), sharesTotal: o.sharesTotal.toFixed(0) }));
  const totalPool = outcomes.reduce((a, o) => a + BigInt(o.pool), 0n);
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    pda: m.pda,
    status: m.status,
    numOptions: m.numOptions,
    openAt: Math.floor(m.openAt.getTime() / 1000),
    resolveAt: Math.floor(m.resolveAt.getTime() / 1000),
    resolvedAt: m.resolvedAt ? Math.floor(m.resolvedAt.getTime() / 1000) : null,
    feeBps: m.feeBps,
    winningOption: m.winningOption,
    outcomes,
    totalPool: totalPool.toString(),
  };
}

export function positionDto(p: Position): PositionDto {
  return {
    marketId: p.marketId,
    wallet: p.wallet,
    option: p.option,
    stake: p.stake.toFixed(0),
    shares: p.shares.toFixed(0),
    claimed: p.claimed,
    closed: p.closed,
    betTx: p.betTx,
    claimTx: p.claimTx,
  };
}

/** What a position is worth now, from the same maths the program runs. */
export function positionValue(market: MarketDto, position: PositionDto): { claimable: 'payout' | 'refund' | null; payout: bigint } {
  if (position.claimed) return { claimable: null, payout: 0n };
  if (market.status === 'CANCELLED') return { claimable: 'refund', payout: BigInt(position.stake) };
  if (market.status === 'RESOLVED' && market.winningOption === position.option) {
    const total = BigInt(market.totalPool);
    const distributable = total - feeFor(total, BigInt(market.feeBps));
    const totalShares = BigInt(market.outcomes[position.option].sharesTotal);
    return { claimable: 'payout', payout: totalShares > 0n ? payoutFor(distributable, BigInt(position.shares), totalShares) : 0n };
  }
  return { claimable: null, payout: 0n };
}

export function positionWithMarket(p: Position, m: Market & { outcomes: Outcome[] }): PositionWithMarket {
  const market = marketDto(m);
  const position = positionDto(p);
  const v = positionValue(market, position);
  return { ...position, market, claimable: v.claimable, payout: v.payout.toString() };
}
