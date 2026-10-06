use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;

// Anchor's placeholder id. After `anchor keys sync` the real id lands here, in
// Anchor.toml and in the app env (NEXT_PUBLIC_MARKETS_PROGRAM_ID).
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// Deployer-edited wallets (treasury, hot wallets, admin list). The values
// lived here as byte arrays in the audited source; they moved to config.rs so
// a deployer edits one file outside the audited logic.
pub mod config;
pub use config::{ADMIN_WALLETS, HOT_WALLET_1, HOT_WALLET_2, PROTOCOL_TREASURY};

// ============================================
// CONSTANTS
// ============================================

// Market Options
pub const MAX_OPTIONS: usize = 7;
pub const MIN_OPTIONS: usize = 2;

// Betting Limits
pub const MIN_BET: u64 = 1_000_000; // 1 USDC minimum bet

// Fee Limits
pub const MAX_FEE_BPS: u16 = 1000; // 10% max protocol fee

// Time Constants
pub const TIME_BUFFER: i64 = 300; // 5 minute buffer for clock manipulation
// Time-weighted pricing: GENTLER CURVE
// - First 50% of market: full 1.0x multiplier (early bird bonus)
// - Last 50% of market: linear decay from 1.0x to 0.6x
// Example (24h market): 0-12h = 1.0x, 18h = 0.8x, 23h = 0.62x, 24h = 0.6x
pub const LATE_BET_WINDOW_SECS: i64 = 24 * 60 * 60; // 24 hours - full market duration
pub const FEE_WITHDRAWAL_COOLDOWN_SECS: i64 = 24 * 60 * 60; // 24 hours after resolution

// Late Bet Protection
// Cap window is the final 15 minutes - separate from the 24-hour time-weighted decay window
pub const LATE_BET_CAP_WINDOW_SECS: i64 = 15 * 60; // 15 minutes before resolution
// Effective cap = max(10% of pool, MIN_BET) - allows MIN_BET in small pools
pub const LATE_BET_CAP_BPS: u64 = 1000; // 10% of pool (before MIN_BET floor)

// Time-weighted Pricing Constants
pub const MULTIPLIER_SCALE_BPS: u64 = 10_000; // 1.0 = 10000 basis points
pub const MIN_MULTIPLIER_BPS: u64 = 6_000; // 0.6 = 6000 (late bettors get 60% shares - gentler curve)

// Basis Points Denominator
pub const BPS_DENOMINATOR: u64 = 10_000; // Standard basis points (100% = 10000)

// Official USDC Mint Addresses
// Mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
// Devnet: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
#[cfg(feature = "mainnet")]
pub const USDC_MINT: Pubkey = Pubkey::new_from_array([
    0xc6, 0xfa, 0x7a, 0xf3, 0xbe, 0xdb, 0xad, 0x3a,
    0x3d, 0x65, 0xf3, 0x6a, 0xab, 0xc9, 0x74, 0x31,
    0xb1, 0xbb, 0xe4, 0xc2, 0xd2, 0xf6, 0xe0, 0xe4,
    0x7c, 0xa6, 0x02, 0x03, 0x45, 0x2f, 0x5d, 0x61,
]);
#[cfg(not(feature = "mainnet"))]
pub const USDC_MINT: Pubkey = Pubkey::new_from_array([
    0x3b, 0x44, 0x2c, 0xb3, 0x91, 0x21, 0x57, 0xf1,
    0x3a, 0x93, 0x3d, 0x01, 0x34, 0x28, 0x2d, 0x03,
    0x2b, 0x5f, 0xfe, 0xcd, 0x01, 0xa2, 0xdb, 0xf1,
    0xb7, 0x79, 0x06, 0x08, 0xdf, 0x00, 0x2e, 0xa7,
]);

// ============================================
// HELPER FUNCTIONS
// ============================================

/// Check if a pubkey is an authorized admin
fn is_admin(pubkey: &Pubkey) -> bool {
    ADMIN_WALLETS.contains(pubkey)
}

