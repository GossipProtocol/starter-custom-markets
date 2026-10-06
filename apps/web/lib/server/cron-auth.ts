import { NextRequest, NextResponse } from 'next/server';

/** Crons are callable only with CRON_SECRET. With no secret set, they refuse
 *  in production and run freely in development. */
export function requireCron(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV === 'production'
      ? NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 500 })
      : null;
  }
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
