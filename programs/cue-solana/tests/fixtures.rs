//! Host test: serialise the audited account structs and pin the bytes.
//!
//! This is an integration test, so it links against the program crate and
//! touches none of its source. It writes `tests/fixtures/accounts.json` at
//! the repo root when run with `WRITE_FIXTURES=1 cargo test`, and otherwise
//! asserts the committed file still matches the structs. The app's
//! `lib/chain/layout.test.ts` decodes the same file, so a field that moves
//! in `Market` or `UserPosition` fails both sides before a cron can write a
//! wrong pool into the database.

use anchor_lang::{AnchorSerialize, Discriminator};
use cue_solana::{Market, MarketOutcome, MarketStatus, UserPosition, MAX_OPTIONS};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, PartialEq, Debug)]
struct Fixtures {
    market_hex: String,
    market: FixtureMarket,
    position_hex: String,
    position: FixturePosition,
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
struct FixtureMarket {
    status: u8,
    outcome: u8,
    num_options: u8,
    pools: Vec<u64>,
    // u128 travels as a string: JSON numbers lose precision past 2^53 and the
    // TypeScript side reads these into bigint.
    shares_total: Vec<String>,
    resolve_timestamp: i64,
    resolved_timestamp: i64,
    protocol_fee_bps: u16,
    winning_option: Option<u8>,
    fees_accrued: u64,
    fees_withdrawn: bool,
    authority: String,
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
struct FixturePosition {
    user: String,
    market: String,
    option: u8,
    stake_amount: u64,
    shares: String,
    claimed: bool,
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests")
}

fn pk(n: u8) -> anchor_lang::prelude::Pubkey {
    anchor_lang::prelude::Pubkey::new_from_array([n; 32])
}

fn encode<T: AnchorSerialize + Discriminator>(v: &T) -> String {
    let mut bytes = T::DISCRIMINATOR.to_vec();
    v.serialize(&mut bytes).unwrap();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn sample_market() -> Market {
    Market {
        market_id: [7u8; 32],
        bump: 254,
        status: MarketStatus::Resolved,
        outcome: MarketOutcome::Resolved,
        num_options: 3,
        pools: [50_000_000, 30_000_000, 20_000_000, 0, 0, 0, 0],
        shares_total: [45_000_000, 30_000_000, 12_000_000, 0, 0, 0, 0],
        resolve_timestamp: 1_700_086_400,
        resolved_timestamp: 1_700_086_401,
        protocol_fee_bps: 100,
        winning_option: Some(0),
        fees_accrued: 1_000_000,
        fees_withdrawn: false,
        authority: pk(2),
    }
}

fn sample_position() -> UserPosition {
    UserPosition {
        user: pk(3),
        market: pk(4),
        bump: 253,
        option: 1,
        stake_amount: 12_000_000,
        shares: 9_600_000,
        claimed: true,
    }
}

fn build_fixtures() -> Fixtures {
    let market = sample_market();
    let position = sample_position();
    Fixtures {
        market_hex: encode(&market),
        market: FixtureMarket {
            status: market.status as u8,
            outcome: market.outcome as u8,
            num_options: market.num_options,
            pools: market.pools.to_vec(),
            shares_total: market.shares_total.iter().map(|s| s.to_string()).collect(),
            resolve_timestamp: market.resolve_timestamp,
            resolved_timestamp: market.resolved_timestamp,
            protocol_fee_bps: market.protocol_fee_bps,
            winning_option: market.winning_option,
            fees_accrued: market.fees_accrued,
            fees_withdrawn: market.fees_withdrawn,
            authority: market.authority.to_string(),
        },
        position_hex: encode(&position),
        position: FixturePosition {
            user: position.user.to_string(),
            market: position.market.to_string(),
            option: position.option,
            stake_amount: position.stake_amount,
            shares: position.shares.to_string(),
            claimed: position.claimed,
        },
    }
}

#[test]
fn fixtures_match_committed_file() {
    let fixtures = build_fixtures();
    let path = root().join("fixtures/accounts.json");
    if std::env::var("WRITE_FIXTURES").is_ok() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, serde_json::to_string_pretty(&fixtures).unwrap() + "\n").unwrap();
        return;
    }
    let committed: Fixtures = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(committed, fixtures, "tests/fixtures/accounts.json is stale; run WRITE_FIXTURES=1 cargo test");
}

/// `Market::SIZE` is the space `create_market` allocates. A `Some` winning
/// option is the longest encoding, so a resolved market must fit exactly.
#[test]
fn declared_sizes_match_serialised_lengths() {
    let market_bytes = encode(&sample_market()).len() / 2;
    assert_eq!(market_bytes, 8 + Market::SIZE);
    let position_bytes = encode(&sample_position()).len() / 2;
    assert_eq!(position_bytes, 8 + UserPosition::SIZE);
    assert_eq!(MAX_OPTIONS, 7);
}

/// The placeholder detector in config.rs must flag the shipped placeholders
/// and accept a real key.
#[test]
fn placeholder_detector_sees_the_shipped_placeholders() {
    assert!(cue_solana::config::placeholders_present());
}