/// Calculate time-weighted multiplier for share allocation.
/// 
/// GENTLER CURVE: Full bonus for first 50%, then gradual decay:
/// - 0-50% of market duration: 1.0x shares per dollar (full bonus)
/// - 50-100% of market duration: linear decay from 1.0x to 0.6x
///
/// Example for 24-hour market:
/// - 0-12h: 1.0x (full bonus period)
/// - 18h: 0.8x
/// - 23h: 0.62x
/// - 24h: 0.6x (minimum)
///
/// The TIME_BUFFER (5 minutes) stops betting slightly before the deadline
/// to prevent clock manipulation attacks.
/// 
/// # Returns
/// Multiplier in basis points (10000 = 1.0x, 6000 = 0.6x)
fn time_multiplier_bps(now: i64, deadline: i64) -> Result<u64> {
    let market_start = deadline.checked_sub(LATE_BET_WINDOW_SECS).ok_or(CueError::Overflow)?;
    
    // Before market start: full multiplier
    if now <= market_start {
        return Ok(MULTIPLIER_SCALE_BPS);
    }
    
    // At or after deadline: minimum multiplier
    if now >= deadline {
        return Ok(MIN_MULTIPLIER_BPS);
    }

    // Calculate time ratio (0.0 to 1.0 as the market progresses)
    let elapsed = (now - market_start) as u64;
    let total_duration = LATE_BET_WINDOW_SECS as u64;
    
    // First 50% of market: full 1.0x multiplier
    let halfway = total_duration / 2;
    if elapsed <= halfway {
        return Ok(MULTIPLIER_SCALE_BPS);
    }
    
    // Remaining 50%: linear decay from 1.0x to 0.6x
    // elapsed_in_decay_window = how far into the second half we are
    let elapsed_in_decay = elapsed - halfway;
    let decay_window = total_duration - halfway; // second half duration
    
    // Calculate decay: 0 at start of second half, full at end
    // decay_amount = (elapsed_in_decay / decay_window) * (1.0x - 0.6x)
    let decay = elapsed_in_decay
        .checked_mul(MULTIPLIER_SCALE_BPS - MIN_MULTIPLIER_BPS)
        .ok_or(CueError::Overflow)?
        .checked_div(decay_window)
        .ok_or(CueError::Overflow)?;
    
    Ok(MULTIPLIER_SCALE_BPS - decay)
}

// ============================================
// PROGRAM
// ============================================

#[program]
pub mod cue_solana {
    use super::*;

