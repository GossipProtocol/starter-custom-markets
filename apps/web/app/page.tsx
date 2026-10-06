'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/app/providers';
import { useNow } from '@/hooks/useNow';
import { MarketDto } from '@/lib/types';
import { MarketCard } from '@/components/MarketCard';

export default function MarketsPage() {
  const { client, mode } = useSession();
  const now = useNow();
  const [markets, setMarkets] = useState<MarketDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMarkets(await client.listMarkets());
    } catch (e: any) {
      setError(e.message);
    }
  }, [client]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const open = markets?.filter((m) => m.status === 'OPEN') ?? [];
  const settled = markets?.filter((m) => m.status !== 'OPEN') ?? [];

  return (
    <div className="space-y-6">
      {mode === 'demo' && (
        <div className="rounded-xl bg-lime/40 p-3 text-sm">
          Demo mode. Everything runs in your browser with the program&apos;s maths. Use +6h in the header to move the clock and watch the multiplier fall, then settle and claim.
        </div>
      )}
      {error && <p className="text-sm text-rust">{error}</p>}
      {markets === null && <p className="text-sm text-ink/60">Loading markets…</p>}
      {markets && open.length === 0 && <p className="text-sm text-ink/60">No open markets. Create one from the Admin page.</p>}
      <section className="space-y-3">
        {open.map((m) => (
          <MarketCard key={m.id} market={m} now={now} />
        ))}
      </section>
      {settled.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Settled</h2>
          {settled.map((m) => (
            <MarketCard key={m.id} market={m} now={now} />
          ))}
        </section>
      )}
    </div>
  );
}
