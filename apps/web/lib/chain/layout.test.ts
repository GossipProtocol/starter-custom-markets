/**
 * Decodes the account bytes the Rust program serialised into
 * `tests/fixtures/accounts.json` (written by `cargo test -p cue-solana` from
 * the structs in `programs/cue-solana/src/lib.rs`). If a field moves on
 * chain, this fails before the reconcile cron can write a wrong pool into
 * the database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeMarket, decodePosition, POSITION_ACCOUNT_SIZE } from './layout';

const fx = JSON.parse(readFileSync(join(__dirname, '../../../../tests/fixtures/accounts.json'), 'utf8'));

test('Market decodes field for field', () => {
  const m = decodeMarket(Buffer.from(fx.market_hex, 'hex'));
  assert.equal(m.marketIdHex, '07'.repeat(32));
  assert.equal(m.status, 'resolved');
  assert.equal(m.outcome, 'resolved');
  assert.equal(m.numOptions, fx.market.num_options);
  assert.deepEqual(m.pools, fx.market.pools.slice(0, 3).map(BigInt));
  assert.deepEqual(m.sharesTotal, fx.market.shares_total.slice(0, 3).map(BigInt));
  assert.equal(m.resolveTimestamp, BigInt(fx.market.resolve_timestamp));
  assert.equal(m.resolvedTimestamp, BigInt(fx.market.resolved_timestamp));
  assert.equal(m.protocolFeeBps, fx.market.protocol_fee_bps);
  assert.equal(m.winningOption, fx.market.winning_option);
  assert.equal(m.feesAccrued, BigInt(fx.market.fees_accrued));
  assert.equal(m.feesWithdrawn, fx.market.fees_withdrawn);
  assert.equal(m.authority, fx.market.authority);
});

test('UserPosition decodes field for field and has the expected size', () => {
  const bytes = Buffer.from(fx.position_hex, 'hex');
  assert.equal(bytes.length, POSITION_ACCOUNT_SIZE);
  const p = decodePosition(bytes);
  assert.equal(p.user, fx.position.user);
  assert.equal(p.market, fx.position.market);
  assert.equal(p.option, fx.position.option);
  assert.equal(p.stakeAmount, BigInt(fx.position.stake_amount));
  assert.equal(p.shares, BigInt(fx.position.shares));
  assert.equal(p.claimed, fx.position.claimed);
});

test('a wrong discriminator is rejected', () => {
  assert.throws(() => decodeMarket(Buffer.from(fx.position_hex, 'hex')), /not a Market/);
});
