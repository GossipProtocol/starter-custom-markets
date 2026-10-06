import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PROGRAM_ID, USDC_MINT } from '@/lib/config';

export const programId = () => new PublicKey(PROGRAM_ID);
export const usdcMint = () => new PublicKey(USDC_MINT);

/** Seeds mirror `programs/cue-solana/src/lib.rs`: `["market", market_id]`
 *  and `["position", market, user]`. `marketId` is the 32-byte seed, hex
 *  encoded in the database. */
export function marketPda(marketIdHex: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('market'), Buffer.from(marketIdHex, 'hex')], programId())[0];
}

export function positionPda(market: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('position'), market.toBuffer(), user.toBuffer()], programId())[0];
}

export function vaultAta(market: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(usdcMint(), market, true);
}

export function usdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(usdcMint(), owner, true);
}

export function newMarketIdHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('hex');
}
