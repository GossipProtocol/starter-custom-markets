# starter-custom-markets

Parimutuel markets with a time multiplier, settled in USDC on Solana, running on the program Cue submitted for audit. A market asks a question with two to seven options and a close. Bettors stake USDC on one option; the earlier they stake, the more shares each dollar buys, from 1.00x down to 0.60x at the close. After the close anyone can resolve the market, the option with the most USDC wins, a 1% fee comes off the pot, and the winners split the rest by shares. This is the Module 5 starter from the course, built from the product that ran these markets on mainnet with real money.

The program is the point of the module. `programs/cue-solana/src/lib.rs` is Cue's program as it was submitted for review, byte for byte, with two edits: the program id is Anchor's placeholder, and the three wallet constants moved into `src/config.rs` so a deployer edits one file outside the audited logic. The app around it was rebuilt to the course's rules (server-built transactions, chain as source of truth, one maths file per side), but it drives the audited program and nothing else. The audit material that exists is in `docs/audit/`, redacted, with a note on what is and is not there.

It runs in two modes:

- **Demo mode** (no env at all): a mock wallet with 250 demo USDC, seeded markets in localStorage, bets and claims simulated in the browser with the program's exact maths, and a clock you can skip forward to watch the multiplier fall and markets settle. Everything is clickable in under a minute.
- **Live mode**: Privy login with an embedded Solana wallet, the program on devnet, a Postgres cache rebuilt from the chain by a cron, server-built transactions that the browser or the Expo app only signs, and permissionless resolution driven by a second cron.

## The fee, stated plainly

Every resolved market pays **1% of the whole pot** to the course wallet. The program takes `fee_bps` as an argument of `create_market` and the app opens every market with `COURSE_FEE_BPS` from `apps/web/lib/course-fee.ts`. `resolve_market` accrues the fee, and `withdraw_fees`, which only an admin may call after a 24 hour cooldown, moves it to a USDC account owned by `PROTOCOL_TREASURY` in `programs/cue-solana/src/config.rs` and to nowhere else; the program rejects any other owner with `InvalidTreasury`. The course wallet is the value of both constants. The server refuses to run live while the recipient in `course-fee.ts` is unset, and refuses a fee above the program's 10% cap. Winners are paid from the other 99%, exactly as the quote shows them before they sign.

The fee is a default, not a license condition. This code is MIT licensed, so you can change it, but the fee is how the course pays for itself and the rate is small enough that most forks leave it. If you change the recipient or the rate, say so in your README.

## What is in the box

