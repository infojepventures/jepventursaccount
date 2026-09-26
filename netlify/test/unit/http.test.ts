import { describe, expect, it } from 'vitest';
import { fail } from '../../lib/errors';
import { handle, readJson } from '../../lib/http';

const post = (body: unknown) => new Request('http://x/fn', { method: 'POST', body: JSON.stringify(body) });

describe('handle', () => {
  it('returns JSON results', async () => {
    const res = await handle(async (req) => ({ echo: (await readJson<{ a: number }>(req)).a }))(post({ a: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echo: 1 });
  });
  it('maps ApiError to its status and code', async () => {
    const res = await handle(async () => {
      throw fail.statusChanged();
    })(post({}));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'STATUS_CHANGED' });
  });
  it('hides unexpected errors behind INTERNAL', async () => {
    const res = await handle(async () => {
      throw new Error('secret detail');
    })(post({}));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  });
  it('rejects the wrong method', async () => {
    const res = await handle(async () => ({}))(new Request('http://x/fn', { method: 'GET' }));
    expect(res.status).toBe(405);
  });
  it('passes Response results through', async () => {
    const res = await handle(async () => new Response('raw', { status: 200 }), { method: 'GET' })(
      new Request('http://x/fn'),
    );
    expect(await res.text()).toBe('raw');
  });
  it('rejects malformed JSON with INVALID_INPUT', async () => {
    const res = await handle(async (req) => readJson(req))(new Request('http://x', { method: 'POST', body: '{' }));
    expect(res.status).toBe(400);
  });
});
