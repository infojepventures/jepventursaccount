export interface ShortenerApi {
  /** Returns a short https link that redirects to `url`. Throws on failure. */
  shorten(url: string): Promise<string>;
}

const API = 'https://api.tinyurl.com/create';
const FREE_API = 'https://tinyurl.com/api-create.php';
const TIMEOUT_MS = 5000;
const TINY_LINK = /^https:\/\/tinyurl\.com\/[A-Za-z0-9_-]+$/;

/**
 * TinyURL. Without a token it uses the free, account-less api-create.php endpoint (as in the Sheets formula
 * `importData("http://tinyurl.com/api-create.php?url=" & url)`); with TINYURL_API_TOKEN it uses the official API.
 */
export class TinyUrlClient implements ShortenerApi {
  constructor(
    private readonly token: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async shorten(url: string): Promise<string> {
    const tiny = this.token ? await this.viaApi(url, this.token) : await this.viaFreeEndpoint(url);
    if (!TINY_LINK.test(tiny)) throw new Error('TinyURL returned no usable link');
    return tiny;
  }

  private async viaFreeEndpoint(url: string): Promise<string> {
    const res = await this.fetchImpl(`${FREE_API}?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`TinyURL api-create failed: ${res.status}`);
    return (await res.text()).trim().replace(/^http:\/\//, 'https://');
  }

  private async viaApi(url: string, token: string): Promise<string> {
    const res = await this.fetchImpl(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, domain: 'tinyurl.com' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`TinyURL create failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const tiny = ((await res.json()) as { data?: { tiny_url?: unknown } }).data?.tiny_url;
    if (typeof tiny !== 'string') throw new Error('TinyURL returned no usable link');
    return tiny;
  }
}
