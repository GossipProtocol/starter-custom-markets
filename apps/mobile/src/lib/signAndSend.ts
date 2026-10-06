import { Transaction } from '@solana/web3.js';

type EmbeddedWalletLike = {
  getProvider: () => Promise<{ request: (opts: { method: string; params: any }) => Promise<any> }>;
};

/**
 * Sign a server-built transaction with the Privy embedded wallet and return
 * the signed bytes. The server submits; the app never talks to an RPC.
 */
export async function signWithEmbeddedWallet(wallet: EmbeddedWalletLike, transactionBase64: string): Promise<string> {
  const provider = await wallet.getProvider();
  const transaction = Transaction.from(Buffer.from(transactionBase64, 'base64'));
  const { signedTransaction } = await provider.request({ method: 'signTransaction', params: { transaction } });
  const signed: Transaction = signedTransaction;
  return Buffer.from(signed.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
}
