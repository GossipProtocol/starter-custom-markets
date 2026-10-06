/**
 * Instruction builders for the audited program.
 *
 * Account order and argument encoding mirror the `#[derive(Accounts)]`
 * structs and instruction signatures in `programs/cue-solana/src/lib.rs`.
 * Change both or neither. Discriminators come from `instructionDiscriminator`
 * so a renamed instruction fails loudly instead of sending the wrong bytes.
 */
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { instructionDiscriminator } from './layout';
import { marketPda, positionPda, programId, usdcAta, usdcMint, vaultAta } from './pdas';

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const i64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(n);
  return b;
};
const optionU16 = (n: number | null) => (n === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), u16(n)]));

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });

/** `create_market(market_id, num_options, resolve_timestamp, fee_bps)`.
 *  `authority` must be one of the program's `ADMIN_WALLETS`. */
export function createMarketIx(params: {
  authority: PublicKey;
  marketIdHex: string;
  numOptions: number;
  resolveTimestamp: bigint;
  feeBps: number;
}): TransactionInstruction {
  const { authority, marketIdHex, numOptions, resolveTimestamp, feeBps } = params;
  const market = marketPda(marketIdHex);
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      meta(market, true),
      meta(vaultAta(market), true),
      meta(usdcMint()),
      meta(authority, true, true),
      meta(SystemProgram.programId),
      meta(TOKEN_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(SYSVAR_RENT_PUBKEY),
    ],
    data: Buffer.concat([
      instructionDiscriminator('create_market'),
      Buffer.from(marketIdHex, 'hex'),
      Buffer.from([numOptions]),
      i64(resolveTimestamp),
      u16(feeBps),
    ]),
  });
}

/** `place_bet(option, amount, min_payout_bps)`. The user pays the position
 *  rent (`payer = user` in the program); a sponsor can only pay the
 *  transaction fee, at the transaction level. */
export function placeBetIx(params: {
  user: PublicKey;
  market: PublicKey;
  option: number;
  amount: bigint;
  minPayoutBps: number | null;
}): TransactionInstruction {
  const { user, market, option, amount, minPayoutBps } = params;
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      meta(market, true),
      meta(positionPda(market, user), true),
      meta(vaultAta(market), true),
      meta(usdcAta(user), true),
      meta(usdcMint()),
      meta(user, true, true),
      meta(TOKEN_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([instructionDiscriminator('place_bet'), Buffer.from([option]), u64(amount), optionU16(minPayoutBps)]),
  });
}

/** `resolve_market()`. Permissionless: the only account is the market. */
export function resolveMarketIx(market: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: programId(),
    keys: [meta(market, true)],
    data: instructionDiscriminator('resolve_market'),
  });
}

/** `claim_payout()` or `claim_refund()`. Same accounts, different
 *  discriminator; the market's status decides which one applies. */
export function claimIx(kind: 'payout' | 'refund', user: PublicKey, market: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      meta(market, true),
      meta(positionPda(market, user), true),
      meta(vaultAta(market), true),
      meta(usdcAta(user), true),
      meta(usdcMint()),
      meta(user, false, true),
      meta(TOKEN_PROGRAM_ID),
    ],
    data: instructionDiscriminator(kind === 'payout' ? 'claim_payout' : 'claim_refund'),
  });
}

/** `emergency_cancel()`. Admin only. */
export function emergencyCancelIx(admin: PublicKey, market: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: programId(),
    keys: [meta(market, true), meta(admin, false, true)],
    data: instructionDiscriminator('emergency_cancel'),
  });
}

/** `withdraw_fees()`. Admin only, after the 24 hour cooldown. `treasury` is
 *  a USDC token account owned by the program's `PROTOCOL_TREASURY`; the
 *  program rejects any other owner. */
export function withdrawFeesIx(admin: PublicKey, market: PublicKey, treasury: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      meta(market, true),
      meta(vaultAta(market), true),
      meta(treasury, true),
      meta(usdcMint()),
      meta(admin, false, true),
      meta(TOKEN_PROGRAM_ID),
    ],
    data: instructionDiscriminator('withdraw_fees'),
  });
}

/** `admin_withdraw_stuck_funds(amount)`. Market authority only, on a
 *  settled market. The app never calls this; the builder exists so the
 *  README's hardening exercise on bounding it has something to test. */
export function adminWithdrawStuckFundsIx(authority: PublicKey, market: PublicKey, amount: bigint): TransactionInstruction {
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      meta(authority, true, true),
      meta(market, true),
      meta(vaultAta(market), true),
      meta(usdcAta(authority), true),
      meta(usdcMint()),
      meta(TOKEN_PROGRAM_ID),
    ],
    data: Buffer.concat([instructionDiscriminator('admin_withdraw_stuck_funds'), u64(amount)]),
  });
}
