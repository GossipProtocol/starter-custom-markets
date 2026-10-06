/**
 * One-time, after deploy: check the deployment and create the course fee
 * wallet's USDC account.
 *
 *   ADMIN_KEYPAIR=~/.config/solana/id.json npx tsx scripts/init-config.ts
 *
 * The audited program has no config account. Its admin list and fee
 * recipient are constants in `programs/cue-solana/src/config.rs`, baked in
 * at build time. This script therefore checks, in order:
 *
 *   1. config.rs no longer carries the shipped placeholders;
 *   2. the course fee recipient in lib/course-fee.ts is set;
 *   3. an executable program exists at NEXT_PUBLIC_MARKETS_PROGRAM_ID;
 *   4. the signer is listed in MARKET_ADMIN_WALLETS;
 *
 * and then creates the fee recipient's USDC associated token account, which
 * `withdraw_fees` needs to exist. It cannot verify that config.rs and
 * MARKET_ADMIN_WALLETS agree: the first `create_market` does, by failing
 * with Unauthorized if they do not.
 *
 * Runs against NEXT_PUBLIC_SOLANA_RPC_URL / SOLANA_RPC_URL with
 * NEXT_PUBLIC_MARKETS_PROGRAM_ID and NEXT_PUBLIC_USDC_MINT from .env.local.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAccount } from '@solana/spl-token';
import { COURSE_FEE_BPS, COURSE_FEE_RECIPIENT, courseFeeConfigured } from '../lib/course-fee';
import { programId, usdcAta, usdcMint } from '../lib/chain/pdas';
import { PROGRAM_ID } from '../lib/config';
import { connection, sendWithKeypair } from '../lib/server/rpc';

const PLACEHOLDER_PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';

function configRsHasPlaceholders(): boolean {
  const path = join(__dirname, '../../../programs/cue-solana/src/config.rs');
  const src = readFileSync(path, 'utf8');
  // The shipped placeholders are `Pubkey::new_from_array([0xNN; 32])`. A real
  // key is a `pubkey!("...")` or a full 32-byte array.
  return /new_from_array\(\[0x[0-9A-Fa-f]{2}; 32\]\)/.test(src);
}

async function main() {
  if (configRsHasPlaceholders()) {
    throw new Error('programs/cue-solana/src/config.rs still has placeholder wallets; set PROTOCOL_TREASURY and the hot wallets, then rebuild and redeploy');
  }
  if (!courseFeeConfigured()) throw new Error('Set COURSE_FEE_RECIPIENT in lib/course-fee.ts first');
  if (PROGRAM_ID === PLACEHOLDER_PROGRAM_ID) throw new Error('NEXT_PUBLIC_MARKETS_PROGRAM_ID is still the Anchor placeholder');

  const path = (process.env.ADMIN_KEYPAIR || '~/.config/solana/id.json').replace('~', homedir());
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
  const admins = (process.env.MARKET_ADMIN_WALLETS || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (!admins.includes(admin.publicKey.toBase58())) {
    throw new Error(`Signer ${admin.publicKey.toBase58()} is not in MARKET_ADMIN_WALLETS; it must also be in config.rs ADMIN_WALLETS`);
  }

  const conn = connection();
  const program = await conn.getAccountInfo(programId());
  if (!program || !program.executable) throw new Error(`No executable program at ${PROGRAM_ID} on this cluster`);

  const feeRecipient = new PublicKey(COURSE_FEE_RECIPIENT);
  const treasury = usdcAta(feeRecipient);
  try {
    await getAccount(conn, treasury);
    console.log('Course fee USDC account already exists', { treasury: treasury.toBase58() });
  } catch {
    const sig = await sendWithKeypair([createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, treasury, feeRecipient, usdcMint())], admin);
    console.log('Created the course fee USDC account', { treasury: treasury.toBase58(), sig });
  }

  console.log('Ready', {
    programId: PROGRAM_ID,
    admin: admin.publicKey.toBase58(),
    feeRecipient: COURSE_FEE_RECIPIENT,
    feeBps: COURSE_FEE_BPS,
    note: 'config.rs PROTOCOL_TREASURY must equal feeRecipient and ADMIN_WALLETS must include the admin, or the program rejects withdraw_fees and create_market',
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
