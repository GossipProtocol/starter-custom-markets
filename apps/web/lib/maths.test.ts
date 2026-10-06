/**
 * Replays `tests/vectors.json`, computed by hand from the audited formulas
 * in `programs/cue-solana/src/lib.rs`. Run with `npm test`. A failure here
 * means this mirror has drifted from the program; fix the mirror, never the
 * vectors, unless the program itself changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { feeFor, lateCap, payoutFor, quotePayoutBps, sharesFor, timeMultiplierBps } from './maths';

type Vectors = {
  multiplier: [number, number, number][];
  shares: [string, number, string][];
  fee: [string, number, string][];
  payout: [string, string, string, string][];
  late_cap: [string, string][];
  quote: [string, string, number, string, number, string, string][];
};

const vectors: Vectors = JSON.parse(readFileSync(join(__dirname, '../../../tests/vectors.json'), 'utf8'));

test('time multiplier matches the program', () => {
  for (const [now, deadline, expected] of vectors.multiplier) {
    assert.equal(timeMultiplierBps(BigInt(now), BigInt(deadline)), BigInt(expected), `now=${now}`);
  }
});

test('the curve is monotone and bounded across the whole window', () => {
  const deadline = 1_000_000n;
  let last = 10_000n;
  for (let now = deadline - 86_400n - 5n; now <= deadline + 5n; now += 7n) {
    const m = timeMultiplierBps(now, deadline);
    assert.ok(m <= last, `multiplier rose at ${now}`);
    assert.ok(m >= 6_000n && m <= 10_000n);
    last = m;
  }
});

test('shares match the program', () => {
  for (const [amount, m, expected] of vectors.shares) {
    assert.equal(sharesFor(BigInt(amount), BigInt(m)), BigInt(expected));
  }
});

test('fee matches the program', () => {
  for (const [total, bps, expected] of vectors.fee) {
    assert.equal(feeFor(BigInt(total), BigInt(bps)), BigInt(expected));
  }
});

test('payout matches the program', () => {
  for (const [d, u, t, expected] of vectors.payout) {
    assert.equal(payoutFor(BigInt(d), BigInt(u), BigInt(t)), BigInt(expected));
  }
});

test('late cap matches the program', () => {
  for (const [total, expected] of vectors.late_cap) {
    assert.equal(lateCap(BigInt(total)), BigInt(expected));
  }
});

test('quote matches the program slippage check', () => {
  for (const [p, s, f, a, m, minted, ratio] of vectors.quote) {
    const q = quotePayoutBps(BigInt(p), BigInt(s), BigInt(f), BigInt(a), BigInt(m));
    assert.equal(q.minted, BigInt(minted));
    assert.equal(q.ratioBps, BigInt(ratio));
  }
});