    /// Create a new opinion market with USDC vault.
    /// 
    /// Opinion markets have a fixed end date and resolve based on which option
    /// has the most stake at the deadline. Early bettors receive more shares
    /// per dollar due to time-weighted pricing.
    /// 
    /// # Arguments
    /// * `market_id` - Unique identifier for this market (32 bytes)
    /// * `num_options` - Number of options (2-7)
    /// * `resolve_timestamp` - When market resolves (unix timestamp)
    /// * `fee_bps` - Protocol fee in basis points (max 1000 = 10%)
    /// 
    /// # Access Control
    /// Only authorized admins can create markets.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: [u8; 32],
        num_options: u8,
        resolve_timestamp: i64,
        fee_bps: u16,
    ) -> Result<()> {
        let clock = Clock::get()?;
        
        // Access control: only authorized admins
        require!(
            is_admin(&ctx.accounts.authority.key()),
            CueError::Unauthorized
        );
        
        // Validate option count (2-7 options)
        require!(
            num_options >= MIN_OPTIONS as u8 && num_options <= MAX_OPTIONS as u8,
            CueError::InvalidOptionCount
        );
        
        // Validate USDC mint (must be official USDC)
        require!(
            ctx.accounts.usdc_mint.key() == USDC_MINT,
            CueError::InvalidMint
        );
        
        // Validate fee bounds (max 10%)
        require!(fee_bps <= MAX_FEE_BPS, CueError::FeeTooHigh);
        
        // Validate timestamp with buffer for clock manipulation protection
        require!(
            resolve_timestamp > clock.unix_timestamp + TIME_BUFFER,
            CueError::InvalidTime
        );
        
        let market = &mut ctx.accounts.market;
        
        market.market_id = market_id;
        market.bump = ctx.bumps.market;
        market.status = MarketStatus::Open;
        market.outcome = MarketOutcome::Unresolved;
        market.num_options = num_options;
        market.pools = [0u64; MAX_OPTIONS];
        market.shares_total = [0u128; MAX_OPTIONS];
        market.resolve_timestamp = resolve_timestamp;
        market.resolved_timestamp = 0;
        market.protocol_fee_bps = fee_bps;
        market.winning_option = None;
        market.fees_accrued = 0;
        market.fees_withdrawn = false;
        market.authority = ctx.accounts.authority.key();
        
        emit!(MarketCreated {
            market: ctx.accounts.market.key(),
            market_id,
            num_options,
            resolve_timestamp,
            authority: ctx.accounts.authority.key(),
        });
        
        msg!("Opinion market created with {} options: {:?}", num_options, market_id);
        Ok(())
    }

    /// Place a bet on any option (0 to num_options-1).
    /// 
    /// # Arguments
    /// * `option` - Option index to bet on (0-indexed)
    /// * `amount` - Amount of USDC to bet (minimum 1 USDC)
    /// * `min_payout_bps` - Optional slippage protection (e.g., 15000 = expect 1.5x minimum)
    /// 
    /// # Time-Weighted Shares
    /// Early bettors receive more shares per dollar. In the final 15 minutes before
    /// the deadline, shares decay linearly from 1.0x to 0.5x. This incentivizes
    /// early participation and reduces last-minute manipulation.
    /// 
    /// # Slippage Protection
    /// Use `min_payout_bps` to protect against odds changes between transaction
    /// submission and execution. Transaction fails if expected payout drops below threshold.
    pub fn place_bet(
        ctx: Context<PlaceBet>,
        option: u8,
        amount: u64,
        min_payout_bps: Option<u16>,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        
        // === GUARDS ===
        require!(market.status == MarketStatus::Open, CueError::MarketNotOpen);
        require!(option < market.num_options, CueError::InvalidOption);
        require!(amount >= MIN_BET, CueError::BetTooSmall);
        
        // Check trading is still open (with buffer for clock manipulation protection)
        // Using <= so the final moment (deadline - TIME_BUFFER) is included for clean 100% → 50% decay
        require!(
            now <= market.resolve_timestamp - TIME_BUFFER,
            CueError::TradingClosed
        );
        
        // Slippage protection: verify expected payout before betting
        // Uses share-based calculation to match actual claim_payout logic
        if let Some(min_bps) = min_payout_bps {
            let total_pool: u64 = market.pools[..market.num_options as usize]
                .iter()
                .copied()
                .sum();
            
            // Calculate shares this bet will mint (time-weighted)
            let multiplier = time_multiplier_bps(now, market.resolve_timestamp)?;
            let shares_to_mint: u128 = (amount as u128)
                .checked_mul(multiplier as u128)
                .ok_or(CueError::Overflow)?
                .checked_div(BPS_DENOMINATOR as u128)
                .ok_or(CueError::Overflow)?;
            
            // Calculate new total shares for this option after bet
            let current_option_shares = market.shares_total[option as usize];
            let new_option_shares = current_option_shares
                .checked_add(shares_to_mint)
                .ok_or(CueError::Overflow)?;
            
            // Calculate new total pool after bet
            let new_total = total_pool.checked_add(amount).ok_or(CueError::Overflow)?;
            
            // Calculate fee to match actual payout logic in claim_payout
            let fee = new_total
                .checked_mul(market.protocol_fee_bps as u64)
                .ok_or(CueError::Overflow)?
                .checked_div(BPS_DENOMINATOR)
                .ok_or(CueError::Overflow)?;
            let distributable = new_total.checked_sub(fee).ok_or(CueError::Overflow)?;
            
            // Expected payout = distributable * user_shares / total_option_shares
            let expected_payout = (distributable as u128)
                .checked_mul(shares_to_mint)
                .ok_or(CueError::Overflow)?
                .checked_div(new_option_shares)
                .ok_or(CueError::Overflow)?;
            
            // Expected payout ratio in basis points (10000 = 1x, 20000 = 2x)
            // payout_bps = expected_payout * BPS_DENOMINATOR / amount
            let expected_payout_bps = expected_payout
                .checked_mul(BPS_DENOMINATOR as u128)
                .ok_or(CueError::Overflow)?
                .checked_div(amount as u128)
                .ok_or(CueError::Overflow)?;
            
            require!(
                expected_payout_bps >= min_bps as u128,
                CueError::SlippageExceeded
            );
        }
        
        // Late bet cap: In final 15 minutes, limit cumulative bets to max(10% of pool, MIN_BET)
        // This prevents large last-minute bets from manipulating outcomes while still
        // allowing at least MIN_BET (1 USDC) in very small pools where 10% < 1 USDC
        let total_pool: u64 = market.pools[..market.num_options as usize]
            .iter()
            .copied()
            .sum();
        
        // Use LATE_BET_CAP_WINDOW_SECS (15 min) for cap check, NOT LATE_BET_WINDOW_SECS (24 hr for time-weighted)
        if now >= market.resolve_timestamp - LATE_BET_CAP_WINDOW_SECS {
            let cap = total_pool
                .checked_mul(LATE_BET_CAP_BPS)
                .ok_or(CueError::Overflow)?
                .checked_div(BPS_DENOMINATOR)
                .ok_or(CueError::Overflow)?;
            // Floor at MIN_BET to allow betting in small pools (effective cap = max(10%, 1 USDC))
            let cap = cap.max(MIN_BET);
            // Check cumulative bet amount (prevents bypass via multiple small bets)
            let cumulative_bet = position.stake_amount.checked_add(amount).ok_or(CueError::Overflow)?;
            require!(cumulative_bet <= cap, CueError::LateBetCapExceeded);
        }
        
        // Calculate time-weighted shares: early bettors get more shares per dollar
        let m_bps = time_multiplier_bps(now, market.resolve_timestamp)?;
        
        // shares_minted = amount * multiplier_bps / BPS_DENOMINATOR
        let shares_minted: u128 = (amount as u128)
            .checked_mul(m_bps as u128)
            .ok_or(CueError::Overflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(CueError::Overflow)?;
        
        require!(shares_minted > 0, CueError::InvalidAmount);
        
        // === EFFECTS ===
        // Update pool and shares for the selected option
        market.pools[option as usize] = market.pools[option as usize]
            .checked_add(amount)
            .ok_or(CueError::Overflow)?;
        
        market.shares_total[option as usize] = market.shares_total[option as usize]
            .checked_add(shares_minted)
            .ok_or(CueError::Overflow)?;
        
        // Initialize or update position
        if position.stake_amount == 0 {
            position.user = ctx.accounts.user.key();
            position.market = market.key();
            position.bump = ctx.bumps.position;
            position.option = option;
            position.shares = 0;
        } else {
            // User can only bet on one option per position account
            require!(position.option == option, CueError::DifferentOptionPosition);
        }
        
        position.stake_amount = position.stake_amount
            .checked_add(amount)
            .ok_or(CueError::Overflow)?;
        position.shares = position.shares
            .checked_add(shares_minted)
            .ok_or(CueError::Overflow)?;
        position.claimed = false;
        
        // === INTERACTIONS ===
        // Transfer USDC from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_usdc.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), amount)?;
        
        emit!(BetPlaced {
            market: market.key(),
            user: ctx.accounts.user.key(),
            option,
            amount,
            new_pool_total: market.pools[option as usize],
        });
        
        msg!("Bet placed: {:?} {} USDC on option {}", ctx.accounts.user.key(), amount, option);
        Ok(())
    }

    /// Resolve market by stake majority (permissionless).
    /// 
    /// Anyone can call this after the resolution timestamp. The option with 
    /// the highest stake wins. In case of an exact tie, the market is cancelled 
    /// and all users receive refunds.
    /// 
    /// # Access Control
    /// Permissionless - anyone can resolve after deadline.
    /// 
    /// # Tie-Breaking Policy
    /// If multiple options have exactly equal stakes, the market is cancelled to
    /// prevent arbitrary advantage to lower-indexed options. This is the fairest
    /// approach and eliminates potential manipulation.
    pub fn resolve_market(ctx: Context<ResolveMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let clock = Clock::get()?;
        
        require!(market.status == MarketStatus::Open, CueError::MarketNotOpen);
        require!(
            clock.unix_timestamp >= market.resolve_timestamp,
            CueError::TooEarly
        );
        
        // Calculate total pool across all options
        let total_pool: u64 = market.pools[..market.num_options as usize]
            .iter()
            .copied()
            .sum();
        
        // Edge case: no bets or below minimum threshold
        if total_pool < MIN_BET {
            market.outcome = MarketOutcome::Invalid;
            market.status = MarketStatus::Cancelled;
            market.resolved_timestamp = clock.unix_timestamp;
            
            emit!(MarketCancelled {
                market: ctx.accounts.market.key(),
                reason: "No bets or below minimum threshold".to_string(),
            });
            
            msg!("Market cancelled: insufficient bets");
            return Ok(());
        }
        
        // Find winning option (highest pool)
        // TIE-BREAKING RULE: If multiple options have equal highest stakes,
        // the market is cancelled and all users receive refunds.
        let mut winning_option: u8 = 0;
        let mut max_pool: u64 = 0;
        let mut tie_detected = false;
        
        for i in 0..market.num_options as usize {
            if market.pools[i] > max_pool {
                max_pool = market.pools[i];
                winning_option = i as u8;
                tie_detected = false;
            } else if market.pools[i] == max_pool && max_pool > 0 {
                tie_detected = true;
            }
        }
        
        // Cancel market if there's an exact tie
        if tie_detected {
            market.outcome = MarketOutcome::Invalid;
            market.status = MarketStatus::Cancelled;
            market.resolved_timestamp = clock.unix_timestamp;
            
            emit!(MarketCancelled {
                market: ctx.accounts.market.key(),
                reason: "Exact tie between options - refunds available".to_string(),
            });
            
            msg!("Market cancelled: exact tie between options");
            return Ok(());
        }
        
        // Calculate protocol fee (in basis points: fee_bps / 10000)
        let fee = total_pool
            .checked_mul(market.protocol_fee_bps as u64)
            .ok_or(CueError::Overflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(CueError::Overflow)?;
        
        market.outcome = MarketOutcome::Resolved;
        market.status = MarketStatus::Resolved;
        market.winning_option = Some(winning_option);
        market.resolved_timestamp = clock.unix_timestamp;
        market.fees_accrued = market.fees_accrued.checked_add(fee).ok_or(CueError::Overflow)?;
        
        emit!(MarketResolved {
            market: ctx.accounts.market.key(),
            winning_option,
            total_pool,
        });
        
        msg!("Market resolved: option {} wins, {} USDC fee accrued", winning_option, fee);
        Ok(())
    }

    /// Claim payout for winning position.
    /// 
    /// Payouts are proportional to TIME-WEIGHTED SHARES, not raw stake amounts.
    /// This means early bettors receive higher payouts per dollar invested.
    /// 
    /// # Formula
    /// payout = (total_pool - fees) * user_shares / total_shares_for_winning_option
    /// 
    /// # Access Control
    /// Any user with a winning position can claim once.
    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        
        // === CHECKS ===
        require!(market.status == MarketStatus::Resolved, CueError::MarketNotResolved);
        require!(
            market.winning_option == Some(position.option),
            CueError::NotWinner
        );
        require!(!position.claimed, CueError::AlreadyClaimed);
        require!(position.shares > 0, CueError::InvalidAmount);
        
        // Calculate payout using TIME-WEIGHTED SHARES
        let winning_option = market.winning_option.unwrap() as usize;
        
        let total_pool: u64 = market.pools[..market.num_options as usize]
            .iter()
            .copied()
            .sum();
        
        // Calculate distributable amount (total_pool - protocol_fee)
        let fee = total_pool
            .checked_mul(market.protocol_fee_bps as u64)
            .ok_or(CueError::Overflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(CueError::Overflow)?;
        let distributable = total_pool.checked_sub(fee).ok_or(CueError::Overflow)?;
        
        let total_shares = market.shares_total[winning_option];
        require!(total_shares > 0, CueError::InvalidAmount);
        
        // payout = distributable * user_shares / total_shares
        // Early bettors have more shares per $ → get bigger payout!
        let payout_u128 = (distributable as u128)
            .checked_mul(position.shares)
            .ok_or(CueError::Overflow)?
            .checked_div(total_shares)
            .ok_or(CueError::Overflow)?;
        
        let payout: u64 = payout_u128
            .try_into()
            .map_err(|_| CueError::Overflow)?;
        
        // === EFFECTS ===
        // CRITICAL: Set claimed flag BEFORE transfer (checks-effects-interactions pattern)
        position.claimed = true;
        
        // If payout is 0, user's share was too small to receive any reward
        // Do NOT round up to 1 - this breaks accounting and can prevent fee withdrawal
        // or cause the last claimer to be unable to claim their legitimate payout
        // Skip the transfer entirely for 0 payouts (saves compute units)
        if payout > 0 {
            // === INTERACTIONS ===
            let market_id = market.market_id;
            let bump = market.bump;
            let seeds = &[b"market".as_ref(), market_id.as_ref(), &[bump]];
            let signer = &[&seeds[..]];
            
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_usdc.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            token::transfer(
                CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
                payout,
            )?;
        }
        
        emit!(PayoutClaimed {
            market: market.key(),
            user: ctx.accounts.user.key(),
            amount: payout,
        });
        
        msg!("Payout claimed: {} USDC to {:?}", payout, ctx.accounts.user.key());
        Ok(())
    }

    /// Claim refund for cancelled market.
    /// 
    /// Users receive their full stake back (no fees) when a market is cancelled.
    /// This can happen due to:
    /// - Exact tie between options
    /// - Insufficient bets (below minimum threshold)
    /// - Emergency cancellation by admin
    /// 
    /// # Access Control
    /// Position owner only.
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        
        // === CHECKS ===
        require!(market.status == MarketStatus::Cancelled, CueError::MarketNotCancelled);
        require!(!position.claimed, CueError::AlreadyClaimed);
        require!(position.stake_amount > 0, CueError::InvalidAmount);
        
        let refund = position.stake_amount;
        
        // === EFFECTS ===
        // CRITICAL: Set claimed BEFORE transfer
        position.claimed = true;
        
        // === INTERACTIONS ===
        let market_id = market.market_id;
        let bump = market.bump;
        let seeds = &[b"market".as_ref(), market_id.as_ref(), &[bump]];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.user_usdc.to_account_info(),
            authority: ctx.accounts.market.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
            refund,
        )?;
        
        emit!(RefundClaimed {
            market: market.key(),
            user: ctx.accounts.user.key(),
            amount: refund,
        });
        
        msg!("Refund claimed: {} USDC to {:?}", refund, ctx.accounts.user.key());
        Ok(())
    }
    
    /// Emergency cancel by authority (for edge cases).
    /// 
    /// Allows admins to cancel a market in emergency situations, such as:
    /// - Critical bug discovered
    /// - Market created with incorrect parameters
    /// - Real-world event makes market invalid
    /// 
    /// Users receive full refunds (no fees) when a market is emergency cancelled.
    /// 
    /// # Access Control
    /// Only authorized admins (ADMIN_WALLETS).
    pub fn emergency_cancel(ctx: Context<EmergencyCancel>) -> Result<()> {
        // Access control
        require!(
            is_admin(&ctx.accounts.authority.key()),
            CueError::Unauthorized
        );
        
        let market = &mut ctx.accounts.market;
        let clock = Clock::get()?;
        
        require!(
            market.status == MarketStatus::Open,
            CueError::InvalidStatus
        );
        require!(
            market.outcome == MarketOutcome::Unresolved,
            CueError::MarketAlreadyResolved
        );
        
        market.status = MarketStatus::Cancelled;
        market.outcome = MarketOutcome::Invalid;
        market.resolved_timestamp = clock.unix_timestamp;
        
        emit!(MarketCancelled {
            market: ctx.accounts.market.key(),
            reason: "Emergency cancellation by authority".to_string(),
        });
        
        msg!("Market emergency cancelled by authority");
        Ok(())
    }
    
    /// Withdraw protocol fees to Squads Safe after market resolution.
    /// 
    /// Fees can only be withdrawn to the PROTOCOL_TREASURY (Squads Safe).
    /// A 24-hour cooldown period after resolution ensures all user claims
    /// are processed before fee withdrawal.
    /// 
    /// # Access Control
    /// Only authorized admins (ADMIN_WALLETS).
    /// 
    /// # Cooldown Period
    /// Fees cannot be withdrawn until 24 hours after market resolution.
    /// This ensures the vault has sufficient funds for user payouts.
    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        let clock = Clock::get()?;
        
        // Access control
        require!(
            is_admin(&ctx.accounts.authority.key()),
            CueError::Unauthorized
        );
        
        // Verify treasury is owned by PROTOCOL_TREASURY (Squads Safe)
        require!(
            ctx.accounts.treasury.owner == PROTOCOL_TREASURY,
            CueError::InvalidTreasury
        );
        
        // Only allow on resolved markets (cancelled markets have no fees)
        require!(
            ctx.accounts.market.status == MarketStatus::Resolved,
            CueError::InvalidStatus
        );
        require!(!ctx.accounts.market.fees_withdrawn, CueError::FeesAlreadyWithdrawn);
        
        // Cooldown period: wait 24 hours after resolution
        require!(
            clock.unix_timestamp >= ctx.accounts.market.resolved_timestamp + FEE_WITHDRAWAL_COOLDOWN_SECS,
            CueError::WithdrawalTooEarly
        );
        
        let fees = ctx.accounts.market.fees_accrued;
        
        if fees == 0 {
            ctx.accounts.market.fees_withdrawn = true;
            msg!("No fees to withdraw");
            return Ok(());
        }
        
        // Extract values needed for signing before mutable borrow
        let market_id = ctx.accounts.market.market_id;
        let bump = ctx.accounts.market.bump;
        let market_key = ctx.accounts.market.key();
        
        // === EFFECTS ===
        // CRITICAL: Mark as withdrawn BEFORE transfer
        ctx.accounts.market.fees_withdrawn = true;
        
        // === INTERACTIONS ===
        // Transfer fees to protocol treasury (Squads Safe)
        let seeds = &[b"market".as_ref(), market_id.as_ref(), &[bump]];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.market.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
            fees,
        )?;
        
        emit!(FeesWithdrawn {
            market: market_key,
            amount: fees,
            treasury: PROTOCOL_TREASURY,
        });
        
        msg!("Fees withdrawn: {} USDC to Squads Safe {:?}", fees, PROTOCOL_TREASURY);
        Ok(())
    }
    
    /// Withdraw stuck funds from a market vault (for ghost bet recovery).
    /// 
    /// This function allows the market authority to recover USDC that is stuck
    /// in a market vault due to ghost bets (DB records without corresponding
    /// on-chain positions). This can happen when:
    /// - Frontend bugs create DB bets without on-chain transactions
    /// - Users transfer USDC but position creation fails
    /// 
    /// # Safety
    /// - Only callable by market authority (creator)
    /// - Only works on resolved or cancelled markets
    /// - Emits event for transparency/auditing
    /// 
    /// # Arguments
    /// * `amount` - Amount in micro-USDC (6 decimals) to withdraw
    /// 
    /// # Access Control
    /// Market authority only.
    pub fn admin_withdraw_stuck_funds(
        ctx: Context<AdminWithdrawStuckFunds>,
        amount: u64,
    ) -> Result<()> {
        let market = &ctx.accounts.market;
        let clock = Clock::get()?;
        
        // Verify caller is market authority
        require!(
            ctx.accounts.authority.key() == market.authority,
            CueError::Unauthorized
        );
        
        // Only allow withdrawal from resolved/cancelled markets
        // This prevents withdrawing from active markets
        require!(
            market.status == MarketStatus::Resolved || market.status == MarketStatus::Cancelled,
            CueError::InvalidStatus
        );
        
        // Build signer seeds for market PDA
        let market_id = market.market_id;
        let bump = market.bump;
        let seeds = &[b"market".as_ref(), market_id.as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];
        
        // Transfer USDC from vault to authority
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.authority_ata.to_account_info(),
            authority: ctx.accounts.market.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
            amount,
        )?;
        
        // Emit event for audit trail
        emit!(StuckFundsWithdrawn {
            market: market.key(),
            amount,
            authority: ctx.accounts.authority.key(),
            timestamp: clock.unix_timestamp,
        });
        
        msg!("Stuck funds withdrawn: {} USDC to authority {:?}", amount, ctx.accounts.authority.key());
        Ok(())
    }
}

