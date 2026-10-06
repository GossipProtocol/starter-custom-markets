'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/app/providers';
import { PositionWithMarket } from '@/lib/types';
import { usdc } from '@/lib/maths';
import { ClaimButton } from '@/components/ClaimButton';

export default function MePage() {
  const { client, authenticated, login, ready } = useSession();
  const [positions, setPositions] = useState<PositionWithMarket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) return;
    try {
      setPositions(await client.myPositions());
    } catch (e: any) {
      setError(e.message);
    }
  }, [client, authenticated]);

  useEffect(() => {
    load();
  }, [load]);

  if (!ready) return <p className="text-sm text-ink/60">Loading…</p>;
  if (!authenticated)
    return (
      <button className="btn-primary" onClick={login}>
        Sign in to see your positions
      </button>
    );
  if (error) return <p className="text-sm text-rust">{error}</p>;
  if (!positions) return <p className="text-sm text-ink/60">Loading…</p>;
  if (positions.length === 0) return <p className="text-sm text-ink/60">No positions yet.</p>;

  return (
    <div className="space-y-3">
      {positions.map((p) => (
        <div key={p.marketId} className="card flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="min-w-0 flex-1">
            <Link href={`/markets/${p.marketId}`} className="font-semibold hover:underline">
              {p.market.title}
            </Link>
            <div className="text-ink/70">
              {usdc.format(BigInt(p.stake))} USDC on {p.market.outcomes[p.option].label} · {p.market.status.toLowerCase()}
              {p.claimed ? ' · claimed' : ''}
            </div>
          </div>
          {p.claimable && <ClaimButton marketId={p.marketId} kind={p.claimable} amount={p.payout} onDone={load} />}
          {!p.claimable && p.market.status === 'RESOLVED' && !p.claimed && <span className="pill bg-ink/10">lost</span>}
        </div>
      ))}
    </div>
  );
}
