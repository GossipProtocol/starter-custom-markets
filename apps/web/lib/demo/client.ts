/**
 * Demo mode: the whole market loop in the browser, no env, no chain.
 *
 * It runs the same bigint maths as the program (`lib/maths.ts`), so what you
 * see in demo mode is what the chain pays in live mode. State lives in
 * localStorage. The demo clock can be skipped forward so a market closes
 * without waiting a day.
 */
import { MarketDto, MarketsClient, PositionDto, PositionWithMarket } from '@/lib/types';
import { feeFor, lateCap, payoutFor, quote, usdc } from '@/lib/maths';
import { COURSE_FEE_BPS } from '@/lib/course-fee';
import { LATE_BET_CAP_WINDOW_SECS, TIME_BUFFER_SECS } from '@/lib/config';

const KEY = 'starter-custom-markets:demo:v1';
const DEMO_WALLET = 'DEMOwa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

type State = {
  usdc: string;
  clockOffset: number;
  markets: MarketDto[];
  positions: PositionDto[];
};

const seedMarkets = (now: number): MarketDto[] => {
  const mk = (id: string, title: string, description: string, labels: string[], openAgo: number, closesIn: number, pools: number[]): MarketDto => {
    const outcomes = labels.map((label, index) => {
      const pool = usdc.toBase(pools[index] ?? 0);
      return { index, label, pool: pool.toString(), sharesTotal: pool.toString() };
    });
    return {
      id,
      title,
      description,
      pda: `demo-${id}`,
      status: 'OPEN',
      numOptions: labels.length,
      openAt: now - openAgo,
      resolveAt: now + closesIn,
      resolvedAt: null,
      feeBps: COURSE_FEE_BPS,
      winningOption: null,
      outcomes,
      totalPool: outcomes.reduce((a, o) => a + BigInt(o.pool), 0n).toString(),
    };
  };
  return [
    mk('m1', 'Does the new drop sell out in under an hour?', 'Resolves on the brand\'s own stock page. Sold out means every size.', ['Yes', 'No'], 3600, 20 * 3600, [420, 310]),
    mk('m2', 'Which track leads the chart on Friday?', 'The top of the weekly chart at publication.', ['Track A', 'Track B', 'Track C'], 6 * 3600, 2 * 3600, [120, 95, 40]),
    mk('m3', 'Will the sequel get a release date this month?', 'An official date on the studio\'s channels, not a leak.', ['Yes', 'No'], 20 * 3600, 3600, [900, 1240]),
  ];
};