// ============================================
// ACCOUNTS
// ============================================

#[derive(Accounts)]
#[instruction(market_id: [u8; 32])]
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Market::SIZE,
        seeds = [b"market", market_id.as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    
    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,
    
    pub usdc_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserPosition::SIZE,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub position: Account<'info, UserPosition>,
    
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = user,
    )]
    pub user_usdc: Account<'info, TokenAccount>,
    
    #[account(address = USDC_MINT)]
    pub usdc_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump = position.bump,
        has_one = user,
        has_one = market,
    )]
    pub position: Account<'info, UserPosition>,
    
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = user,
    )]
    pub user_usdc: Account<'info, TokenAccount>,
    
    pub usdc_mint: Account<'info, Mint>,
    
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump = position.bump,
        has_one = user,
        has_one = market,
    )]
    pub position: Account<'info, UserPosition>,
    
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = user,
    )]
    pub user_usdc: Account<'info, TokenAccount>,
    
    pub usdc_mint: Account<'info, Mint>,
    
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct EmergencyCancel<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = treasury.mint == usdc_mint.key() @ CueError::InvalidTreasury
    )]
    pub treasury: Account<'info, TokenAccount>,
    
    pub usdc_mint: Account<'info, Mint>,
    
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminWithdrawStuckFunds<'info> {
    /// Market authority (must be signer)
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Market account (PDA)
    #[account(
        mut,
        seeds = [b"market", market.market_id.as_ref()],
        bump = market.bump,
        constraint = market.authority == authority.key() @ CueError::Unauthorized
    )]
    pub market: Account<'info, Market>,
    
    /// Market vault - the PDA's Associated Token Account for USDC
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,
    
    /// Authority's USDC account (destination for withdrawn funds)
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = authority,
    )]
    pub authority_ata: Account<'info, TokenAccount>,
    
    /// USDC mint
    pub usdc_mint: Account<'info, Mint>,
    
    /// SPL Token program
    pub token_program: Program<'info, Token>,
}

