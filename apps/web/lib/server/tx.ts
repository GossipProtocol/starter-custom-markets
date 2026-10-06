/**
 * Server-built transactions.
 *
 * The server builds every transaction, stores its message bytes as an
 * intent, and hands the client an unsigned copy. The client signs with the
 * Privy embedded wallet and sends the signed copy back. The server checks
 * the message is byte for byte the one it built, adds the sponsor signature
 * if it is paying, submits, waits, and only then re-reads the chain.
 *
 * The client never chooses an amount, an account or a destination. It only
 * signs or does not.
 */
import { IntentKind, Prisma } from '@prisma/client';
import { ComputeBudgetProgram, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { prisma } from './db';
import { connection, sponsorKeypair } from './rpc';
import { HttpError } from './privy';

const INTENT_TTL_MS = 90_000;

export type BuiltIntent = { intentId: string; transaction: string; feePayer: string; expiresAt: string };

export async function buildIntent(params: {
  kind: IntentKind;
  userId: string;
  marketId?: string;
  user: PublicKey;
  instructions: TransactionInstruction[];
  payload: Record<string, unknown>;
  computeUnits?: number;
}): Promise<BuiltIntent> {
  const sponsor = sponsorKeypair();
  const feePayer = sponsor ? sponsor.publicKey : params.user;
  const conn = connection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: params.computeUnits ?? 200_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }));
  for (const ix of params.instructions) tx.add(ix);

  const message = tx.serializeMessage().toString('base64');
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
  const intent = await prisma.txIntent.create({
    data: {
      kind: params.kind,
      userId: params.userId,
      marketId: params.marketId ?? null,
      message,
      payload: { ...params.payload, blockhash, lastValidBlockHeight } as Prisma.InputJsonValue,
      expiresAt,
    },
  });

  return {
    intentId: intent.id,
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
    feePayer: feePayer.toBase58(),
    expiresAt: expiresAt.toISOString(),
  };
}

export type Settled = { signature: string; payload: Record<string, any>; kind: IntentKind; marketId: string | null };

/** Verify, co-sign, submit and confirm. Idempotent on the signature: a
 *  retry after a network blip returns the same result. */
export async function settleIntent(intentId: string, signedTxBase64: string, userId: string, user: PublicKey): Promise<Settled> {
  const intent = await prisma.txIntent.findUnique({ where: { id: intentId } });
  if (!intent || intent.userId !== userId) throw new HttpError(404, 'Unknown intent');
  const payload = intent.payload as Record<string, any>;
  if (intent.signature) return { signature: intent.signature, payload, kind: intent.kind, marketId: intent.marketId };
  if (intent.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'Intent expired; ask for a new transaction');

  let signed: Transaction;
  try {
    signed = Transaction.from(Buffer.from(signedTxBase64, 'base64'));
  } catch {
    throw new HttpError(400, 'Not a transaction');
  }
  if (!signed.serializeMessage().equals(Buffer.from(intent.message, 'base64'))) {
    throw new HttpError(400, 'Signed transaction does not match the one the server built');
  }
  const userSig = signed.signatures.find((s) => s.publicKey.equals(user));
  if (!userSig?.signature) throw new HttpError(400, 'Missing the wallet signature');

  const sponsor = sponsorKeypair();
  if (sponsor && signed.feePayer?.equals(sponsor.publicKey)) signed.partialSign(sponsor);
  if (!signed.verifySignatures(true)) throw new HttpError(400, 'Invalid signatures');

  const conn = connection();
  const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  const confirmation = await conn.confirmTransaction(
    { signature, blockhash: payload.blockhash, lastValidBlockHeight: payload.lastValidBlockHeight },
    'confirmed'
  );
  if (confirmation.value.err) throw new HttpError(409, `Transaction failed on chain: ${JSON.stringify(confirmation.value.err)}`);

  await prisma.txIntent.update({ where: { id: intentId }, data: { signature } });
  return { signature, payload, kind: intent.kind, marketId: intent.marketId };
}

export { sendWithKeypair } from './rpc';
