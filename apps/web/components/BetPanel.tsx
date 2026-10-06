'use client';

import { useState } from 'react';
import { useSession } from '@/app/providers';
import { MarketDto, PositionDto } from '@/lib/types';
import { quote, usdc } from '@/lib/maths';
import { MAX_BET_USDC, MIN_BET_USDC, TIME_BUFFER_SECS } from '@/lib/config';

const PRESETS = [1, 5, 10, 25, 50];

/**
 * The quote shown here is computed with `lib/maths.ts`, the same integer
 * maths the program runs. The slippage floor sent with the bet is 2% under
 * that quote, so a pool that moves between quote and landing fails the bet
 * instead of paying less than the user saw.
 */
export function BetPanel({ market, position, now, onDone }: { market: MarketDto; position: PositionDto | null; now: number; onDone: () => void }) {
  const { client, authenticated, login, wallet } = useSession();
  const [option, setOption] = useState<number>(position?.option ?? 0);
  const [amount, setAmount] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const closed = market.status !== 'OPEN' || now > market.resolveAt - TIME_BUFFER_SECS;
  const lockedOption = position && !position.claimed ? position.option : null;

  const q = quote({
    pools: market.outcomes.map((o) => BigInt(o.pool)),
    sharesTotal: market.outcomes.map((o) => BigInt(o.sharesTotal)),
    feeBps: market.feeBps,
    option,
    amount: usdc.toBase(Math.max(amount, MIN_BET_USDC)),
    now: BigInt(now),
    close: BigInt(market.resolveAt),
  });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const minPayoutBps = Math.floor(q.multiple * 10_000 * 0.98);
      const r = await client.placeBet(market.id, option, amount, minPayoutBps);
      setDone(r.signature);
      onDone();
    } catch (e: any) {
      setError(e.message || 'Bet failed');
    } finally {
      setBusy(false);
    }
  }

  if (closed) return <div className="card text-sm text-ink/70">Betting has closed for this market.</div>;

  return (
    <div className="card space-y-4">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(market.numOptions, 3)}, minmax(0, 1fr))` }}>
        {market.outcomes.map((o) => (
          <button
            key={o.index}
            disabled={lockedOption !== null && lockedOption !== o.index}
            onClick={() => setOption(o.index)}
            className={`rounded-xl border px-3 py-2 text-sm font-medium ${option === o.index ? 'border-ink bg-ink text-white' : 'border-ink/15 bg-white'} disabled:opacity-40`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {lockedOption !== null && <p className="text-xs text-ink/60">One side per wallet per market, the program enforces it. You hold {market.outcomes[lockedOption].label}.</p>}

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button key={p} onClick={() => setAmount(p)} className={`pill border ${amount === p ? 'border-ink bg-ink text-white' : 'border-ink/15 bg-white'}`}>
            ${p}
          </button>
        ))}
        <input
          type="number"
          min={MIN_BET_USDC}
          max={MAX_BET_USDC}
          step={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="input w-28"
        />
      </div>

      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-paper p-3 text-sm">
        <div>
          <dt className="text-xs text-ink/60">Multiplier</dt>
          <dd className="font-mono">{(Number(q.multiplierBps) / 10_000).toFixed(2)}x</dd>
        </div>
        <div>
          <dt className="text-xs text-ink/60">If {market.outcomes[option].label} wins</dt>
          <dd className="font-mono">{usdc.format(q.payout)} USDC</dd>
        </div>
        <div>
          <dt className="text-xs text-ink/60">Return</dt>
          <dd className={`font-mono ${q.profit < 0n ? 'text-rust' : ''}`}>{q.multiple.toFixed(2)}x</dd>
        </div>
      </dl>
      {q.profit < 0n && <p className="text-xs text-rust">This bet pays less than it costs even if it wins. The pool is too one-sided at this multiplier.</p>}

      {!authenticated ? (
        <button className="btn-primary w-full" onClick={login}>
          Sign in to bet
        </button>
      ) : (
        <button className="btn-lime w-full" disabled={busy || !wallet || amount < MIN_BET_USDC || amount > MAX_BET_USDC} onClick={submit}>
          {busy ? 'Signing…' : `Bet $${amount} on ${market.outcomes[option].label}`}
        </button>
      )}
      {error && <p className="text-sm text-rust">{error}</p>}
      {done && <p className="break-all font-mono text-xs text-ink/60">landed: {done}</p>}
      <p className="text-xs text-ink/50">A {market.feeBps / 100}% fee comes off the pot at resolution. Winners split the rest by shares.</p>
    </div>
  );
}
