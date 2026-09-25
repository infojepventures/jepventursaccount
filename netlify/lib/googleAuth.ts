import { SignJWT, importPKCS8 } from 'jose';

export const SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive',
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
} as const;

export type TokenProvider = () => Promise<string>;

export function createTokenProvider(opts: {
  clientEmail: string;
  privateKey: string;
  scopes: string[];
  fetchImpl?: typeof fetch;
}): TokenProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt - 60 > nowSec) return cached.token;

    const key = await importPKCS8(opts.privateKey, 'RS256');
    const assertion = await new SignJWT({ scope: opts.scopes.join(' ') })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(opts.clientEmail)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 3600)
      .sign(key);

    const res = await doFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const text = await res.text();
    let data: { access_token?: string; expires_in?: number } = {};
    try {
      data = JSON.parse(text);
    } catch {
      // non-JSON error body; reported below
    }
    if (!res.ok || !data.access_token) {
      throw new Error(`Google token request failed: ${res.status} ${text}`);
    }
    cached = { token: data.access_token, expiresAt: nowSec + (data.expires_in ?? 3600) };
    return cached.token;
  };
}
