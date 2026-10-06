/**
 * Who is calling. The answer comes from a verified Privy access token and
 * from Privy's record of the user's wallets, never from the request body.
 * The product this came from accepted `userWallet` as a JSON field, which
 * meant anyone could build (and nearly anyone could sync) positions for a
 * wallet they did not hold.
 */
import { NextRequest } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { prisma } from './db';

let client: PrivyClient | null = null;

function privy(): PrivyClient {
  if (!client) {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const secret = process.env.PRIVY_APP_SECRET;
    if (!appId || !secret) throw new Error('Privy is not configured (NEXT_PUBLIC_PRIVY_APP_ID, PRIVY_APP_SECRET)');
    client = new PrivyClient(appId, secret);
  }
  return client;
}

export type Caller = { userId: string; privyId: string; wallet: string };

/**
 * Resolve the caller from the bearer token. The Solana wallet is read from
 * Privy on first sight and cached on the user row; a later login that links
 * a different embedded wallet refreshes it.
 */
export async function requireCaller(request: NextRequest): Promise<Caller> {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) throw new HttpError(401, 'Sign in first');
  let privyId: string;
  try {
    privyId = (await privy().verifyAuthToken(auth.slice(7))).userId;
  } catch {
    throw new HttpError(401, 'Invalid session');
  }

  const existing = await prisma.user.findUnique({ where: { privyId } });
  if (existing?.walletAddress) return { userId: existing.id, privyId, wallet: existing.walletAddress };

  const user = await privy().getUser(privyId);
  const solana = user.linkedAccounts.find(
    (a: any) => a.type === 'wallet' && a.chainType === 'solana' && typeof a.address === 'string'
  ) as { address: string } | undefined;
  if (!solana) throw new HttpError(409, 'No Solana wallet on this account yet');

  const row = await prisma.user.upsert({
    where: { privyId },
    update: { walletAddress: solana.address },
    create: { privyId, walletAddress: solana.address },
  });
  return { userId: row.id, privyId, wallet: solana.address };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
