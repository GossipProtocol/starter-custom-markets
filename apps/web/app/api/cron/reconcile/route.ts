import { NextRequest, NextResponse } from 'next/server';
import { requireCron } from '@/lib/server/cron-auth';
import { assertLive } from '@/lib/server/env';
import { route } from '@/lib/server/handler';
import { reconcileAll } from '@/lib/server/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Every two minutes: re-read live markets and open positions from the
 *  chain. This is what makes the database a cache instead of a ledger. */
export const GET = route(async (request: NextRequest) => {
  const denied = requireCron(request);
  if (denied) return denied;
  assertLive();
  const started = Date.now();
  const report = await reconcileAll();
  return NextResponse.json({ ...report, ms: Date.now() - started });
});
