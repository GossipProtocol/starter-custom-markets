/**
 * The audited program's maths, mirrored in bigint so the UI quote, the
 * server's slippage floor and the chain agree to the base unit.
 *
 * Every function here is a transcription of a block in
 * `programs/cue-solana/src/lib.rs`: `time_multiplier_bps`, the share mint
 * in `place_bet`, the fee in `resolve_market`, the payout in `claim_payout`,
 * the late cap in `place_bet` and the slippage quote in `place_bet`. The
 * program's helper is private, so `tests/vectors.json` is computed from the
 * audited formula by hand and `npm test` replays it here. If you change the
 * curve on one side, change it on the other and regenerate the vectors.
 *
 * The product this came from kept three different curves in three files and
 * showed users a payout the chain never paid.
 */

/** 10_000 bps = 1.00x. */
export const MULTIPLIER_SCALE_BPS = 10_000n;
/** Floor at the deadline: 6_000 bps = 0.60x. */
export const MIN_MULTIPLIER_BPS = 6_000n;
export const BPS_DENOMINATOR = 10_000n;
/** Smallest bet, in USDC base units (6 decimals). */
export const MIN_BET = 1_000_000n;
/** In the late window a wallet's cumulative stake is capped at this share of
 *  the pool, floored at `MIN_BET`. */
export const LATE_BET_CAP_BPS = 1_000n;
/** The multiplier window is fixed at 24 hours before the deadline. The
 *  program has no open timestamp: a market shorter than 24 hours opens part
 *  way down the curve. */
export const LATE_BET_WINDOW_SECS = 24n * 60n * 60n;

/**
 * `time_multiplier_bps(now, deadline)` in lib.rs. The window starts at
 * `deadline - 24h`. The first half of the window pays 1.00x; the second half
 * decays linearly to 0.60x at the deadline. Before the window it is 1.00x,
 * at or after the deadline 0.60x.
 */
export function timeMultiplierBps(now: bigint, deadline: bigint): bigint {
  const marketStart = deadline - LATE_BET_WINDOW_SECS;
  if (now <= marketStart) return MULTIPLIER_SCALE_BPS;
  if (now >= deadline) return MIN_MULTIPLIER_BPS;
  const elapsed = now - marketStart;
  const totalDuration = LATE_BET_WINDOW_SECS;
  const halfway = totalDuration / 2n;
  if (elapsed <= halfway) return MULTIPLIER_SCALE_BPS;
  const elapsedInDecay = elapsed - halfway;
  const decayWindow = totalDuration - halfway;
  const decay = (elapsedInDecay * (MULTIPLIER_SCALE_BPS - MIN_MULTIPLIER_BPS)) / decayWindow;
  return MULTIPLIER_SCALE_BPS - decay;
}

/** `shares_minted = amount * multiplier_bps / BPS_DENOMINATOR`, rounded down. */
export function sharesFor(amount: bigint, mBps: bigint): bigint {
  return (amount * mBps) / BPS_DENOMINATOR;
}

/** `fee = total_pool * protocol_fee_bps / BPS_DENOMINATOR`, rounded down. */
export function feeFor(totalPool: bigint, feeBps: bigint): bigint {
  return (totalPool * feeBps) / BPS_DENOMINATOR;
}

/** `payout = distributable * user_shares / total_shares`, rounded down, so
 *  the sum of all payouts never exceeds `distributable`. */
export function payoutFor(distributable: bigint, userShares: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n) throw new Error('no shares');
  return (distributable * userShares) / totalShares;
}

/** `cap = max(total_pool * LATE_BET_CAP_BPS / BPS_DENOMINATOR, MIN_BET)`. */
export function lateCap(totalPool: bigint): bigint {
  const cap = (totalPool * LATE_BET_CAP_BPS) / BPS_DENOMINATOR;
  return cap > MIN_BET ? cap : MIN_BET;
}

/** The slippage block of `place_bet`: what a bet placed now would pay if its
 *  option wins, as (shares, ratio in bps). This is the number the program
 *  compares against `min_payout_bps`. */
export function quotePayoutBps(
  poolsTotal: bigint,
  optionShares: bigint,
  feeBps: bigint,
  amount: bigint,
  mBps: bigint
): { minted: bigint; ratioBps: bigint } {
  const minted = sharesFor(amount, mBps);
  const newTotal = poolsTotal + amount;
  const newShares = optionShares + minted;
  const distributable = newTotal - feeFor(newTotal, feeBps);
  const expected = payoutFor(distributable, minted, newShares);
  return { minted, ratioBps: (expected * BPS_DENOMINATOR) / amount };
}

/** A full quote for the UI: payout, profit and multiple, all derived from
 *  the same integer maths the chain runs. */
export function quote(params: {
  pools: bigint[];
  sharesTotal: bigint[];
  feeBps: number;
  option: number;
  amount: bigint;
  now: bigint;
  close: bigint;
}) {
  const { pools, sharesTotal, feeBps, option, amount, now, close } = params;
  const mBps = timeMultiplierBps(now, close);
  const total = pools.reduce((a, b) => a + b, 0n);
  const { minted, ratioBps } = quotePayoutBps(total, sharesTotal[option] ?? 0n, BigInt(feeBps), amount, mBps);
  const payout = (amount * ratioBps) / BPS_DENOMINATOR;
  return {
    multiplierBps: mBps,
    shares: minted,
    payout,
    profit: payout - amount,
    multiple: Number(ratioBps) / Number(BPS_DENOMINATOR),
  };
}

export const usdc = {
  toBase: (n: number): bigint => BigInt(Math.round(n * 1_000_000)),
  fromBase: (b: bigint): number => Number(b) / 1_000_000,
  format: (b: bigint): string => (Number(b) / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};