| Area | Where | What it teaches |
|------|-------|-----------------|
| The audited program | `programs/cue-solana/src/lib.rs` | `create_market`, `place_bet` with its guards (five minute buffer, late cap, slippage floor, one option per wallet), permissionless `resolve_market` with the tie rule, `claim_payout`, `claim_refund`, `emergency_cancel`, `withdraw_fees` with the cooldown, `admin_withdraw_stuck_funds`. Checks-effects-interactions on every transfer. |
| The deployer's file | `programs/cue-solana/src/config.rs` | The treasury and the two hot wallets, as placeholders, and the `ADMIN_WALLETS` list the program reads. The one file a deployer edits. |
| The maths | `lib.rs` (`time_multiplier_bps`, the blocks in `place_bet` and `claim_payout`), `apps/web/lib/maths.ts` | One curve and one payout formula, in Rust and in bigint TypeScript, pinned by `tests/vectors.json`. |
| Account layouts | `programs/cue-solana/tests/fixtures.rs`, `apps/web/lib/chain/layout.ts`, `tests/fixtures/accounts.json` | `cargo test` serialises `Market` and `UserPosition` from the real structs; the app decodes them with a cursor reader. No pasted offsets, no pasted discriminators. |
| Instruction builders | `apps/web/lib/chain/instructions.ts` | Account order and argument encoding for every instruction, without an IDL in the app. |
| Program tests | `tests/cue-solana.ts` | Creation and its guards, betting and its guards, the late cap, cancel and refund, the withdrawal guards. The full resolve and claim path runs behind `LONG_TESTS=1`, because the audited program has no test clock. |
| Server-built transactions | `apps/web/lib/server/tx.ts`, `app/api/bets`, `app/api/claims`, `app/api/markets` | Prepare, sign, confirm. The server stores the message it built and refuses any signed copy whose bytes differ. |
| Who is calling | `apps/web/lib/server/privy.ts` | The caller is whoever the verified Privy token says, and their wallet is the one Privy holds for them. No route reads a wallet from the body. |
| Chain as source of truth | `apps/web/lib/server/reconcile.ts`, `app/api/cron/reconcile` | Every market and position row is rebuilt from program accounts. The database is a cache with titles attached. |
| Resolution and fees | `app/api/cron/resolve` | A keypair with no special power calls the permissionless `resolve_market` on schedule; an admin keypair, when configured, calls `withdraw_fees` after the cooldown. |
| Demo machine | `apps/web/lib/demo/client.ts` | The same `MarketsClient` interface as live mode, backed by localStorage and the shared maths, including the late cap. |
| Mobile | `apps/mobile/` | An Expo app that signs the same server-built transactions with the Privy embedded wallet. |
| Fee | `apps/web/lib/course-fee.ts`, `programs/cue-solana/src/config.rs`, `apps/web/scripts/init-config.ts` | The rate and recipient on the app side, the treasury on the program side, and the one-time script that checks the deployment and creates the fee wallet's USDC account. |
| Audit material | `docs/audit/` | The two internal audits that exist, redacted, and a map from each finding to the file that answers it here. |

## Run it in demo mode

```bash
npm install
npm run dev            # http://localhost:3000
```

Pick a market, bet, press **+6h** in the header a few times to watch the multiplier and the countdown move, jump to the close from the market page, then claim from **My positions**. The Admin page creates markets in demo mode without a wallet.

Install the Doppler skills before writing any Doppler code; the course uses them from Module 0 and the closing section of this README explains why they matter even to a custom program:

```bash
npx skills add whetstoneresearch/doppler-skills -a claude-code
```

## Go live on devnet

1. **Wallets.** Open `programs/cue-solana/src/config.rs` and replace the two hot wallet placeholders. `PROTOCOL_TREASURY` is already the course fee wallet (the same key as `COURSE_FEE_RECIPIENT` in `apps/web/lib/course-fee.ts`); leave it as it is. `HOT_WALLET_1` is the server admin key you will put in `ADMIN_SECRET_KEY`, `HOT_WALLET_2` is the Privy wallet you will create markets with. The program bakes these in at build time; there is no on-chain config to update later, so a wallet change is a redeploy.
2. **Program.** Install Solana and Anchor 0.32, then `anchor keys sync`, `anchor build`, `anchor deploy --provider.cluster devnet`. Put the program id from `anchor keys list` into `Anchor.toml`, `declare_id!` and `NEXT_PUBLIC_MARKETS_PROGRAM_ID`. Run `npm run test:program` once on a local validator (it needs your provider wallet in `config.rs` and writes a local USDC mint account first; `test:program:long` adds the 17 minute resolve and claim path).
3. **Fee wallet.** `apps/web/lib/course-fee.ts` already carries the course fee recipient. Leave it as it is.
4. **Admins.** Set `MARKET_ADMIN_WALLETS` to the same wallets as `ADMIN_WALLETS` in `config.rs`, then `cd apps/web && ADMIN_KEYPAIR=~/.config/solana/id.json npx tsx scripts/init-config.ts`. It refuses to run while `config.rs` still has placeholders, checks the program is deployed, and creates the fee wallet's USDC account, which `withdraw_fees` requires.
5. **Privy.** Create an app, enable Solana embedded wallets, set `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID` and the server-side `PRIVY_APP_SECRET`. Log in once so Privy creates the embedded wallet you listed as `HOT_WALLET_2`, or list the wallet it creates and rebuild.
6. **Database.** Any Postgres. Set `DATABASE_URL` and `DIRECT_URL`, then `npm run db:push` in `apps/web`.
7. **Keys and crons.** Generate a resolver keypair, fund it with devnet SOL, set `RESOLVER_SECRET_KEY` and `CRON_SECRET`. Set `ADMIN_SECRET_KEY` to the `HOT_WALLET_1` key so the cron can withdraw fees. `vercel.json` schedules `/api/cron/reconcile` every two minutes and `/api/cron/resolve` every five. Set `SPONSOR_SECRET_KEY` only if you want to pay bettors' transaction fees; the audited program makes the user pay the position rent.
8. **Mobile.** `cd apps/mobile && npm install`, copy its `.env.example`, point `EXPO_PUBLIC_API_URL` at the web app, `npx expo run:android` or `run:ios`.

