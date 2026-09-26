export interface ShortenerApi {
  /** Returns a short https link that redirects to `url`. Throws on failure. */
  shorten(url: string): Promise<string>;
}

const API = 'https://api.tinyurl.com/create';
const TIMEOUT_MS = 5000;

/** TinyURL (https://tinyurl.com/app/dev) with an API token from TINYURL_API_TOKEN. */
export class TinyUrlClient implements ShortenerApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async shorten(url: string): Promise<string> {
    const res = await this.fetchImpl(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, domain: 'tinyurl.com' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`TinyURL create failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const tiny = ((await res.json()) as { data?: { tiny_url?: unknown } }).data?.tiny_url;
    if (typeof tiny !== 'string' || !/^https:\/\/tinyurl\.com\/[A-Za-z0-9_-]+$/.test(tiny)) {
      throw new Error('TinyURL returned no usable link');
    }
    return tiny;
  }
}
