/**
 * The shape the UI consumes, in demo mode and live mode alike. Amounts are
 * strings of USDC base units and raw shares so nothing rounds before the
 * maths in `lib/maths.ts` sees it.
 */
export type MarketStatus = 'PENDING' | 'OPEN' | 'RESOLVED' | 'CANCELLED';

export type OutcomeDto = {
  index: number;
  label: string;
  pool: string;
  sharesTotal: string;
};

export type MarketDto = {
  id: string;
  title: string;
  description: string;
  pda: string;
  status: MarketStatus;
  numOptions: number;
  openAt: number; // unix seconds; when the row was created. The program stores no open time: its multiplier window is the 24 hours before resolveAt.
  resolveAt: number;
  resolvedAt: number | null;
  feeBps: number;
  winningOption: number | null;
  outcomes: OutcomeDto[];
  totalPool: string;
};

export type PositionDto = {
  marketId: string;
  wallet: string;
  option: number;
  stake: string;
  shares: string;
  claimed: boolean;
  closed: boolean;
  betTx: string | null;
  claimTx: string | null;
};

export type PositionWithMarket = PositionDto & { market: MarketDto; claimable: 'payout' | 'refund' | null; payout: string };

/** The service boundary the screens talk to. `lib/demo/client.ts` and
 *  `lib/live/client.ts` both implement it. */
export interface MarketsClient {
  readonly mode: 'demo' | 'live';
  listMarkets(): Promise<MarketDto[]>;
  getMarket(id: string): Promise<{ market: MarketDto; position: PositionDto | null }>;
  placeBet(marketId: string, option: number, amountUsdc: number, minPayoutBps: number | null): Promise<{ signature: string }>;
  claim(marketId: string): Promise<{ signature: string; amount: string }>;
  myPositions(): Promise<PositionWithMarket[]>;
  createMarket(input: { title: string; description: string; options: string[]; resolveAt: number }): Promise<{ id: string }>;
}
