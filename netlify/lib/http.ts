import { timingSafeEqual } from 'node:crypto';
import type { ApiErrorBody } from '@jep/shared';
import { ApiError, fail } from './errors';

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function handle(
  fn: (req: Request) => Promise<unknown>,
  opts: { method?: 'GET' | 'POST' } = {},
): (req: Request) => Promise<Response> {
  const method = opts.method ?? 'POST';
  return async (req) => {
    if (req.method !== method) {
      return json({ error: 'METHOD_NOT_ALLOWED', message: `Use ${method}` } satisfies ApiErrorBody, 405);
    }
    try {
      const result = await fn(req);
      if (result instanceof Response) return result;
      return json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.code, message: e.message } satisfies ApiErrorBody, e.status);
      console.error('[api] unexpected error', e);
      return json({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' } satisfies ApiErrorBody, 500);
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw fail.invalid('Request body must be valid JSON');
  }
}
