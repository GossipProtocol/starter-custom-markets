/**
 * Public configuration. Everything here is safe in the browser.
 *
 * With no Privy app id the app runs in DEMO mode: a mock wallet, markets in
 * localStorage, bets simulated with the same maths as the program. Set the
 * env groups in `.env.example` one at a time to go live.
 */

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || '';

/** Demo mode is the default. Live mode needs Privy on the client. */
export const IS_DEMO = PRIVY_APP_ID.length === 0;

export const NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet') as 'devnet' | 'mainnet';

export const PUBLIC_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  (NETWORK === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com');

/** Anchor's placeholder id. `anchor keys sync` replaces it; the env var carries it to the app. */
export const PROGRAM_ID = process.env.NEXT_PUBLIC_MARKETS_PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || (NETWORK === 'devnet' ? DEVNET_USDC : MAINNET_USDC);

/** Product limits enforced by the server. The program enforces the floor. */
export const MIN_BET_USDC = 1;
export const MAX_BET_USDC = 1_000;
export const MAX_OPTIONS = 7;

/** Program clock constants. Must match `programs/cue-solana/src/lib.rs`. */
export const TIME_BUFFER_SECS = 300;
export const LATE_BET_WINDOW_SECS = 24 * 60 * 60;
export const LATE_BET_CAP_WINDOW_SECS = 15 * 60;
export const FEE_WITHDRAWAL_COOLDOWN_SECS = 24 * 60 * 60;
/** The program caps `fee_bps` at 1000 (10%). */
export const MAX_FEE_BPS = 1_000;
