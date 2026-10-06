'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/app/providers';
import { MAX_OPTIONS } from '@/lib/config';

/**
 * Creating a market is an admin action on chain: the signer must be one of
 * the program's `ADMIN_WALLETS`. In demo mode anyone can. In live mode the
 * server checks the caller's wallet against `MARKET_ADMIN_WALLETS` before
 * it builds the transaction, and the program checks its own list when the
 * transaction lands.
 */
export default function AdminPage() {
  const { client, mode, authenticated, login } = useSession();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState(['Yes', 'No']);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const resolveAt = Math.floor(Date.now() / 1000) + hours * 3600;
      const { id } = await client.createMarket({ title, description, options: options.map((o) => o.trim()).filter(Boolean), resolveAt });
      router.push(`/markets/${id}`);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'live' && !authenticated)
    return (
      <button className="btn-primary" onClick={login}>
        Sign in with the admin wallet
      </button>
    );

  return (
    <div className="card max-w-xl space-y-4">
      <h1 className="text-lg font-semibold">New market</h1>
      <input className="input" placeholder="Question" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input" rows={3} placeholder="How it resolves" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="space-y-2">
        {options.map((o, i) => (
          <div key={i} className="flex gap-2">
            <input className="input" value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
            {options.length > 2 && (
              <button className="btn-ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                remove
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <button className="btn-ghost" onClick={() => setOptions([...options, ''])}>
            add option
          </button>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        Closes in
        <input className="input w-24" type="number" min={1} max={24 * 30} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        hours
      </label>
      <button className="btn-lime" disabled={busy || title.trim().length < 3 || options.filter((o) => o.trim()).length < 2} onClick={submit}>
        {busy ? 'Creating…' : 'Create market'}
      </button>
      {error && <p className="text-sm text-rust">{error}</p>}
      <p className="text-xs text-ink/50">
        {mode === 'live'
          ? 'The signer must be the program admin. Resolution is permissionless and the cron calls it after the close.'
          : 'Demo mode: the market settles itself when the clock passes its close.'}
      </p>
    </div>
  );
}
