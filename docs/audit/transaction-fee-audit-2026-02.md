> Provenance. This is one of the two internal audits the Consumer Layer team wrote over the live product in February 2026, reproduced from the product repo with every wallet address, program id, email and client-identifying detail replaced by `[redacted]`. It covers the product's app and its permissionless program variant (`cue_permissionless`, which added creator fees and a close instruction); the program in this starter is the admin-created variant that was submitted for external review. Instruction names, guards and the maths are the same in both, so the findings read across. File paths below are the product's, not this starter's; the README's lessons section maps them.

# Transaction Fee Handling Audit Report

**Date:** February 3, 2026  
**Purpose:** Diagnose high transaction failure rates  
**Key Finding:** Users pay their own gas (no sponsorship) - all flows confirmed

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Market Creation](#2-market-creation)
3. [Placing Bets](#3-placing-bets)
4. [Claiming Winnings](#4-claiming-winnings)
5. [Claiming Creator Fees](#5-claiming-creator-fees)
6. [RPC Configuration](#6-rpc-configuration)
7. [Onboarding & Funding Flow](#7-onboarding--funding-flow)
8. [Dead Sponsorship Code](#8-dead-sponsorship-code)
9. [Failed Transaction Scenarios](#9-failed-transaction-scenarios)
10. [Recommendations](#10-recommendations)

---

## 1. Executive Summary

### Fee Payer Configuration

| Transaction Type | Fee Payer | Correct? |
|-----------------|-----------|----------|
| Market Creation | User's embedded wallet | ✅ Yes |
| Placing Bets | User's embedded wallet | ✅ Yes |
| Claiming Winnings | User's embedded wallet | ✅ Yes |
| Claiming Creator Fees | User's embedded wallet | ✅ Yes |

### SOL Balance Checks

| Transaction Type | Threshold | Actual Cost | Gap |
|-----------------|-----------|-------------|-----|
| Market Creation | 0.008 SOL | ~0.005 SOL | +0.003 buffer ✅ |
| Placing Bets | 0.005 SOL | ~0.003 SOL | +0.002 buffer ✅ |
| Claiming Winnings | **NONE** | ~0.002 SOL | ⚠️ **MISSING** |
| Claiming Creator Fees | **NONE** | ~0.002 SOL | ⚠️ **MISSING** |

### Signing Methods

| Transaction Type | Method | Correct? |
|-----------------|--------|----------|
| Market Creation | `signTransaction` + manual broadcast | ✅ Best practice |
| Placing Bets | `signTransaction` + manual broadcast | ✅ Best practice |
| Claiming Winnings (Profile) | `signMessage` + manual broadcast | ⚠️ Different pattern |
| Claiming Winnings (Market) | `signAndSendTransaction` | ⚠️ **Generic error handling** |
| Claiming Creator Fees | `signMessage` + manual broadcast | ⚠️ Different pattern |

### Key Issues Found

1. **No SOL balance check before claiming** - Users can attempt claims with 0 SOL
2. **Inconsistent signing methods** - Some flows use `signAndSendTransaction` which shows generic errors
3. **Missing `lastValidBlockHeight`** in some transactions - Can cause blockhash expiration issues
4. **Dead sponsorship code** - 3 files (~591 lines) should be removed
5. **Onboarding doesn't mention SOL** - Users can reach betting without knowing they need SOL

---

## 2. Market Creation

### Code Path

```
User clicks "Create Market" (SubmitMarketModal.tsx)
    ↓
Frontend validation (lines 350-376)
    ↓
SOL balance check: 0.008 SOL minimum (line 370)
    ↓
POST /api/markets/create-permissionless (DB record)
    ↓
POST /api/markets/build-create-tx (build unsigned tx)
    ↓
Rebuild tx with user as feePayer (lines 510-517)
    ↓
signTransaction (line 528)
    ↓
sendRawTransaction (line 535)
    ↓
confirmTransaction (line 544)
    ↓
POST /api/markets/confirm-onchain (update DB)
```

### Fee Payer Setting

| File | Line | Code | Status |
|------|------|------|--------|
| `SubmitMarketModal.tsx` | 512 | `feePayer: creatorPubkey` | ✅ Correct |
| `build-create-tx/route.ts` | 119 | `feePayer: rentPayerPubkey` | ✅ Defaults to creator |

### SOL Balance Check

| File | Line | Threshold | Status |
|------|------|-----------|--------|
| `SubmitMarketModal.tsx` | 370 | `MIN_SOL_FOR_MARKET = 0.008` | ✅ Checked before tx |
| `SubmitMarketModal.tsx` | 1359-1380 | UI warning if < 0.008 | ✅ Visual indicator |
| `SubmitMarketModal.tsx` | 1384 | Button disabled if < 0.008 | ✅ Prevents attempt |

### Compute Budget

| File | Line | Setting | Value |
|------|------|---------|-------|
| `build-create-tx/route.ts` | 125-127 | Priority fee | 5000 microLamports |
| `build-create-tx/route.ts` | 128-130 | Compute limit | 250,000 units |

### Error Handling

| Scenario | File:Line | User Experience |
|----------|-----------|-----------------|
| Insufficient SOL | `SubmitMarketModal.tsx:371-374` | Alert with balance + requirement |
| Privy error | `SubmitMarketModal.tsx:722-725` | Message with wallet address to fund |
| Timeout | `SubmitMarketModal.tsx:599-717` | Polls for confirmation, shows status |
| Tx failed | `SubmitMarketModal.tsx:550-552` | Shows detailed error |

---

## 3. Placing Bets

### Code Path

```
User clicks "Place Bet" (markets/[id]/page.tsx)
    ↓
Frontend validation (lines 877-977)
    ↓
SOL balance check: 0.005 SOL minimum (line 932)
    ↓
USDC balance check (lines 924-929)
    ↓
Build placeBet instruction (lines 1044-1058)
    ↓
Create tx with user as feePayer (lines 1068-1075)
    ↓
signTransaction (line 1096)
    ↓
sendRawTransaction (line 1104)
    ↓
confirmTransaction (lines 1113-1128)
    ↓
POST /api/bets/sync-onchain (update DB)
```

### Fee Payer Setting

| File | Line | Code | Status |
|------|------|------|--------|
| `markets/[id]/page.tsx` | 1069 | `feePayer: embeddedWalletPubkey` | ✅ Correct |

### SOL Balance Check

| File | Line | Threshold | Status |
|------|------|-----------|--------|
| `markets/[id]/page.tsx` | 932 | `MIN_SOL_FOR_GAS = 0.005` | ✅ Checked before tx |
| `markets/[id]/page.tsx` | 933-937 | Alert if insufficient | ✅ Clear message |

### Compute Budget

| File | Line | Setting | Value |
|------|------|---------|-------|
| `markets/[id]/page.tsx` | 986-988 | Priority fee | 5000 microLamports |
| `markets/[id]/page.tsx` | 989-991 | Compute limit | 150,000 units |

### Error Handling

| Scenario | File:Line | User Experience |
|----------|-----------|-----------------|
| Insufficient SOL | `page.tsx:933-937` | Alert with balance + requirement |
| Insufficient USDC | `page.tsx:924-929` | "Insufficient USDC balance" |
| Wrong side | `page.tsx:1142-1143` | "Already have bet on OTHER side" |
| Late bet cap | `page.tsx:1145-1146` | "Late bet cap exceeded" |
| Market closed | `page.tsx:1148-1152` | "Market not open / Trading closed" |
| Timeout | `page.tsx:1119-1128` | Checks status, proceeds if confirmed |

---

## 4. Claiming Winnings

### Code Path (Profile Page)

```
User clicks "Claim" (profile/page.tsx)
    ↓
Verify position on-chain (lines 489-600)
    ↓
⚠️ NO SOL balance check!
    ↓
Build claim instruction (lines 659-690)
    ↓
Create VersionedTransaction (lines 717-723)
    ↓
signMessage (line 754)
    ↓
sendRawTransaction (line 766)
    ↓
confirmTransaction (line 774)
    ↓
POST /api/bets/sync-claim (update DB)
```

### Code Path (Market Detail Page)

```
User clicks "Claim" (markets/[id]/page.tsx)
    ↓
Verify position on-chain
    ↓
⚠️ NO SOL balance check!
    ↓
Build claim instruction (lines 1422-1427)
    ↓
Create Transaction with user as feePayer (line 1471)
    ↓
signAndSendTransaction (line 1485) ⚠️ Different method!
    ↓
POST /api/bets/sync-claim (update DB)
```

### Fee Payer Setting

| File | Line | Code | Status |
|------|------|------|--------|
| `profile/page.tsx` | 718 | `payerKey: claimWalletPubkey` | ✅ Correct |
| `markets/[id]/page.tsx` | 1471 | `feePayer: claimWalletPubkey` | ✅ Correct |

### SOL Balance Check

| File | Line | Threshold | Status |
|------|------|-----------|--------|
| `profile/page.tsx` | N/A | **NONE** | ⚠️ **MISSING** |
| `markets/[id]/page.tsx` | N/A | **NONE** | ⚠️ **MISSING** |
| `profile/page.tsx` | 1730-1738 | Display warning only | ⚠️ Not blocking |

### Compute Budget

| File | Line | Setting | Value |
|------|------|---------|-------|
| `profile/page.tsx` | 673-678 | Priority: 5000, Limit: 200k | ✅ Included |
| `markets/[id]/page.tsx` | 1422-1427 | Priority: 5000, Limit: 250k | ✅ Included |

### Error Handling

| Scenario | File:Line | User Experience |
|----------|-----------|-----------------|
| Already claimed | `profile/page.tsx:819-826` | "Already claimed", removes from list |
| Not winner | `profile/page.tsx:827-832` | "Not a winner" |
| Insufficient SOL | **NOT HANDLED** | ⚠️ Generic error or silent fail |
| Timeout | `profile/page.tsx:837-840` | "Transaction sent but confirmation timed out" |

---

## 5. Claiming Creator Fees

### Code Path

```
User clicks "Claim" on creator earnings (profile/page.tsx)
    ↓
⚠️ NO SOL balance check!
    ↓
Build withdrawCreatorFees instruction (lines 904-920)
    ↓
Create VersionedTransaction (lines 931-937)
    ↓
signMessage (line 943)
    ↓
sendRawTransaction (line 950)
    ↓
confirmTransaction (line 958)
    ↓
Refresh creator markets list
```

### Fee Payer Setting

| File | Line | Code | Status |
|------|------|------|--------|
| `profile/page.tsx` | 932 | `payerKey: creatorPubkey` | ✅ Correct |

### SOL Balance Check

| File | Line | Threshold | Status |
|------|------|-----------|--------|
| `profile/page.tsx` | N/A | **NONE** | ⚠️ **MISSING** |

### Compute Budget

| File | Line | Setting | Value |
|------|------|---------|-------|
| `profile/page.tsx` | 910-915 | Priority: 5000, Limit: 150k | ✅ Included |

### Error Handling

| Scenario | File:Line | User Experience |
|----------|-----------|-----------------|
| Already withdrawn | `profile/page.tsx:972-976` | Shows success, refreshes |
| Too early (24h) | `profile/page.tsx:983-984` | "24 hour cooldown" |
| Not creator | `profile/page.tsx:985-986` | "Only the creator" |
| Insufficient SOL | **NOT HANDLED** | ⚠️ Generic error |

---

## 6. RPC Configuration

### Endpoints Used

| Environment Variable | Used For |
|---------------------|----------|
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Primary mainnet RPC |
| `NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL` | Devnet RPC |
| `NEXT_PUBLIC_HELIUS_RPC` | Helius fallback (some routes) |
| `SOLANA_RPC_URL` | Server-side routes |

### Hardcoded Fallbacks

| File | Line | URL |
|------|------|-----|
| Multiple | - | `https://api.mainnet-beta.solana.com` |
| Multiple | - | `https://api.devnet.solana.com` |
| `sync-all-onchain-bets/route.ts` | 21 | ⚠️ **Hardcoded Helius API key** |

### Commitment Levels

| Operation | Commitment | Consistent? |
|-----------|------------|-------------|
| Connection | `'confirmed'` | ✅ Yes |
| getLatestBlockhash | `'confirmed'` | ⚠️ Some omit (defaults to finalized) |
| confirmTransaction | `'confirmed'` | ✅ Yes |
| sendRawTransaction preflight | `'confirmed'` | ✅ Yes |

### Blockhash Handling

| Issue | Files Affected |
|-------|----------------|
| Missing `lastValidBlockHeight` | `profile/page.tsx:703, 927`, `profile/settings/page.tsx:322`, several cron jobs |
| Blockhash without commitment | `collect-protocol-fees/route.ts:204`, `resolve-onchain-markets/route.ts:227` |

---

## 7. Onboarding & Funding Flow

### How Users Get SOL

| Method | File | Lines |
|--------|------|-------|
| Coinbase Onramp | `layout.tsx` | 180-281 |
| Manual transfer | `CopyWalletModal.tsx` | 1-115 |
| Privy dashboard | `privy-provider.tsx` | 62-63 |

### Where Wallet Address is Shown

| Location | File | Lines | Copy Button? |
|----------|------|-------|--------------|
| Copy Wallet Modal | `CopyWalletModal.tsx` | 12-115 | ✅ Yes |
| Profile Settings | `profile/settings/page.tsx` | 868-878 | ✅ Yes |
| Market Detail (Add Funds) | `markets/[id]/page.tsx` | 2746-2764 | ✅ Yes |
| Submit Market Modal | `SubmitMarketModal.tsx` | 1367-1378 | ✅ Yes |
| Profile Page | `profile/page.tsx` | 1434-1438 | ❌ Truncated only |

### SOL Warnings

| Location | File | Lines | Threshold |
|----------|------|-------|-----------|
| Header dropdown | `layout.tsx` | 732-737 | < 0.005 SOL |
| Profile page | `profile/page.tsx` | 1730-1738 | < 0.005 SOL |
| Profile settings | `profile/settings/page.tsx` | 913-921 | < 0.005 SOL |
| Market creation | `SubmitMarketModal.tsx` | 1359-1380 | < 0.008 SOL |

### Gaps in Onboarding

| Issue | Impact |
|-------|--------|
| Onboarding modal doesn't mention SOL | Users don't know they need SOL |
| No proactive SOL warning on market pages | Users attempt bets with 0 SOL |
| SOL check only on bet/create, not claim | Claims fail with confusing errors |

---

## 8. Dead Sponsorship Code

### Files to Delete (Not Used)

| File | Lines | Purpose |
|------|-------|---------|
| `apps/web/lib/sponsoredTransaction.ts` | 195 | Sponsorship helpers |
| `apps/web/app/api/sponsor-transaction/route.ts` | 366 | Sponsorship API |
| `apps/web/scripts/generate-fee-payer.ts` | 30 | Fee payer wallet generator |

### Environment Variables to Remove

| File | Line | Variable |
|------|------|----------|
| `.env.example` | 28-29 | `FEE_PAYER_PRIVATE_KEY` |

### Outdated Comments (Cause Confusion)

| File | Line | Comment |
|------|------|---------|
| `permissionless.ts` | 156 | "for gas sponsorship, fee payer pays rent" |
| `permissionless.ts` | 194 | "for gas sponsorship, fee payer pays rent" |
| `build-create-tx/route.ts` | 67 | "Fee payer pays rent if provided" |
| `sync-onchain/route.ts` | 48-50 | "gas-sponsored transactions" |
| `lib.rs` | 885 | "can be fee payer for gas sponsorship" |

---

## 9. Failed Transaction Scenarios

### User Experience by Failure Type

| Failure | Detection Point | User Sees | Clear? |
|---------|-----------------|-----------|--------|
| **Insufficient SOL (betting)** | Pre-tx check | "Insufficient SOL...need ~0.005 SOL" | ✅ Yes |
| **Insufficient SOL (market)** | Pre-tx check | Warning banner + disabled button | ✅ Yes |
| **Insufficient SOL (claim)** | ⚠️ Not detected | Generic error or Privy modal | ❌ No |
| **Insufficient USDC** | Pre-tx check | "Insufficient USDC balance" | ✅ Yes |
| **Blockhash expired** | After broadcast | "Block height exceeded" or timeout | ⚠️ Partial |
| **RPC timeout** | After broadcast | Polls for status, may recover | ⚠️ Partial |
| **Privy signing failed** | At signing | "Something went wrong" | ❌ Generic |
| **User rejected** | At signing | Silent return | ✅ Expected |
| **Wrong network** | At connection | Depends on error | ❌ Not clear |
| **Already claimed** | At confirmation | "Already claimed", removes from list | ✅ Yes |
| **Wrong side bet** | At confirmation | "Already have bet on OTHER side" | ✅ Yes |
| **Market closed** | At confirmation | "Market not open for betting" | ✅ Yes |

### Silent Failures

| Scenario | File:Line | What Happens |
|----------|-----------|--------------|
| Claim sync fails | `profile/page.tsx:803-807` | Logged but UI shows success |
| Bet sync fails after retries | `markets/[id]/page.tsx:1243` | Stored in localStorage |
| Confirmation timeout but tx landed | `profile/page.tsx:837-840` | Shows warning, doesn't verify |

---

## 10. Recommendations

### Critical (Fix Immediately)

1. **Add SOL balance check before claims**
   - Files: `profile/page.tsx`, `markets/[id]/page.tsx`
   - Threshold: 0.005 SOL (same as betting)
   - Block claim attempt if insufficient

2. **Standardize signing method**
   - Change `signAndSendTransaction` (market detail claim) to `signTransaction` + manual broadcast
   - Provides better error messages

3. **Add `lastValidBlockHeight` to all transactions**
   - Files: `profile/page.tsx:703, 927`, `profile/settings/page.tsx:322`
   - Prevents blockhash expiration issues

### High Priority

4. **Add SOL requirement to onboarding modal**
   - File: `OnboardingModal.tsx`
   - Show wallet address with funding instructions

5. **Add proactive SOL warning on market pages**
   - File: `markets/[id]/page.tsx`
   - Show warning banner if SOL < 0.005 before user attempts bet

6. **Remove dead sponsorship code**
   - Delete: `sponsoredTransaction.ts`, `sponsor-transaction/route.ts`, `generate-fee-payer.ts`
   - Remove: `FEE_PAYER_PRIVATE_KEY` from `.env.example`

### Medium Priority

7. **Remove hardcoded Helius API key**
   - File: `sync-all-onchain-bets/route.ts:21`
   - Use environment variable

8. **Add commitment level to all `getLatestBlockhash` calls**
   - Standardize on `'confirmed'`

9. **Update outdated comments**
   - Remove references to "gas sponsorship" and "fee payer"

10. **Add retry logic to claim confirmations**
    - File: `profile/page.tsx`
    - Pattern: Same as betting (check status if timeout)

---

## 11. Mobile Bet Placement (Feb 2026)

### Slowness
- **Cause:** Web mobile flow (`MobileMarketsView`) was blocking on `connection.confirmTransaction()` until Solana confirmed (often 15–30s).
- **Change:** Added a 10s cap via `Promise.race`; if confirmation times out, we check `getSignatureStatus` and proceed if no error. UI no longer blocks 20–30s.
- **Files:** `apps/web/components/mobile/MobileMarketsView.tsx`

### Fee Display Confusion
- **Issue:** Privy’s “Confirm transaction” modal shows “Estimated fee US$0.00” and a separate “US$X.XX” (the bet amount in USDC). Users can think the bet amount is a fee.
- **Change:** Added copy on the bet card: “Network fee: ~$0 (you pay a tiny amount of SOL for gas)” so the amount in the next screen is clearly the bet, not a fee.
- **Files:** `apps/web/components/mobile/MobileMarketCard.tsx`

### Bet Success UI
- **Issue:** Web mobile used a full-screen green overlay (“Bet Placed!”) instead of the previous white modal that then advanced to the next market.
- **Change:** Replaced with a white modal (dark backdrop, white card, green check) and kept “Moving to next market…” / “Tap anywhere to stay”.
- **Files:** `apps/web/components/mobile/BetSuccessOverlay.tsx`

---

## Appendix: All File Paths Referenced

### Transaction Flows
- `apps/web/components/Cliques/SubmitMarketModal.tsx`
- `apps/web/app/api/markets/build-create-tx/route.ts`
- `apps/web/app/app/markets/[id]/page.tsx`
- `apps/web/app/app/profile/page.tsx`
- `apps/web/app/app/profile/settings/page.tsx`
- `apps/web/lib/solana/permissionless.ts`

### Dead Code
- `apps/web/lib/sponsoredTransaction.ts`
- `apps/web/app/api/sponsor-transaction/route.ts`
- `apps/web/scripts/generate-fee-payer.ts`

### Onboarding
- `apps/web/app/app/layout.tsx`
- `apps/web/components/CopyWalletModal.tsx`
- `apps/web/components/OnboardingModal.tsx`
- `apps/web/app/privy-provider.tsx`

### RPC Configuration
- `apps/web/app/api/cron/collect-protocol-fees/route.ts`
- `apps/web/app/api/cron/resolve-onchain-markets/route.ts`
- `apps/web/app/api/admin/sync-all-onchain-bets/route.ts`
