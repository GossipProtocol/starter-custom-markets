/**
 * Live mode: the browser asks the server for a transaction, signs it with
 * the Privy embedded wallet, and hands the signed bytes back. It never
 * builds an instruction, picks an account or submits to an RPC itself.
 */
import { MarketDto, MarketsClient, PositionDto, PositionWithMarket } from '@/lib/types';

export type Signer = (transaction: Uint8Array) => Promise<Uint8Array>;

type Intent = { intentId: string; transaction: string };

export class LiveClient implements MarketsClient {
  readonly mode = 'live' as const;

  constructor(private readonly getToken: () => Promise<string | null>, private readonly sign: Signer | null) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body as T;
  }

  private async signIntent(intent: Intent): Promise<string> {
    if (!this.sign) throw new Error('Wallet is not ready yet');
    const signed = await this.sign(Uint8Array.from(Buffer.from(intent.transaction, 'base64')));
    return Buffer.from(signed).toString('base64');
  }

  async listMarkets() {
    return (await this.call<{ markets: MarketDto[] }>('/api/markets')).markets;
  }

  async getMarket(id: string) {
    return this.call<{ market: MarketDto; position: PositionDto | null }>(`/api/markets/${id}`);
  }

  async placeBet(marketId: string, option: number, amountUsdc: number, minPayoutBps: number | null) {
    const { intent } = await this.call<{ intent: Intent }>('/api/bets/prepare', {
      method: 'POST',
      body: JSON.stringify({ marketId, option, amountUsdc, minPayoutBps }),
    });
    const signedTransaction = await this.signIntent(intent);
    return this.call<{ signature: string }>('/api/bets/confirm', { method: 'POST', body: JSON.stringify({ intentId: intent.intentId, signedTransaction }) });
  }

  async claim(marketId: string) {
    const { intent } = await this.call<{ intent: Intent }>('/api/claims/prepare', { method: 'POST', body: JSON.stringify({ marketId }) });
    const signedTransaction = await this.signIntent(intent);
    return this.call<{ signature: string; amount: string }>('/api/claims/confirm', {
      method: 'POST',
      body: JSON.stringify({ intentId: intent.intentId, signedTransaction }),
    });
  }

  async myPositions() {
    return (await this.call<{ positions: PositionWithMarket[] }>('/api/me/positions')).positions;
  }

  async createMarket(input: { title: string; description: string; options: string[]; resolveAt: number }) {
    const { marketId, intent } = await this.call<{ marketId: string; intent: Intent }>('/api/markets', { method: 'POST', body: JSON.stringify(input) });
    const signedTransaction = await this.signIntent(intent);
    await this.call('/api/markets/confirm', { method: 'POST', body: JSON.stringify({ intentId: intent.intentId, signedTransaction }) });
    return { id: marketId };
  }

  async cancelMarket(marketId: string) {
    const { intent } = await this.call<{ intent: Intent }>(`/api/markets/${marketId}/cancel`, { method: 'POST' });
    const signedTransaction = await this.signIntent(intent);
    return this.call<{ signature: string }>('/api/markets/confirm', { method: 'POST', body: JSON.stringify({ intentId: intent.intentId, signedTransaction }) });
  }
}
