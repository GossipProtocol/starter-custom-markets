/**
 * Account decoding for the audited program, without an IDL.
 *
 * The product this came from decoded `Market` with fixed byte offsets copied
 * from an older version of the struct. The offsets were wrong for a year and
 * the sync cron wrote nonsense pools into the database. This file reads the
 * Borsh layout field by field with a cursor, in the order the structs in
 * `programs/cue-solana/src/lib.rs` declare them, so an `Option` that is
 * `None` (one byte) or `Some` (two bytes) cannot shift anything, and
 * `layout.test.ts` checks it against `tests/fixtures/accounts.json`, which
 * `cargo test` writes from the Rust structs.
 *
 * Discriminators are derived from the Anchor naming rule, never pasted.
 */
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

export const MAX_OPTIONS = 7;

export function accountDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
}

export function instructionDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

/** `MarketStatus` in lib.rs: Open = 0, Resolved = 1, Cancelled = 2. */
export type MarketStatus = 'open' | 'resolved' | 'cancelled';
/** `MarketOutcome` in lib.rs: Unresolved = 0, Resolved = 1, Invalid = 2. */
export type MarketOutcome = 'unresolved' | 'resolved' | 'invalid';

/** `Market` in lib.rs, field for field. */
export type OnChainMarket = {
  marketIdHex: string;
  bump: number;
  status: MarketStatus;
  outcome: MarketOutcome;
  numOptions: number;
  pools: bigint[];
  sharesTotal: bigint[];
  resolveTimestamp: bigint;
  resolvedTimestamp: bigint;
  protocolFeeBps: number;
  winningOption: number | null;
  feesAccrued: bigint;
  feesWithdrawn: boolean;
  authority: string;
};

/** `UserPosition` in lib.rs, field for field. */
export type OnChainPosition = {
  user: string;
  market: string;
  bump: number;
  option: number;
  stakeAmount: bigint;
  shares: bigint;
  claimed: boolean;
};

class Reader {
  private o = 0;
  constructor(private readonly b: Buffer) {}
  u8() {
    return this.b.readUInt8(this.o++);
  }
  bool() {
    return this.u8() === 1;
  }
  u16() {
    const v = this.b.readUInt16LE(this.o);
    this.o += 2;
    return v;
  }
  u64() {
    const v = this.b.readBigUInt64LE(this.o);
    this.o += 8;
    return v;
  }
  i64() {
    const v = this.b.readBigInt64LE(this.o);
    this.o += 8;
    return v;
  }
  u128() {
    const lo = this.b.readBigUInt64LE(this.o);
    const hi = this.b.readBigUInt64LE(this.o + 8);
    this.o += 16;
    return (hi << 64n) | lo;
  }
  bytes(n: number) {
    const v = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return v;
  }
  pubkey() {
    return new PublicKey(this.bytes(32)).toBase58();
  }
  optionU8(): number | null {
    return this.u8() === 1 ? this.u8() : null;
  }
}

function expectDiscriminator(data: Buffer, name: string) {
  if (!data.subarray(0, 8).equals(accountDiscriminator(name))) {
    throw new Error(`not a ${name} account`);
  }
}

export function decodeMarket(data: Buffer): OnChainMarket {
  expectDiscriminator(data, 'Market');
  const r = new Reader(data.subarray(8));
  const marketIdHex = Buffer.from(r.bytes(32)).toString('hex');
  const bump = r.u8();
  const status = (['open', 'resolved', 'cancelled'] as const)[r.u8()];
  const outcome = (['unresolved', 'resolved', 'invalid'] as const)[r.u8()];
  const numOptions = r.u8();
  const pools = Array.from({ length: MAX_OPTIONS }, () => r.u64());
  const sharesTotal = Array.from({ length: MAX_OPTIONS }, () => r.u128());
  return {
    marketIdHex,
    bump,
    status,
    outcome,
    numOptions,
    pools: pools.slice(0, numOptions),
    sharesTotal: sharesTotal.slice(0, numOptions),
    resolveTimestamp: r.i64(),
    resolvedTimestamp: r.i64(),
    protocolFeeBps: r.u16(),
    winningOption: r.optionU8(),
    feesAccrued: r.u64(),
    feesWithdrawn: r.bool(),
    authority: r.pubkey(),
  };
}

export function decodePosition(data: Buffer): OnChainPosition {
  expectDiscriminator(data, 'UserPosition');
  const r = new Reader(data.subarray(8));
  return {
    user: r.pubkey(),
    market: r.pubkey(),
    bump: r.u8(),
    option: r.u8(),
    stakeAmount: r.u64(),
    shares: r.u128(),
    claimed: r.bool(),
  };
}

/** Byte size of a serialised UserPosition (8 + UserPosition::SIZE), for
 *  `getProgramAccounts` filters. */
export const POSITION_ACCOUNT_SIZE = 8 + 32 + 32 + 1 + 1 + 8 + 16 + 1;
/** Offset of `market` inside a UserPosition, for a memcmp filter. */
export const POSITION_MARKET_OFFSET = 8 + 32;