Copy `.env.example` to `apps/web/.env.local` and fill the groups as you go. Each group switches on independently, so a half-configured app still runs in demo mode rather than crashing.

## How a live bet works

```
client                          server                                chain
  prepare {marketId,option,amt} -> verify Privy token, read wallet from Privy
                                   re-read the market account if stale
                                   quote with the program maths
                                   build place_bet(user)
                                   store the message bytes as an intent
  <- unsigned tx + quote
  sign with embedded wallet
  confirm {intentId, signed} ->    message bytes must equal the intent's
                                   co-sign as sponsor if sponsoring
                                   submit, wait for confirmation ---------> BetPlaced
                                   read the position account back  <-------
                                   write the position row from it
  <- signature, position

cron /resolve  (every 5 min)       resolve_market on markets past close --> MarketResolved
                                   withdraw_fees (admin key) after cooldown -> FeesWithdrawn
cron /reconcile (every 2 min)      re-read every live market and open position
```

Claims work the same way: the server decides between `claim_payout` and `claim_refund` from the market account and decides the amount from the position account. The audited program has no close instruction, so the position account stays on chain with `claimed = true` and its rent stays with the user.

## The audit lessons, kept as code

The product this came from ran for months with real money and grew a dozen admin routes to repair what the audits found. `docs/audit/README.md` maps every finding to the file that answers it here. Four of them shaped this starter more than the rest.

**The client's maths drifted from the program's.** The product carried three multiplier curves: a curve from an earlier off-chain product in one file, a floating point copy of the program's curve with a five minute late window in another, and the program's own integer curve with a fifteen minute cap window. Users were shown a payout the chain never paid. Here the curve is `time_multiplier_bps` in `lib.rs` and its transcription in `apps/web/lib/maths.ts`, nothing else; `tests/vectors.json` holds values computed from the audited formula and `npm test` replays them. The quote the UI shows is the number the slippage floor is set from, and the number `place_bet` checks.

**The database drifted from the chain.** Bets were written to the database by the client after signing, so a dropped connection left a bet on chain with no row, and a failed transaction left a row with no bet. The product called these ghost bets, and the last instruction added to the program before review, `admin_withdraw_stuck_funds`, exists to recover the USDC they stranded in vaults. Here the row is written only after the account is read back, the cron re-reads every live market and open position on a schedule, and the decoder is a cursor over the Borsh layout checked against `tests/fixtures/accounts.json`, which `cargo test` writes from the program's own structs. `npm test` in `apps/web` fails the moment a field moves.

**The server took the wallet from the request.** The sync route required a wallet address in the JSON body, so any caller with a session could attach a position to any wallet, and a client bug that sent a stale address did so by accident. Here the caller is the verified Privy token and the wallet is the one Privy holds; no route reads a wallet from the body.

