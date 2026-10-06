'use client';

import { useState } from 'react';
import { useSession } from '@/app/providers';
import { usdc } from '@/lib/maths';

export function ClaimButton({ marketId, kind, amount, onDone }: { marketId: string; kind: 'payout' | 'refund'; amount: string; onDone: () => void }) {
  const { client } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      await client.claim(marketId);
      onDone();
    } catch (e: any) {
      setError(e.message || 'Claim failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button className="btn-lime" disabled={busy} onClick={claim}>
        {busy ? 'Signing…' : `Claim ${kind === 'refund' ? 'refund' : 'payout'} · ${usdc.format(BigInt(amount))} USDC`}
      </button>
      {error && <p className="text-xs text-rust">{error}</p>}
    </div>
  );
}
