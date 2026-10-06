> Provenance. This is one of the two internal audits Winny wrote over the live product in February 2026, reproduced from the product repo with every wallet address, program id, email and client-identifying detail replaced by `[redacted]`. It covers the product's app and its permissionless program variant (`cue_permissionless`, which added creator fees and a close instruction); the program in this starter is the admin-created variant that was submitted for external review. Instruction names, guards and the maths are the same in both, so the findings read across. File paths below are the product's, not this starter's; the README's lessons section maps them.

# Core User Flows Audit Report

**Date:** February 3, 2026  
**Auditor:** Winny
**Scope:** Sign Up, Market Creation, Betting, Fee Claiming, Winnings Claiming

---

## Table of Contents

1. [Sign Up / Wallet Creation](#1-sign-up--wallet-creation)
2. [Market Creation](#2-market-creation)
3. [Bets Placed](#3-bets-placed)
4. [Fees Claimed](#4-fees-claimed)
5. [Winnings Claimed](#5-winnings-claimed)
6. [Critical Findings Summary](#6-critical-findings-summary)
7. [Recommendations](#7-recommendations)

---

## 1. Sign Up / Wallet Creation

### Flow Overview

```
User clicks "Sign Up" → Privy login modal → Email verification
    ↓
Privy creates embedded Solana wallet (automatic)
    ↓
Frontend detects authenticated user without DB record
    ↓
POST /api/auth/signup (creates User, UserBalance, UserXP)
    ↓
Async wallet sync via /api/user/link-wallet
```

### Key Files

| Component | File | Lines |
|-----------|------|-------|
| Privy Config | `apps/web/app/privy-provider.tsx` | 27-43 |
| Signup Modal | `apps/web/components/SignUpModal.tsx` | 16-24 |
| Auto-Signup | `apps/web/app/app/layout.tsx` | 316-394 |
| Signup API | `apps/web/app/api/auth/signup/route.ts` | 13-157 |
| Link Wallet | `apps/web/app/api/user/link-wallet/route.ts` | 18-104 |
| User Schema | `apps/web/prisma/schema.prisma` | 11-62 |

### What Gets Stored

| System | Data Stored |
|--------|-------------|
| Privy | Email, embedded wallet keypair, auth tokens |
| Database | privyId (unique), email (unique), username, walletAddress, privyWalletAddress |
| Related Tables | UserBalance (initial $0), UserXP (level 1, 0 XP) |

### Edge Cases

#### User exists in Privy but not in DB
- **Location:** `apps/web/app/app/layout.tsx:339-381`
- **Handling:** Auto-creates via signup API
- **Issue:** If signup fails, user stuck (Privy authenticated, no DB record)

#### User exists in DB but not in Privy
- **Not handled:** No code path for this scenario
- **Risk:** If Privy account deleted, user cannot authenticate

### 🚨 CRITICAL FINDINGS

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| **No rate limiting** | `signup/route.ts` | HIGH | Signup endpoint has no rate limiting - potential spam abuse |
| **Non-atomic user creation** | `signup/route.ts:87-125` | HIGH | User, balance, XP created as separate operations - partial creation possible |
| **Invite code race condition** | `signup/route.ts:72-76` | MEDIUM | Invite code incremented BEFORE user creation - consumed if creation fails |
| **Silent failures** | `layout.tsx:379`, `signup/route.ts:134` | MEDIUM | Errors caught but user not informed |
| **Wallet sync timing** | `layout.tsx:420-465` | MEDIUM | Wallet sync is async - may not be available immediately |
| **walletAddress not unique** | `schema.prisma:24` | LOW | Multiple users could have same wallet address |

---

## 2. Market Creation

### Flow Overview

```
User submits form (SubmitMarketModal)
    ↓
Frontend validations (title, outcomes, images, SOL balance)
    ↓
POST /api/markets/create-permissionless
    ↓
[DB] Create Market record (status: PENDING_ONCHAIN)
    ↓
POST /api/markets/build-create-tx
    ↓
[Backend] Build unsigned transaction
    ↓
Frontend signs (Privy signAndSendTransaction)
    ↓
[On-chain] create_market instruction
    ↓
POST /api/markets/confirm-onchain (background)
    ↓
[DB] Update status: PENDING_ONCHAIN → OPEN
```

### Key Files

| Component | File | Lines |
|-----------|------|-------|
| Frontend Modal | `apps/web/components/Cliques/SubmitMarketModal.tsx` | 315-719 |
| Create API | `apps/web/app/api/markets/create-permissionless/route.ts` | 19-262 |
| Build TX API | `apps/web/app/api/markets/build-create-tx/route.ts` | 36-156 |
| Confirm API | `apps/web/app/api/markets/confirm-onchain/route.ts` | 20-203 |
| Solana Program | `programs/cue_permissionless/src/lib.rs` | 146-201 |
| Sync Cron | `apps/web/app/api/cron/sync-pending-markets/route.ts` | 18-165 |

### Validations

| Validation | Location | Rule |
|------------|----------|------|
| Title length | Frontend:319-329 | Minimum 4 words |
| Title max | Frontend:1061 | 200 characters |
| Outcomes count | API:54-60 | 2-7 outcomes |
| Resolution time | API:62-64, Contract:167-170 | Required, must be > now + 5 min |
| SOL balance | Frontend:368-373 | Minimum 0.008 SOL |
| Content moderation | API:95-99 | Title checked for banned words |
| Rate limiting | API:151 | **DISABLED** |

### Fee/Cost Handling

| Cost | Amount | When |
|------|--------|------|
| Rent | ~0.003 SOL | At creation (returned on close) |
| Transaction fee | ~0.002 SOL | At creation |
| Trading fees | 5% (2% protocol + 3% creator) | On each bet |

### Error Recovery

| Scenario | Handling |
|----------|----------|
| DB created, on-chain fails | Cron marks CANCELLED after 30 min (`sync-pending-markets/route.ts:128-137`) |
| On-chain succeeds, DB update fails | Cron detects and updates DB (`sync-pending-markets/route.ts:108-120`) |
| Insufficient funds | Frontend SOL check prevents transaction (`SubmitMarketModal.tsx:368-373`) |

### 🚨 CRITICAL FINDINGS

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| **Rate limiting DISABLED** | `create-permissionless/route.ts:151` | HIGH | Spam market creation possible |
| **No resolveTimestamp validation in API** | `create-permissionless/route.ts` | MEDIUM | Frontend validates but API doesn't check if timestamp is in future |
| **Content moderation only checks title** | `create-permissionless/route.ts:95` | MEDIUM | Description not moderated |
| **Blocklist is hardcoded** | `create-permissionless/route.ts:104-106` | LOW | Should be in database |

---

## 3. Bets Placed

### Flow Overview

```
User selects outcome and amount
    ↓
Frontend validations (balance, opposing position, return check)
    ↓
Build placeBet instruction
    ↓
Sign with Privy signTransaction
    ↓
Broadcast via sendRawTransaction
    ↓
Wait for confirmation
    ↓
POST /api/bets/sync-onchain (background, with retries)
    ↓
[DB] Create Bet record, update Outcome pool
```

### Key Files

| Component | File | Lines |
|-----------|------|-------|
| Frontend | `apps/web/app/app/markets/[id]/page.tsx` | 876-1354 |
| Sync API | `apps/web/app/api/bets/sync-onchain/route.ts` | 1-400 |
| Solana Helper | `apps/web/lib/solana/permissionless.ts` | 186-227 |
| Program | `programs/cue_permissionless/src/lib.rs` | 209-351 |
| Time Multiplier | `programs/cue_permissionless/src/lib.rs` | 98-127 |

### Bet Amount Validation

| Check | Location | Rule |
|-------|----------|------|
| Minimum (on-chain) | `lib.rs:17` | 1 USDC (MIN_BET = 1_000_000) |
| Minimum (frontend) | `time-weighted-pricing.ts:15` | **0.10 USDC** (INCONSISTENT!) |
| USDC balance | `page.tsx:924-929` | Must have sufficient USDC |
| SOL balance | `page.tsx:931-937` | Minimum 0.005 SOL |
| Late bet cap | `lib.rs:277-292` | Last 15 min: max 10% of pool per user |

### Time-Weighted Share Calculation

```
Formula: shares = amount × multiplier

Multiplier (time_multiplier_bps):
- First 50% of market duration: 1.0x (10000 bps)
- Last 50%: Linear decay from 1.0x to 0.6x (6000 bps minimum)

Location: programs/cue_permissionless/src/lib.rs:98-127
```

### Payout Calculation

```
distributablePool = totalPool × 0.95 (after 5% fee)
payout = (userShares / totalWinningShares) × distributablePool

Location: apps/web/lib/solana/time-weighted-pricing.ts:121-193
```

### Partial Failure Handling

| Scenario | Handling |
|----------|----------|
| TX succeeds, DB sync fails | Retry 3x, then store in localStorage for manual retry |
| Multiple simultaneous bets | Solana tx ordering + DB idempotency checks prevent duplicates |

### Race Condition Protection

| Layer | Protection |
|-------|------------|
| On-chain | Solana tx ordering, Position PDA uniqueness, prevents side-switching |
| Database | `prisma.$transaction()`, unique constraints on txSignature/positionPda |
| Sync route | Multiple idempotency checks (lines 73-195) |

### 🚨 CRITICAL FINDINGS

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| **Inconsistent minimum bet** | Frontend: 0.10 USDC, Contract: 1 USDC | HIGH | User could think 0.10 is valid but tx fails |
| **No automatic reconciliation** | `page.tsx:1240-1243` | MEDIUM | Failed syncs only in localStorage |
| **No max bet limit (except late)** | `lib.rs` | LOW | Users can bet unlimited (may be intentional) |

---

## 4. Fees Claimed

### Fee Structure

| Fee Type | Amount | Recipient | Trigger |
|----------|--------|-----------|---------|
| Protocol Fee | 2% (200 bps) | Platform Treasury | Each bet |
| Creator Fee | 3% (300 bps) | Market Creator | Each bet |
| Clique Fee | 25% of platform fee | Clique Treasury | Markets in clique |

**Location:** `programs/cue_permissionless/src/lib.rs:19-22`

### Who Can Claim and When

| Fee Type | Who | When |
|----------|-----|------|
| Creator Fees | Market creator only | After resolution + 24h cooldown |
| Protocol Fees | Admin only (cron) | After resolution + 24h cooldown |
| Clique Fees | Clique admins | Accrued in DB, claimed via platform |

### Key Files

| Component | File | Lines |
|-----------|------|-------|
| Creator Fee Claim UI | `apps/web/app/app/profile/page.tsx` | 871-1001 |
| Creator Fee Contract | `programs/cue_permissionless/src/lib.rs` | 700-759 |
| Protocol Fee Cron | `apps/web/app/api/cron/collect-protocol-fees/route.ts` | 39-255 |
| Protocol Fee Contract | `programs/cue_permissionless/src/lib.rs` | 631-694 |

### Double-Claim Prevention

| Layer | Protection | Location |
|-------|------------|----------|
| On-chain (Creator) | `creator_fees_withdrawn` boolean | `lib.rs:714` |
| On-chain (Protocol) | `protocol_fees_withdrawn` boolean | `lib.rs:650` |
| On-chain (Position) | `position.claimed` boolean | `lib.rs:460` |
| Database | Idempotency in sync-claim | `sync-claim/route.ts:48-72` |

### 🚨 CRITICAL FINDINGS

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| **No DB tracking for fee withdrawals** | N/A | LOW | Creator/protocol fees rely on on-chain state only - no audit trail in DB |
| **Fee percentages hardcoded** | `lib.rs:19-22` | LOW | Cannot adjust without program upgrade |

---

## 5. Winnings Claimed

### Resolution Flow

```
After resolve_timestamp passes
    ↓
Anyone calls resolve_market (permissionless)
    ↓
Contract determines winner by stake majority
    ↓
Market status: Open → Resolved
    ↓
24-hour cooldown for fee withdrawals
    ↓
Users can claim payouts
```

### Who Resolves Markets

| Type | Who | How |
|------|-----|-----|
| On-chain | Anyone (permissionless) | Call `resolve_market` after timestamp |
| On-chain (backup) | Admin via cron | `resolve-onchain-markets/route.ts` |
| Off-chain | Auto-cron | `resolve-24h-markets.ts` |

### Winning Outcome Determination

```
Winner = Option with highest pool value

Edge cases:
- No bets: Market CANCELLED
- Tie: Market CANCELLED (refunds issued)
- Single-sided: Market CANCELLED (off-chain only)

Location: programs/cue_permissionless/src/lib.rs:387-415
```

### Claim Flow

```
User clicks "Claim" on profile page
    ↓
Frontend checks on-chain position (not claimed)
    ↓
Build claimPayout instruction
    ↓
Sign with Privy signMessage
    ↓
Broadcast and confirm
    ↓
POST /api/bets/sync-claim (update DB)
```

### Key Files

| Component | File | Lines |
|-----------|------|-------|
| Profile Claim UI | `apps/web/app/app/profile/page.tsx` | 489-868 |
| Market Detail Claim | `apps/web/app/app/markets/[id]/page.tsx` | 1356-1553 |
| Claim Contract | `programs/cue_permissionless/src/lib.rs` | 451-560 |
| Sync Claim API | `apps/web/app/api/bets/sync-claim/route.ts` | 21-225 |
| Resolution Contract | `programs/cue_permissionless/src/lib.rs` | 357-448 |

### Double-Claim Prevention

| Layer | Protection |
|-------|------------|
| On-chain | `position.claimed` flag + `AlreadyClaimed` error |
| Frontend | Pre-check before claim UI displayed |
| Database | `claimTxSignature` unique, idempotency checks |

### Unclaimed Winnings

- **Behavior:** Funds remain in market vault indefinitely
- **Admin Recovery:** `admin_withdraw_stuck_funds` for ghost bets only (`lib.rs:761-808`)
- **No Expiration:** Unclaimed funds never expire

### Dispute Mechanism

- **⚠️ NO DISPUTE MECHANISM EXISTS**
- Resolution is final and cannot be reversed
- Winner determined by stake majority (not admin choice)
- Only protection: cannot resolve before `resolve_timestamp`

### 🚨 CRITICAL FINDINGS

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| **No dispute mechanism** | N/A | HIGH | Resolution cannot be reversed if incorrect |
| **Unclaimed funds never expire** | N/A | MEDIUM | Funds stuck in vault indefinitely |
| **Single-sided check only off-chain** | `resolve-24h-markets.ts:119-127` | MEDIUM | On-chain markets can resolve with one-sided betting |

---

## 6. Critical Findings Summary

### HIGH Severity

| # | Issue | Flow | Location |
|---|-------|------|----------|
| 1 | No rate limiting on signup | Sign Up | `signup/route.ts` |
| 2 | Non-atomic user creation | Sign Up | `signup/route.ts:87-125` |
| 3 | Rate limiting DISABLED | Market Creation | `create-permissionless/route.ts:151` |
| 4 | Inconsistent minimum bet (0.10 vs 1.00 USDC) | Betting | Frontend vs Contract |
| 5 | No dispute mechanism | Winnings | N/A |

### MEDIUM Severity

| # | Issue | Flow | Location |
|---|-------|------|----------|
| 6 | Invite code race condition | Sign Up | `signup/route.ts:72-76` |
| 7 | Silent failures in signup | Sign Up | `layout.tsx:379` |
| 8 | Wallet sync timing issues | Sign Up | `layout.tsx:420-465` |
| 9 | No resolveTimestamp validation in API | Market Creation | `create-permissionless/route.ts` |
| 10 | Content moderation only checks title | Market Creation | `create-permissionless/route.ts:95` |
| 11 | No automatic bet sync reconciliation | Betting | `page.tsx:1240-1243` |
| 12 | Unclaimed funds never expire | Winnings | N/A |
| 13 | Single-sided check only off-chain | Winnings | `resolve-24h-markets.ts:119-127` |

### LOW Severity

| # | Issue | Flow | Location |
|---|-------|------|----------|
| 14 | walletAddress not unique in schema | Sign Up | `schema.prisma:24` |
| 15 | Blocklist hardcoded | Market Creation | `create-permissionless/route.ts:104-106` |
| 16 | No DB tracking for fee withdrawals | Fees | N/A |
| 17 | Fee percentages hardcoded in contract | Fees | `lib.rs:19-22` |

---

## 7. Recommendations

### Immediate (This Week)

1. **Enable rate limiting on signup** - Prevent account creation spam
2. **Fix minimum bet inconsistency** - Align frontend (0.10) with contract (1.00)
3. **Re-enable market creation rate limiting** - `RATE_LIMIT_ENABLED = true`
4. **Wrap signup in database transaction** - Make user creation atomic

### Short-Term (1-2 Weeks)

5. **Add resolveTimestamp validation to API** - Prevent invalid resolution times
6. **Move invite code increment after user creation** - Prevent consumption on failure
7. **Implement automatic bet sync reconciliation** - Background job for failed syncs
8. **Add content moderation to descriptions** - Currently only title checked

### Medium-Term (2-4 Weeks)

9. **Add dispute mechanism** - Allow challenging incorrect resolutions
10. **Add unclaimed fund expiration** - Funds returned after X days
11. **Move blocklist to database** - Easier management
12. **Add single-sided check to on-chain resolution** - Prevent unfair markets
13. **Add DB audit trail for fee withdrawals** - Track all fee claims

### Infrastructure

14. **Add monitoring/alerting for signup failures** - Catch registration bugs early
15. **Add idempotency keys to signup requests** - Prevent duplicate accounts
16. **Improve error messages** - Return specific errors instead of generic 500s

---

## Appendix: All File Paths Referenced

### Sign Up
- `apps/web/app/privy-provider.tsx`
- `apps/web/components/SignUpModal.tsx`
- `apps/web/app/app/layout.tsx`
- `apps/web/app/api/auth/signup/route.ts`
- `apps/web/app/api/user/link-wallet/route.ts`
- `apps/web/prisma/schema.prisma`

### Market Creation
- `apps/web/components/Cliques/SubmitMarketModal.tsx`
- `apps/web/app/api/markets/create-permissionless/route.ts`
- `apps/web/app/api/markets/build-create-tx/route.ts`
- `apps/web/app/api/markets/confirm-onchain/route.ts`
- `apps/web/app/api/cron/sync-pending-markets/route.ts`
- `programs/cue_permissionless/src/lib.rs`

### Betting
- `apps/web/app/app/markets/[id]/page.tsx`
- `apps/web/app/api/bets/sync-onchain/route.ts`
- `apps/web/lib/solana/permissionless.ts`
- `apps/web/lib/solana/time-weighted-pricing.ts`
- `programs/cue_permissionless/src/lib.rs`

### Fees
- `apps/web/app/app/profile/page.tsx`
- `apps/web/app/api/cron/collect-protocol-fees/route.ts`
- `programs/cue_permissionless/src/lib.rs`

### Winnings
- `apps/web/app/app/profile/page.tsx`
- `apps/web/app/app/markets/[id]/page.tsx`
- `apps/web/app/api/bets/sync-claim/route.ts`
- `apps/web/lib/resolve-24h-markets.ts`
- `programs/cue_permissionless/src/lib.rs`