// ============================================
// STATE
// ============================================

#[account]
pub struct Market {
    pub market_id: [u8; 32],
    pub bump: u8,
    pub status: MarketStatus,
    pub outcome: MarketOutcome,
    pub num_options: u8,
    pub pools: [u64; MAX_OPTIONS],           // USDC staked per option
    pub shares_total: [u128; MAX_OPTIONS],   // Time-weighted shares per option
    pub resolve_timestamp: i64,              // When market resolves
    pub resolved_timestamp: i64,             // When market was resolved
    pub protocol_fee_bps: u16,               // Protocol fee in basis points
    pub winning_option: Option<u8>,
    pub fees_accrued: u64,
    pub fees_withdrawn: bool,
    pub authority: Pubkey,
}

impl Market {
    pub const SIZE: usize = 32  // market_id
        + 1   // bump
        + 1   // status
        + 1   // outcome
        + 1   // num_options
        + (8 * MAX_OPTIONS)   // pools
        + (16 * MAX_OPTIONS)  // shares_total
        + 8   // resolve_timestamp
        + 8   // resolved_timestamp
        + 2   // protocol_fee_bps
        + 2   // winning_option (1 byte option + 1 byte Option discriminant)
        + 8   // fees_accrued
        + 1   // fees_withdrawn
        + 32; // authority
}

