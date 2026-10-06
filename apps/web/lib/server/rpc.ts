import { ComputeBudgetProgram, Connection, Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { PUBLIC_RPC_URL } from '@/lib/config';

/** Server RPC. Prefer a private endpoint; the public one rate limits crons. */
export function connection(): Connection {
  return new Connection(process.env.SOLANA_RPC_URL || PUBLIC_RPC_URL, 'confirmed');
}

/** Parse a secret key from env: JSON array, comma list or base58. */
export function keypairFromEnv(name: string): Keypair | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  if (raw.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  if (raw.includes(',')) return Keypair.fromSecretKey(Uint8Array.from(raw.split(',').map((n) => parseInt(n.trim(), 10))));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

/** The keypair that pays for the cron's `resolve_market` calls. Resolution
 *  is permissionless, so this key holds no power the program does not give
 *  everyone. */
export const resolverKeypair = () => keypairFromEnv('RESOLVER_SECRET_KEY');

/** Optional. One of the program's `ADMIN_WALLETS`. The cron signs
 *  `withdraw_fees` with it, because the audited program only lets an admin
 *  withdraw. Unset, fees stay in the vaults until an admin withdraws by hand. */
export const adminKeypair = () => keypairFromEnv('ADMIN_SECRET_KEY');

/** Optional. When set, the server pays the transaction fee for bettors. The
 *  position rent is still paid by the user: the audited `place_bet` has
 *  `payer = user`, so a sponsor cannot be farmed for rent. */
export const sponsorKeypair = () => keypairFromEnv('SPONSOR_SECRET_KEY');

/** For scripts and crons that sign with a server keypair. */
export async function sendWithKeypair(instructions: TransactionInstruction[], signer: Keypair, computeUnits = 200_000): Promise<string> {
  const conn = connection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  for (const ix of instructions) tx.add(ix);
  tx.sign(signer);
  const signature = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (res.value.err) throw new Error(`tx ${signature} failed: ${JSON.stringify(res.value.err)}`);
  return signature;
}
