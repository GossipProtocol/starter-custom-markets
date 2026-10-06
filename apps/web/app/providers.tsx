'use client';

import { createContext, useContext, useMemo } from 'react';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { IS_DEMO, NETWORK, PRIVY_APP_ID, PRIVY_CLIENT_ID, PUBLIC_RPC_URL } from '@/lib/config';
import { MarketsClient } from '@/lib/types';
import { DemoClient } from '@/lib/demo/client';
import { LiveClient } from '@/lib/live/client';

export type Session = {
  mode: 'demo' | 'live';
  client: MarketsClient;
  demo: DemoClient | null;
  ready: boolean;
  authenticated: boolean;
  wallet: string | null;
  login: () => void;
  logout: () => void;
};

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside Providers');
  return s;
}

function DemoProviders({ children }: { children: React.ReactNode }) {
  const demo = useMemo(() => new DemoClient(), []);
  const value: Session = useMemo(
    () => ({ mode: 'demo', client: demo, demo, ready: true, authenticated: true, wallet: demo.wallet, login: () => {}, logout: () => demo.reset() }),
    [demo]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function LiveSession({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const wallet = wallets[0] ?? null;

  const value: Session = useMemo(() => {
    const sign = wallet
      ? async (transaction: Uint8Array) => {
          const { signedTransaction } = await signTransaction({ transaction, wallet });
          return signedTransaction;
        }
      : null;
    return {
      mode: 'live',
      client: new LiveClient(getAccessToken, sign),
      demo: null,
      ready,
      authenticated,
      wallet: wallet?.address ?? null,
      login,
      logout,
    };
  }, [ready, authenticated, wallet, signTransaction, getAccessToken, login, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function LiveProviders({ children }: { children: React.ReactNode }) {
  const wss = PUBLIC_RPC_URL.replace(/^http/, 'ws');
  const chain = NETWORK === 'devnet' ? 'solana:devnet' : 'solana:mainnet';
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID || undefined}
      config={{
        loginMethods: ['email'],
        appearance: { theme: 'light', accentColor: '#cef17b', walletChainType: 'solana-only', showWalletLoginFirst: false },
        embeddedWallets: {
          solana: { createOnLogin: 'all-users' },
          ethereum: { createOnLogin: 'off' },
        },
        solana: {
          rpcs: {
            [chain]: { rpc: createSolanaRpc(PUBLIC_RPC_URL), rpcSubscriptions: createSolanaRpcSubscriptions(wss) },
          },
        },
      }}
    >
      <LiveSession>{children}</LiveSession>
    </PrivyProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return IS_DEMO ? <DemoProviders>{children}</DemoProviders> : <LiveProviders>{children}</LiveProviders>;
}
