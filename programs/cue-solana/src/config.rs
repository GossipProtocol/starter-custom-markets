//! Deployment configuration. This is the one file a deployer edits.
//!
//! Everything in `lib.rs` is the audited program, byte for byte apart from the
//! placeholder program id. The three wallets below were hardcoded byte arrays
//! in the audited `lib.rs`; they moved here so the values can change without
//! touching the audited logic. The logic that reads them (`is_admin`, the
//! treasury owner check in `withdraw_fees`) is unchanged.
//!
//! `PROTOCOL_TREASURY` is set to the course's wallet. Replace the two hot
//! wallet placeholders with real keys before `anchor build`. Paste a base58
//! address with the `pubkey!` macro, the way `PROTOCOL_TREASURY` does.
//!
//! A build that still carries the hot wallet placeholders deploys a program
//! nobody but the treasury can administer, because no keypair corresponds to the placeholder bytes.
//! `apps/web/scripts/init-config.ts` checks this before it does anything.

use anchor_lang::prelude::*;

/// The protocol fee recipient: the course's wallet. `withdraw_fees` moves each resolved market's
/// fee to a USDC token account owned by this key and to nowhere else. For
/// the course this is the course fee wallet; keep it in step with
/// `COURSE_FEE_RECIPIENT` in `apps/web/lib/course-fee.ts`, which is what
/// the cron passes as the destination account.
///
/// This key is also an admin (see `ADMIN_WALLETS`), exactly as in the
/// audited program, where it was a Squads multisig.
pub const PROTOCOL_TREASURY: Pubkey = pubkey!("AcRs3Zxfk5VvQYr7JuRQiNsJzQduCxJMFLPMozagPrME");

/// REPLACE_WITH_ADMIN_WALLET_1
///
/// First hot wallet. Admins are the only keys that can `create_market`,
/// `emergency_cancel` and `withdraw_fees`. The web app signs market
/// creation with a Privy embedded wallet and fee withdrawal with the
/// server's `ADMIN_SECRET_KEY`; put those two keys here and in
/// `HOT_WALLET_2`, and list them in `MARKET_ADMIN_WALLETS` in the app env.
pub const HOT_WALLET_1: Pubkey = Pubkey::new_from_array([0xA1; 32]);

/// REPLACE_WITH_ADMIN_WALLET_2
///
/// Second hot wallet. See `HOT_WALLET_1`.
pub const HOT_WALLET_2: Pubkey = Pubkey::new_from_array([0xA2; 32]);

/// Authorized market creators. The list and its order are the audited
/// program's; only the values moved.
pub const ADMIN_WALLETS: [Pubkey; 3] = [
    PROTOCOL_TREASURY, // Treasury (auto-synced with the fee recipient)
    HOT_WALLET_1,      // Hot wallet 1
    HOT_WALLET_2,      // Hot wallet 2
];

/// True while any wallet above is still a placeholder. Used by host tests
/// so a fork cannot ship the placeholders by accident.
pub fn placeholders_present() -> bool {
    let is_placeholder = |k: &Pubkey| {
        let b = k.to_bytes();
        b.iter().all(|x| *x == b[0])
    };
    ADMIN_WALLETS.iter().any(is_placeholder)
}
