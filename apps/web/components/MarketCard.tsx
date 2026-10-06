'use client';

import Link from 'next/link';
import { MarketDto } from '@/lib/types';
import { usdc } from '@/lib/maths';
import { MultiplierBadge } from './MultiplierBadge';

export function MarketCard({ market, now }: { market: MarketDto; now: number }) {
  const total = BigInt(market.totalPool);
  return (
    <Link href={`/markets/${market.id}`} className="card block hover:border-ink/30">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold leading-snug">{market.title}</h2>
        <span className="shrink-0 font-mono text-sm">{usdc.format(total)} USDC</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {market.outcomes.map((o) => {
          const share = total > 0n ? Number((BigInt(o.pool) * 1000n) / total) / 10 : 100 / market.numOptions;
          const won = market.status === 'RESOLVED' && market.winningOption === o.index;
          return (
            <span key={o.index} className={`pill ${won ? 'bg-lime' : 'bg-ink/5'}`}>
              {o.label} · {share.toFixed(0)}%
            </span>
          );
        })}
      </div>
      <MultiplierBadge market={market} now={now} />
    </Link>
  );
}
