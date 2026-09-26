import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { createTokenProvider, SCOPES } from '../../lib/googleAuth';

describe('createTokenProvider', () => {
  it('exchanges a signed JWT for an access token and caches it', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const pem = await exportPKCS8(privateKey);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      const claims = decodeJwt(body.get('assertion')!);
      expect(claims.iss).toBe('sa@test.iam.gserviceaccount.com');
      expect(claims.scope).toBe(`${SCOPES.drive} ${SCOPES.sheets}`);
      return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 });
    });
    const getToken = createTokenProvider({
      clientEmail: 'sa@test.iam.gserviceaccount.com',
      privateKey: pem,
      scopes: [SCOPES.drive, SCOPES.sheets],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await getToken()).toBe('tok-1');
    expect(await getToken()).toBe('tok-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws a descriptive error when Google rejects the request', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const getToken = createTokenProvider({
      clientEmail: 'sa@test',
      privateKey: await exportPKCS8(privateKey),
      scopes: [SCOPES.drive],
      fetchImpl: (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch,
    });
    await expect(getToken()).rejects.toThrow(/invalid_grant/);
  });
});
