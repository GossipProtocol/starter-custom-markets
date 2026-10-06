'use client';

import Link from 'next/link';
import { useSession } from '@/app/providers';
import { usdc } from '@/lib/maths';
import { useDemoTick } from '@/hooks/useDemoTick';

export function Header() {
  const { mode, demo, ready, authenticated, wallet, login, logout } = useSession();
  useDemoTick();
  const short = wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : null;

  return (
    <header className="sticky top-0 z-10 border-b border-ink/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/" className="font-bold">
            Markets
          </Link>
          <Link href="/me" className="text-ink/70 hover:text-ink">
            My positions
          </Link>
          <Link href="/admin" className="text-ink/70 hover:text-ink">
            Admin
          </Link>
        </nav>
        <div className="flex items-center gap-2 text-sm">
          {mode === 'demo' ? (
            <>
              <span className="pill bg-lime">demo</span>
              <span className="font-mono">{usdc.format(demo!.balance())} USDC</span>
              <button className="btn-ghost" onClick={() => demo!.skip(6 * 3600)} title="Advance the demo clock six hours">
                +6h
              </button>
            </>
          ) : !ready ? (
            <span className="text-ink/50">loading</span>
          ) : authenticated ? (
            <>
              <span className="font-mono text-ink/70">{short ?? 'creating wallet'}</span>
              <button className="btn-ghost" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={login}>
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
