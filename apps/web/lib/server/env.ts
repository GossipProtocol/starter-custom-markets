/**
 * Live-mode preflight. Every money route calls `assertLive()` first, so a
 * half-configured deployment fails with a sentence instead of a stack trace,
 * and a deployment with the course fee unset cannot take a bet.
 */
import { PublicKey } from '@solana/web3.js';
import { COURSE_FEE_BPS, COURSE_FEE_RECIPIENT, courseFeeConfigured } from '@/lib/course-fee';
import { IS_DEMO, MAX_FEE_BPS, PROGRAM_ID } from '@/lib/config';
import { programId, usdcAta, usdcMint } from '@/lib/chain/pdas';
import { connection } from './rpc';
import { HttpError } from './privy';

/**
 * What the app knows about the deployed program. The audited program keeps
 * its admin list and treasury as constants in
 * `programs/cue-solana/src/config.rs`, not in an on-chain account, so the
 * app carries the same values: the admin wallets from `MARKET_ADMIN_WALLETS`
 * and the fee recipient from `lib/course-fee.ts`.
 */
export type ChainConfig = {
  programId: string;
  mint: string;
  /** Wallets allowed to create and cancel markets. Must equal `ADMIN_WALLETS`
   *  in config.rs, or the program rejects the transaction with Unauthorized. */
  admins: string[];
  feeRecipient: string;
  /** The USDC token account `withdraw_fees` pays into. */
  treasuryAta: string;
  feeBps: number;
};

let cached: { at: number; config: ChainConfig } | null = null;

export function assertLive(): void {
  if (IS_DEMO) throw new HttpError(503, 'Demo mode: set NEXT_PUBLIC_PRIVY_APP_ID to go live');
  if (!process.env.DATABASE_URL) throw new HttpError(503, 'DATABASE_URL is not set');
  if (!courseFeeConfigured()) {
    throw new HttpError(503, 'Course fee recipient is not set in lib/course-fee.ts; the app refuses to run live');
  }
  if (COURSE_FEE_BPS > MAX_FEE_BPS) throw new HttpError(503, 'COURSE_FEE_BPS is above the program maximum of 1000');
}

/** `MARKET_ADMIN_WALLETS` as a list of base58 keys, validated. */
export function adminWallets(): string[] {
  const raw = process.env.MARKET_ADMIN_WALLETS || '';
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  for (const k of keys) {
    try {
      new PublicKey(k);
    } catch {
      throw new HttpError(503, `MARKET_ADMIN_WALLETS contains an invalid key: ${k}`);
    }
  }
  return keys;
}

/**
 * Checks the program is deployed at `NEXT_PUBLIC_MARKETS_PROGRAM_ID` and that
 * the app has what it needs to administer it. Cached for a minute. Called by
 * the routes that create or cancel markets and by the resolve cron. It
 * cannot read `ADMIN_WALLETS` or `PROTOCOL_TREASURY` from the chain, because
 * the audited program keeps them as constants; a mismatch surfaces as
 * `Unauthorized` or `InvalidTreasury` from the program, which the cron
 * report and the create route pass through.
 */
export async function assertChainConfig(): Promise<ChainConfig> {
  assertLive();
  if (cached && Date.now() - cached.at < 60_000) return cached.config;
  if (PROGRAM_ID === 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS') {
    throw new HttpError(503, 'NEXT_PUBLIC_MARKETS_PROGRAM_ID is still the Anchor placeholder; deploy and run anchor keys sync');
  }
  const info = await connection().getAccountInfo(programId());
  if (!info || !info.executable) throw new HttpError(503, 'No executable program at NEXT_PUBLIC_MARKETS_PROGRAM_ID on this cluster');
  const admins = adminWallets();
  if (admins.length === 0) throw new HttpError(503, 'MARKET_ADMIN_WALLETS is not set; list the wallets in programs/cue-solana/src/config.rs');
  const feeRecipient = new PublicKey(COURSE_FEE_RECIPIENT);
  const config: ChainConfig = {
    programId: PROGRAM_ID,
    mint: usdcMint().toBase58(),
    admins,
    feeRecipient: feeRecipient.toBase58(),
    treasuryAta: usdcAta(feeRecipient).toBase58(),
    feeBps: COURSE_FEE_BPS,
  };
  cached = { at: Date.now(), config };
  return config;
}

export function isAdmin(config: ChainConfig, wallet: string): boolean {
  return config.admins.includes(wallet);
}
