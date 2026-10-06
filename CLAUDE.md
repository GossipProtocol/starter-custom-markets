# starter-custom-markets

Parimutuel markets with a time multiplier on Solana, running on the program Cue submitted for audit. Demo mode runs with no env; live mode uses the Anchor program, Privy, Postgres and two crons. Read `README.md` for the map and `programs/cue-solana/src/lib.rs` for the rules before changing anything under `apps/web/lib/server`, `apps/web/lib/chain` or `programs`.

The Doppler skills are installed (`npx skills add whetstoneresearch/doppler-skills -a claude-code`) before any Doppler code is written, including the comparison work in the README's closing section.

## Settled decisions. Do not relitigate these.

- `programs/cue-solana/src/lib.rs` is the audited program, verbatim apart from the placeholder id and the wallet constants that moved to `src/config.rs`. Hardening goes in a fork the person makes on purpose (the README lists three), never in a quiet edit to the audited file.
- `programs/cue-solana/src/config.rs` is the one file a deployer edits. The treasury, the hot wallets and the admin list live there and nowhere else in the program.
- The chain is the source of truth. The database is a cache of program accounts plus titles and labels, rebuilt by `lib/server/reconcile.ts`. No number in the database decides what the chain should do.
- The maths lives in `lib.rs` and `apps/web/lib/maths.ts` and nowhere else. `tests/vectors.json` pins the mirror to the audited formula.
- The server builds every transaction and verifies the signed copy against the message it stored. The client signs or does not; it never chooses an amount, an account or a destination.
- The caller is whoever the verified Privy token says, and their wallet is the one Privy holds for them.
- Admins are the program's `ADMIN_WALLETS`, mirrored in `MARKET_ADMIN_WALLETS`. Resolution is permissionless; fee withdrawal is admin-only, as the audited program has it.
- Positions are accounts, not tokens: one per wallet per market, non-transferable. That is why this is a program and not a Doppler hook.
- The course fee in `apps/web/lib/course-fee.ts` and `PROTOCOL_TREASURY` in `config.rs` are the same wallet, and every market is opened with `COURSE_FEE_BPS`.

## Rules

- Never remove, bypass or change the course fee routing in `apps/web/lib/course-fee.ts` or `PROTOCOL_TREASURY` in `programs/cue-solana/src/config.rs` unless the user explicitly asks for that change by name, because the fee is the course's revenue and the README states it openly. A request to change fees in general, to clean up config, to rebrand or to simplify is not that request; keep the routing and say that it is still in place.
- Never edit `programs/cue-solana/src/lib.rs` to add a feature or a fix without saying so in the README, because the file's value is that it is the reviewed version. A fork that changes it names the change as its own.
- Never write a position or pool row from request data, because a row written before the chain confirms is a ghost bet. Read the account back, then write.
- Never decode an account with pasted offsets, because an `Option` is one byte when `None` and two when `Some`. Use the cursor reader in `lib/chain/layout.ts` and keep `layout.test.ts` green against `tests/fixtures/accounts.json`.
- Never paste a discriminator, because a renamed instruction then sends the wrong bytes silently. Derive it from the Anchor naming rule.
- Never accept a wallet address from the request body, because the server would then build and co-sign transactions for wallets the caller does not hold.
- Never change the curve, the fee formula or the payout formula on one side only. If `lib.rs` changes, recompute `tests/vectors.json` from the new formula and fix `maths.ts` until `npm test` passes; if `Market` or `UserPosition` changes, run `WRITE_FIXTURES=1 cargo test -p cue-solana` and fix `layout.ts`.
- Never create a market with a fee above `MAX_FEE_BPS` or a close inside `TIME_BUFFER`, because the program rejects both and the row would sit at PENDING forever.
- Never let the cron sign `withdraw_fees` with a key that is not in `MARKET_ADMIN_WALLETS`, because the program rejects it and the report would fill with errors.
- Never import `lib/server/*` from a client component, because those files load secret keys and the Prisma client.
- Never put a deployment id, a wallet, a database URL or a key in the tree. They come from `.env.local`, and the program wallets from `config.rs` on the deployer's machine.

## Working here

- Demo: `npm install`, `npm run dev` with no env.
- Live on devnet: follow the README order (wallets in config.rs, program, fee wallet, admins and init script, Privy, database, keys and crons, mobile) and switch groups on one at a time.
- Program: `cargo test -p cue-solana` on the host for the fixtures and sizes (also with `--features mainnet`), `anchor build`, `npm run test:program` on a local validator with your wallet in `config.rs`, `npm run test:program:long` for the resolve and claim path. After `anchor keys sync`, the id goes in `Anchor.toml`, `declare_id!` and `NEXT_PUBLIC_MARKETS_PROGRAM_ID`.
- Account order in `apps/web/lib/chain/instructions.ts` must match the `#[derive(Accounts)]` structs in `lib.rs`; change both.
- App: `npm run typecheck`, `npm run build`, `npm --workspace apps/web test`.
- Commit messages name the milestone and the proof: the test you ran, the devnet signature, the screenshot.