function load(): State {
  if (typeof window === 'undefined') return { usdc: '0', clockOffset: 0, markets: [], positions: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fresh: State = { usdc: usdc.toBase(250).toString(), clockOffset: 0, markets: seedMarkets(Math.floor(Date.now() / 1000)), positions: [] };
  save(fresh);
  return fresh;
}

function save(s: State) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

export class DemoClient implements MarketsClient {
  readonly mode = 'demo' as const;
  readonly wallet = DEMO_WALLET;

  now(): number {
    return Math.floor(Date.now() / 1000) + load().clockOffset;
  }

  balance(): bigint {
    return BigInt(load().usdc);
  }

  reset() {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  /** Move the demo clock forward so markets close and the multiplier moves. */
  skip(seconds: number) {
    const s = load();
    s.clockOffset += seconds;
    save(s);
  }

  /** Settle every market past its close, the way `resolve_market` does. */
  private settle(s: State) {
    const now = this.now();
    for (const m of s.markets) {
      if (m.status !== 'OPEN' || now < m.resolveAt) continue;
      const pools = m.outcomes.map((o) => BigInt(o.pool));
      const total = pools.reduce((a, b) => a + b, 0n);
      let winner = 0;
      let max = 0n;
      let tie = false;
      pools.forEach((p, i) => {
        if (p > max) {
          max = p;
          winner = i;
          tie = false;
        } else if (p === max && max > 0n) tie = true;
      });
      m.resolvedAt = now;
      if (total < 1_000_000n || tie) {
        m.status = 'CANCELLED';
      } else {
        m.status = 'RESOLVED';
        m.winningOption = winner;
      }
    }
  }

  async listMarkets() {
    const s = load();
    this.settle(s);
    save(s);
    return s.markets;
  }

  async getMarket(id: string) {
    const s = load();
    this.settle(s);
    save(s);
    const market = s.markets.find((m) => m.id === id);
    if (!market) throw new Error('Market not found');
    return { market, position: s.positions.find((p) => p.marketId === id) ?? null };
  }

  async placeBet(marketId: string, option: number, amountUsdc: number, minPayoutBps: number | null) {
    const s = load();
    this.settle(s);
    const m = s.markets.find((x) => x.id === marketId);
    if (!m || m.status !== 'OPEN') throw new Error('Market is not open');
    const now = this.now();
    if (now > m.resolveAt - TIME_BUFFER_SECS) throw new Error('Betting has closed for this market');
    const amount = usdc.toBase(amountUsdc);
    if (amount < 1_000_000n) throw new Error('Minimum bet is 1 USDC');
    if (BigInt(s.usdc) < amount) throw new Error('Not enough demo USDC');
    const existing = s.positions.find((p) => p.marketId === marketId);
    if (existing && existing.option !== option) throw new Error('You already hold the other side of this market');
    // The late cap in place_bet: in the final 15 minutes a wallet's cumulative
    // stake is capped at max(10% of the pool, 1 USDC).
    if (now >= m.resolveAt - LATE_BET_CAP_WINDOW_SECS) {
      const cap = lateCap(BigInt(m.totalPool));
      if (BigInt(existing?.stake ?? '0') + amount > cap) throw new Error(`Late bets are capped at ${usdc.format(cap)} USDC in the final 15 minutes`);
    }

    const q = quote({
      pools: m.outcomes.map((o) => BigInt(o.pool)),
      sharesTotal: m.outcomes.map((o) => BigInt(o.sharesTotal)),
      feeBps: m.feeBps,
      option,
      amount,
      now: BigInt(now),
      close: BigInt(m.resolveAt),
    });
    if (minPayoutBps !== null && Math.floor(q.multiple * 10_000) < minPayoutBps) throw new Error('Quote moved below your minimum');

    m.outcomes[option].pool = (BigInt(m.outcomes[option].pool) + amount).toString();
    m.outcomes[option].sharesTotal = (BigInt(m.outcomes[option].sharesTotal) + q.shares).toString();
    m.totalPool = m.outcomes.reduce((a, o) => a + BigInt(o.pool), 0n).toString();
    s.usdc = (BigInt(s.usdc) - amount).toString();
    if (existing) {
      existing.stake = (BigInt(existing.stake) + amount).toString();
      existing.shares = (BigInt(existing.shares) + q.shares).toString();
    } else {
      s.positions.unshift({ marketId, wallet: DEMO_WALLET, option, stake: amount.toString(), shares: q.shares.toString(), claimed: false, closed: false, betTx: `demo-${Date.now()}`, claimTx: null });
    }
    save(s);
    return { signature: `demo-bet-${Date.now()}` };
  }

  async claim(marketId: string) {
    const s = load();
    this.settle(s);
    const m = s.markets.find((x) => x.id === marketId);
    const p = s.positions.find((x) => x.marketId === marketId);
    if (!m || !p) throw new Error('No position');
    if (p.claimed) throw new Error('Already claimed');
    let amount = 0n;
    if (m.status === 'CANCELLED') amount = BigInt(p.stake);
    else if (m.status === 'RESOLVED' && m.winningOption === p.option) {
      const total = BigInt(m.totalPool);
      amount = payoutFor(total - feeFor(total, BigInt(m.feeBps)), BigInt(p.shares), BigInt(m.outcomes[p.option].sharesTotal));
    } else throw new Error('Nothing to claim');
    p.claimed = true;
    p.closed = true;
    p.claimTx = `demo-claim-${Date.now()}`;
    s.usdc = (BigInt(s.usdc) + amount).toString();
    save(s);
    return { signature: p.claimTx, amount: amount.toString() };
  }

  async myPositions(): Promise<PositionWithMarket[]> {
    const s = load();
    this.settle(s);
    save(s);
    return s.positions.map((p) => {
      const market = s.markets.find((m) => m.id === p.marketId)!;
      let claimable: 'payout' | 'refund' | null = null;
      let payout = 0n;
      if (!p.claimed && market.status === 'CANCELLED') {
        claimable = 'refund';
        payout = BigInt(p.stake);
      } else if (!p.claimed && market.status === 'RESOLVED' && market.winningOption === p.option) {
        claimable = 'payout';
        const total = BigInt(market.totalPool);
        payout = payoutFor(total - feeFor(total, BigInt(market.feeBps)), BigInt(p.shares), BigInt(market.outcomes[p.option].sharesTotal));
      }
      return { ...p, market, claimable, payout: payout.toString() };
    });
  }

  async createMarket(input: { title: string; description: string; options: string[]; resolveAt: number }) {
    const s = load();
    const id = `m${Date.now()}`;
    const outcomes = input.options.map((label, index) => ({ index, label, pool: '0', sharesTotal: '0' }));
    s.markets.unshift({
      id,
      title: input.title,
      description: input.description,
      pda: `demo-${id}`,
      status: 'OPEN',
      numOptions: outcomes.length,
      openAt: this.now(),
      resolveAt: input.resolveAt,
      resolvedAt: null,
      feeBps: COURSE_FEE_BPS,
      winningOption: null,
      outcomes,
      totalPool: '0',
    });
    save(s);
    return { id };
  }
}