#[account]
pub struct UserPosition {
    pub user: Pubkey,
    pub market: Pubkey,
    pub bump: u8,
    pub option: u8,
    pub stake_amount: u64,
    pub shares: u128,        // Time-weighted shares (early bettor = more shares)
    pub claimed: bool,
}

impl UserPosition {
    pub const SIZE: usize = 32  // user
        + 32  // market
        + 1   // bump
        + 1   // option
        + 8   // stake_amount
        + 16  // shares
        + 1;  // claimed
}

// ============================================
// EVENTS
// ============================================

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub market_id: [u8; 32],
    pub num_options: u8,
    pub resolve_timestamp: i64,
    pub authority: Pubkey,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub user: Pubkey,
    pub option: u8,
    pub amount: u64,
    pub new_pool_total: u64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub winning_option: u8,
    pub total_pool: u64,
}

#[event]
pub struct MarketCancelled {
    pub market: Pubkey,
    pub reason: String,
}

#[event]
pub struct PayoutClaimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RefundClaimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct FeesWithdrawn {
    pub market: Pubkey,
    pub amount: u64,
    pub treasury: Pubkey,
}

#[event]
pub struct StuckFundsWithdrawn {
    pub market: Pubkey,
    pub amount: u64,
    pub authority: Pubkey,
    pub timestamp: i64,
}

