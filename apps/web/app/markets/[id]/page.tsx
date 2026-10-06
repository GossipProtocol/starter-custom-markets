'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from '@/app/providers';
import { useNow } from '@/hooks/useNow';
import { MarketDto, PositionDto } from '@/lib/types';
import { feeFor, payoutFor, usdc } from '@/lib/maths';
import { BetPanel } from '@/components/BetPanel';
import { ClaimButton } from '@/components/ClaimButton';
import { MultiplierBadge } from '@/components/MultiplierBadge';

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const { client, authenticated, mode, demo } = useSession();
  const now = useNow();
  const [market, setMarket] = useState<MarketDto | null>(null);
  const [position, setPosition] = useState<PositionDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await client.getMarket(id);
      setMarket(r.market);
      setPosition(r.position);
    } catch (e: any) {
      setError(e.message);
    }
  }, [client, id, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <p className="text-sm text-rust">{error}</p>;
  if (!market) return <p className="text-sm text-ink/60">Loading…</p>;

  const total = BigInt(market.totalPool);
  let claimable: 'payout' | 'refund' | null = null;
  let payout = 0n;
  if (position && !position.claimed) {
    if (market.status === 'CANCELLED') {
      claimable = 'refund';
      payout = BigInt(position.stake);
    } else if (market.status === 'RESOLVED' && market.winningOption === position.option) {
      const shares = BigInt(market.outcomes[position.option].sharesTotal);
      claimable = 'payout';
      payout = shares > 0n ? payoutFor(total - feeFor(total, BigInt(market.feeBps)), BigInt(position.shares), shares) : 0n;
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold leading-tight">{market.title}</h1>
        {market.description && <p className="mt-2 text-sm text-ink/70">{market.description}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <MultiplierBadge market={market} now={now} />
          <span className="font-mono">{usdc.format(total)} USDC in the pot</span>
        </div>
      </div>

      <div className="card space-y-2">
        {market.outcomes.map((o) => {
          const share = total > 0n ? Number((BigInt(o.pool) * 1000n) / total) / 10 : 0;
          const won = market.status === 'RESOLVED' && market.winningOption === o.index;
          return (
            <div key={o.index} className="flex items-center gap-3 text-sm">
              <span className={`w-28 shrink-0 font-medium ${won ? 'text-ink' : ''}`}>
                {o.label}
                {won ? ' ✓' : ''}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
                <div className={`h-full ${won ? 'bg-lime' : 'bg-ink/50'}`} style={{ width: `${share}%` }} />
              </div>
              <span className="w-32 shrink-0 text-right font-mono text-xs">
                {usdc.format(BigInt(o.pool))} · {share.toFixed(0)}%
              </span>
            </div>
          );
        })}
        <p className="pt-1 text-xs text-ink/50">
          Closes {new Date(market.resolveAt * 1000).toLocaleString()}. Bets stop five minutes before. The side with the most USDC wins; an exact tie refunds everyone.
        </p>
      </div>

      {position && (
        <div className="card flex flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            <div className="text-xs text-ink/60">Your position</div>
            <div className="font-medium">
              {usdc.format(BigInt(position.stake))} USDC on {market.outcomes[position.option].label} · {(Number(position.shares) / 1_000_000).toFixed(2)} shares
            </div>
            {position.claimed && <div className="text-xs text-ink/50">claimed</div>}
          </div>
          {claimable && <ClaimButton marketId={market.id} kind={claimable} amount={payout.toString()} onDone={load} />}
        </div>
      )}

      <BetPanel market={market} position={position} now={now} onDone={load} />

      {mode === 'demo' && market.status === 'OPEN' && (
        <button className="btn-ghost text-xs" onClick={() => { demo!.skip(market.resolveAt - now + 1); load(); }}>
          Demo: jump to the close and settle this market
        </button>
      )}
    </div>
  );
}
