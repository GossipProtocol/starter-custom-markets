# Audit material

The program in `programs/cue-solana/src/lib.rs` is the version of Cue's prediction market program that was submitted for review before deployment, byte for byte apart from the placeholder program id and the three wallet constants that moved to `src/config.rs`. This directory holds every audit document the source repositories contain, redacted.

## What is here

| File | What it is |
|------|------------|
| `core-flows-audit-2026-02.md` | The Consumer Layer team's internal audit of the five core flows (sign up, market creation, betting, fee claiming, winnings claiming) over the live product, February 2026. Seventeen findings by severity, with locations and recommendations. |
| `transaction-fee-audit-2026-02.md` | The Consumer Layer team's internal audit of transaction fee handling after failure rates climbed, February 2026. Fee payer per flow, balance thresholds, dead sponsorship code, failed transaction scenarios and recommendations. |

Every wallet address, program id, email and client-identifying detail in both is replaced by `[redacted]`. Public Solana RPC hostnames are kept.

## What is not here

No external auditor's report is in the source repositories. The commit that produced the program in this starter is titled "Add admin_withdraw_stuck_funds instruction for ghost bet recovery" and ends "For auditor review before deployment", so the source is the submission, and the program's own guards (the five minute buffer, the late cap, the slippage floor, the tie rule, the fee cooldown, checks-effects-interactions on every transfer) are the state it was submitted in. If a report exists outside the repositories, add it here with the same redaction and reference it from the README's lessons section.

## How the findings map to this starter

The two audits cover the product's permissionless program variant (`cue_permissionless`), which added creator fees and a `close_position` instruction, and the app around it. The program here is the admin-created variant. The instruction names and the maths are the same, so each finding reads across:

| Finding | Where it lives in this starter |
|---------|--------------------------------|
| Inconsistent minimum bet (0.10 USDC in the client, 1 USDC in the program) | `MIN_BET` in `lib.rs` is the floor; `apps/web/lib/maths.ts` mirrors it and `apps/web/lib/config.ts` bounds the product limit above it. |
| Three multiplier curves across the codebase | One curve in `lib.rs` (`time_multiplier_bps`), one transcription in `apps/web/lib/maths.ts`, pinned by `tests/vectors.json`. |
| No automatic bet sync reconciliation, ghost bets | `apps/web/lib/server/reconcile.ts` and `app/api/cron/reconcile`. Rows are written from accounts, never from requests. |
| Fee percentages hardcoded in the contract | `create_market` takes `fee_bps`; the app passes `COURSE_FEE_BPS` from `apps/web/lib/course-fee.ts`. |
| Dead sponsorship code and a fee payer that did not exist | `SPONSOR_SECRET_KEY` is optional and pays only the transaction fee; the audited `place_bet` has `payer = user` for the position rent. |
| No `lastValidBlockHeight` on transactions, inconsistent signing methods | `apps/web/lib/server/tx.ts` builds every transaction with a blockhash and height, stores the message, and verifies the signed copy. |
| Wallet address taken from the request body | `apps/web/lib/server/privy.ts`: the caller is the verified Privy token, the wallet is the one Privy holds. |
| Unclaimed funds never expire; `admin_withdraw_stuck_funds` can move any amount from a settled vault | Unchanged in the audited program. Listed as a hardening exercise in the README. |
| No dispute mechanism; single-sided markets resolve on chain | Unchanged in the audited program. The capstone covers a resolution rule of your own. |
