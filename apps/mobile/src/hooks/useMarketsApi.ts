import { useCallback } from 'react';
import { usePrivy, useEmbeddedSolanaWallet } from '@privy-io/expo';
import { api } from '../lib/api';
import { signWithEmbeddedWallet } from '../lib/signAndSend';

type Intent = { intentId: string; transaction: string };

export type Market = {
  id: string;
  title: string;
  description: string;
  status: 'PENDING' | 'OPEN' | 'RESOLVED' | 'CANCELLED';
  numOptions: number;
  openAt: number;
  resolveAt: number;
  feeBps: number;
  winningOption: number | null;
  outcomes: { index: number; label: string; pool: string; sharesTotal: string }[];
  totalPool: string;
};

export type Position = { marketId: string; option: number; stake: string; shares: string; claimed: boolean };
export type PositionWithMarket = Position & { market: Market; claimable: 'payout' | 'refund' | null; payout: string };

/** Prepare on the server, sign here, confirm on the server. */
export function useMarketsApi() {
  const { getAccessToken } = usePrivy();
  const { wallets } = useEmbeddedSolanaWallet();
  const wallet = wallets?.[0] ?? null;

  const signed = useCallback(
    async (intent: Intent) => {
      if (!wallet) throw new Error('Wallet is not ready yet');
      return signWithEmbeddedWallet(wallet as any, intent.transaction);
    },
    [wallet]
  );

  return {
    walletAddress: wallet?.address ?? null,
    listMarkets: async () => (await api<{ markets: Market[] }>('/api/markets', null)).markets,
    getMarket: async (id: string) => api<{ market: Market; position: Position | null }>(`/api/markets/${id}`, await getAccessToken()),
    myPositions: async () => (await api<{ positions: PositionWithMarket[] }>('/api/me/positions', await getAccessToken())).positions,
    placeBet: async (marketId: string, option: number, amountUsdc: number) => {
      const token = await getAccessToken();
      const { intent, quote } = await api<{ intent: Intent; quote: { payout: string } }>('/api/bets/prepare', token, {
        method: 'POST',
        body: JSON.stringify({ marketId, option, amountUsdc, minPayoutBps: null }),
      });
      const signedTransaction = await signed(intent);
      const r = await api<{ signature: string }>('/api/bets/confirm', token, { method: 'POST', body: JSON.stringify({ intentId: intent.intentId, signedTransaction }) });
      return { ...r, quote };
    },
    claim: async (marketId: string) => {
      const token = await getAccessToken();
      const { intent } = await api<{ intent: Intent }>('/api/claims/prepare', token, { method: 'POST', body: JSON.stringify({ marketId }) });
      const signedTransaction = await signed(intent);
      return api<{ signature: string; amount: string }>('/api/claims/confirm', token, { method: 'POST', body: JSON.stringify({ intentId: intent.intentId, signedTransaction }) });
    },
  };
}