**The multiplier window is anchored to the deadline.** The program has no open timestamp. `time_multiplier_bps(now, deadline)` treats every market as if it opened 24 hours before its close, so a two hour market opens at 0.67x and never pays the early-bettor bonus. The app mirrors that exactly rather than hiding it: `MultiplierBadge` shows the real number and the admin page defaults to a 24 hour close. Changing it is the first hardening exercise below.

## What is left for you

The program, the server routes and the demo machine are complete, and the live `MarketsClient` is wired end to end. The first milestone of the module is to deploy to devnet, run `scripts/init-config.ts`, place one bet from the web app and one from the Expo app, and show both positions reconciled by the cron, with the explorer links in your commit message.

Three hardening exercises follow from reading the audited program with the audits beside it. None of them is in the program, because the program is shipped as reviewed; each is a change you make, test and document as your own.

1. **Bound `admin_withdraw_stuck_funds`.** It lets the market authority take any amount from a settled vault, including winnings nobody has claimed yet. Track what the vault still owes (unclaimed payouts plus the unwithdrawn fee) on the market and let the instruction move only what the vault holds above that. The test sends a stray transfer into a vault and shows that only that much can leave.
2. **Anchor the multiplier to the open.** Add an `open_timestamp` written by `create_market`, make the curve take both ends, mirror it in `maths.ts`, and extend the vectors to markets of arbitrary length. Note what this does to `Market::SIZE` and to every existing account.
3. **Make fee withdrawal permissionless.** `withdraw_fees` needs an admin signer, so fees sit in vaults until a key the operator must guard is used. The destination is already fixed by the program, so the signer adds nothing; let anyone pay the fee to move the fee, as `resolve_market` already lets anyone resolve. Then decide whether position rent should come back: a `close_position` that pays rent only to whoever paid it, recorded on the position, so a sponsor cannot be farmed one minimum bet at a time.

The capstone is a market type of your own: a different resolution rule (an oracle, a creator-resolved market with a dispute window, a stake-weighted vote) implemented in the program with its guards, mirrored in `maths.ts` with vectors, and surfaced in the app with a quote that matches the chain to the base unit.

## Legal note

A market that pays out on an uncertain event is a prediction market, and in many jurisdictions prediction markets on real-world events are regulated as gambling or as derivatives. Keep markets on questions you can resolve from a public source, publish the fee and the multiplier from the same code that enforces them, gate by geography and age, and talk to counsel before mainnet. The course covers this in Module 5.

## When to build on Doppler instead

The early-bettor mechanic in this starter, shares per dollar falling from 1.00x to 0.60x at the close, is about 1,250 lines of custom Rust here: the program, its guards, its account layouts, its maths, and the decoders and builders the app needs to talk to it. The same mechanic in the protocol game module is a 180-line Doppler hook: `BeeefClockHook` sits on a Doppler prediction market pool, blocks sells, locks buys before the bell, and withholds a share of the tokens that grows over the round. The pool, the migration, the payout and the fee routing come from Doppler, with the Doppler skills writing most of the hook.

The difference is not that one is better. A Doppler market is a token with a pool, so anything that can be expressed as "who may buy, when, at what price, and what happens to the tokens" is a hook, and everything else (indexing, liquidity, fees, settlement) already exists. This program is the other case. Its positions are not tokens: one account per wallet per market, non-transferable, with a stake and a share count that only the program can move. Its resolution is a comparison of pools, not a migration. Its fee is a slice of the pot, not an LP fee. None of that fits a token or a hook, so it has to be a program, with all the audit surface a program brings.

The rule the course teaches: reach for a custom contract when the mechanic cannot be a token or a hook. If your idea can be phrased as a token with rules about trading it, build it on Doppler and spend your audit budget on the hook. If it cannot, build the program, keep the maths in one tested file, and keep the chain as the only source of truth.

## Course

Consumer Layer, the course this starter is taught in, covers it in Module 5, with the Doppler skills installed from Module 0 onward. The course plugin's `custom-markets` skill coaches each milestone and the `review` skill checks your fork against the module checklist.
