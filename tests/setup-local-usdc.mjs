// Runs before `anchor test`. The audited program pins the USDC mint: the
// devnet mint under the default build, the mainnet mint with
// `--features mainnet`. A local validator has neither, so this writes an
// account file for the devnet USDC address whose mint authority is a fresh
// local keypair, and Anchor.toml loads it into the test validator.
//
// Both files land in gitignored directories. No keypair is committed.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const keysDir = join('tests', '.keys');
const accountsDir = join('tests', '.accounts');
mkdirSync(keysDir, { recursive: true });
mkdirSync(accountsDir, { recursive: true });

const authorityPath = join(keysDir, 'mint-authority.json');
let authority;
if (existsSync(authorityPath)) {
  authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(authorityPath, 'utf8'))));
} else {
  authority = Keypair.generate();
  writeFileSync(authorityPath, JSON.stringify(Array.from(authority.secretKey)));
}

// SPL Token Mint layout (82 bytes): COption<Pubkey> mint_authority (4 + 32),
// u64 supply, u8 decimals, bool is_initialized, COption<Pubkey> freeze_authority.
const data = Buffer.alloc(82);
data.writeUInt32LE(1, 0);
authority.publicKey.toBuffer().copy(data, 4);
data.writeBigUInt64LE(0n, 36);
data.writeUInt8(6, 44);
data.writeUInt8(1, 45);
data.writeUInt32LE(0, 46);

const account = {
  pubkey: DEVNET_USDC,
  account: {
    lamports: 1_461_600,
    data: [data.toString('base64'), 'base64'],
    owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    executable: false,
    rentEpoch: 0,
  },
};
writeFileSync(join(accountsDir, 'usdc-mint.json'), JSON.stringify(account, null, 2));

// The provider wallet must be one of the program's ADMIN_WALLETS, or
// create_market fails with Unauthorized. Say so before the suite runs.
const walletPath = (process.env.ANCHOR_WALLET || '~/.config/solana/id.json').replace('~', homedir());
let adminHint = 'the Anchor provider wallet';
try {
  const w = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, 'utf8'))));
  adminHint = w.publicKey.toBase58();
} catch {
  /* no wallet file; anchor will complain itself */
}
const config = readFileSync(join('programs', 'cue-solana', 'src', 'config.rs'), 'utf8');
if (/new_from_array\(\[0x[0-9A-Fa-f]{2}; 32\]\)/.test(config)) {
  console.warn(
    `\nconfig.rs still has placeholder wallets. Put ${adminHint} in HOT_WALLET_1 (pubkey!("${adminHint}")) and rebuild, or every create_market in the suite fails with Unauthorized.\n`
  );
}
console.log('Local USDC mint account written for', DEVNET_USDC, 'with authority', new PublicKey(authority.publicKey).toBase58());
