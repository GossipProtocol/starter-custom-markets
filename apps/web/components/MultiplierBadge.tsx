'use client';

import { MarketDto } from '@/lib/types';
import { timeMultiplierBps } from '@/lib/maths';
import { TIME_BUFFER_SECS } from '@/lib/config';

export function multiplierNow(market: MarketDto, now: number): number {
  return Number(timeMultiplierBps(BigInt(now), BigInt(market.resolveAt))) / 10_000;
}

export function countdown(seconds: number): string {
  if (seconds <= 0) return 'closed';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** The share multiplier a bet placed right now would get, and the countdown
 *  to the betting cutoff (TIME_BUFFER before the close). */
export function MultiplierBadge({ market, now }: { market: MarketDto; now: number }) {
  if (market.status !== 'OPEN') return <span className="pill bg-ink/10">{market.status.toLowerCase()}</span>;
  const cutoff = market.resolveAt - TIME_BUFFER_SECS;
  const m = multiplierNow(market, now);
  const tone = m >= 1 ? 'bg-lime' : m >= 0.8 ? 'bg-amber-200' : 'bg-rust/20';
  return (
    <span className="flex items-center gap-2">
      <span className={`pill ${tone}`}>{m.toFixed(2)}x shares</span>
      <span className="text-xs text-ink/60">bets close in {countdown(cutoff - now)}</span>
    </span>
  );
}