// ============================================
// ENUMS
// ============================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MarketStatus {
    Open = 0,
    Resolved = 1,
    Cancelled = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MarketOutcome {
    Unresolved = 0,
    Resolved = 1,
    Invalid = 2,
}

// ============================================
// ERRORS
// ============================================

#[error_code]
pub enum CueError {
    #[msg("Unauthorized - only admins can perform this action")]
    Unauthorized,
    #[msg("Market not open for betting")]
    MarketNotOpen,
    #[msg("Trading closed - deadline passed")]
    TradingClosed,
    #[msg("Invalid amount - must be greater than 0")]
    InvalidAmount,
    #[msg("Too early to resolve - wait until deadline")]
    TooEarly,
    #[msg("Market not resolved yet")]
    MarketNotResolved,
    #[msg("Not a winning position")]
    NotWinner,
    #[msg("Already claimed - cannot claim twice")]
    AlreadyClaimed,
    #[msg("Cannot bet on different option in same position")]
    DifferentOptionPosition,
    #[msg("Market already resolved")]
    MarketAlreadyResolved,
    #[msg("Invalid market status for this operation")]
    InvalidStatus,
    #[msg("Market not cancelled - cannot claim refund")]
    MarketNotCancelled,
    #[msg("Invalid option index")]
    InvalidOption,
    #[msg("Invalid option count - must be 2-7 options")]
    InvalidOptionCount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Fee too high - max 10%")]
    FeeTooHigh,
    #[msg("Bet too small - minimum 1 USDC")]
    BetTooSmall,
    #[msg("Invalid timestamp")]
    InvalidTime,
    #[msg("Slippage exceeded - odds changed too much")]
    SlippageExceeded,
    #[msg("Invalid USDC mint - must use official USDC")]
    InvalidMint,
    #[msg("Fees already withdrawn")]
    FeesAlreadyWithdrawn,
    #[msg("Invalid treasury - must be owned by Protocol Treasury (Squads Safe)")]
    InvalidTreasury,
    #[msg("Late bet exceeds cap - max 10% of pool in final window")]
    LateBetCapExceeded,
    #[msg("Too early to withdraw fees - 24 hour cooldown after resolution")]
    WithdrawalTooEarly,
}
