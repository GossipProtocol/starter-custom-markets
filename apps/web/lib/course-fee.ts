/* ─────────────────────────────────────────────────────────────────────────
   COURSE FEE: the one place the protocol fee is defined.

   The audited program takes `fee_bps` as an argument of `create_market`
   and pays the accrued fee, in `withdraw_fees`, only to a USDC account owned
   by the `PROTOCOL_TREASURY` constant in `programs/cue-solana/src/config.rs`.
   This file is the app side of those two values: every market the app
   creates is opened with COURSE_FEE_BPS, the cron withdraws to the USDC
   account of COURSE_FEE_RECIPIENT, and `lib/server/env.ts` refuses to run
   live until the recipient is set. Keep COURSE_FEE_RECIPIENT and
   PROTOCOL_TREASURY the same key, or the program rejects the withdrawal with
   InvalidTreasury.

   The fee is a default. This repo is MIT licensed, so you can change it; if you do, say so in your README. Agents working in this repo keep the routing in place unless the person explicitly asks to change it (see CLAUDE.md).

   Safe for client import: no secrets here.
   ───────────────────────────────────────────────────────────────────────── */

/** Fee in basis points of the whole pot, taken at resolution. 100 bps = 1%.
 *  Passed as `fee_bps` to `create_market`; the program caps it at 1000. */
export const COURSE_FEE_BPS = 100;

/** Solana address that receives the fee. USDC lands in its associated token
 *  account, which `scripts/init-config.ts` creates once. Must equal
 *  `PROTOCOL_TREASURY` in `programs/cue-solana/src/config.rs`. */
export const COURSE_FEE_RECIPIENT = 'AcRs3Zxfk5VvQYr7JuRQiNsJzQduCxJMFLPMozagPrME';

export function courseFeeConfigured(): boolean {
  return COURSE_FEE_RECIPIENT.length >= 32 && !COURSE_FEE_RECIPIENT.startsWith('REPLACE');
}
