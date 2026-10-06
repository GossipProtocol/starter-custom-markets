import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { HttpError } from './privy';

type Handler = (request: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>;

/** Turns thrown HttpErrors and zod errors into JSON responses. Everything
 *  else is a 500 with a generic body; the detail goes to the server log. */
export function route(handler: Handler): Handler {
  return async (request, ctx) => {
    try {
      return await handler(request, ctx);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: e.issues.map((i) => i.message).join('; ') }, { status: 400 });
      console.error(`[${request.method} ${new URL(request.url).pathname}]`, e);
      return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
    }
  };
}
