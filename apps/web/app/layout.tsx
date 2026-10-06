import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { Header } from '@/components/Header';

export const metadata: Metadata = {
  title: 'Custom Markets',
  description: 'Parimutuel markets with a time multiplier, settled in USDC on Solana.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
