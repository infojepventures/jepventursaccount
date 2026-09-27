import AsyncStorage from '@react-native-async-storage/async-storage';
import { driveFileUrl } from '@jep/shared';

const TIMEOUT_MS = 4000;
const TINY_LINK = /^https:\/\/tinyurl\.com\/[A-Za-z0-9_-]+$/;
const CACHE_PREFIX = 'shortUrl:';

export interface ShortLinkDeps {
  shorten: (url: string) => Promise<string>;
  cacheGet: (key: string) => Promise<string | null>;
  cacheSet: (key: string, value: string) => Promise<void>;
}

/** TinyURL's free, account-less api-create.php endpoint (the same one the server uses). */
export async function tinyUrlShorten(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`TinyURL failed: ${res.status}`);
    const tiny = (await res.text()).trim().replace(/^http:\/\//, 'https://');
    if (!TINY_LINK.test(tiny)) throw new Error('TinyURL returned no usable link');
    return tiny;
  } finally {
    clearTimeout(timer);
  }
}

const defaultDeps: ShortLinkDeps = {
  shorten: (url) => tinyUrlShorten(url),
  cacheGet: (key) => AsyncStorage.getItem(key),
  cacheSet: (key, value) => AsyncStorage.setItem(key, value),
};

/**
 * Before sharing: give every PDF that has no server-made short link (older claims, or while the server
 * hasn't been redeployed) one made on the device, cached per Drive file. Failures keep the Drive link.
 */
export async function withShortLinks<T extends { pdf: { driveFileId: string | null; shortUrl?: string | null } }>(
  claims: T[],
  deps: ShortLinkDeps = defaultDeps,
): Promise<T[]> {
  const pending = new Map<string, Promise<string | null>>();
  const linkFor = (fileId: string) => {
    let p = pending.get(fileId);
    if (!p) {
      p = (async () => {
        const key = CACHE_PREFIX + fileId;
        const cached = await deps.cacheGet(key).catch(() => null);
        if (cached && TINY_LINK.test(cached)) return cached;
        try {
          const tiny = await deps.shorten(driveFileUrl(fileId));
          await deps.cacheSet(key, tiny).catch(() => {});
          return tiny;
        } catch {
          return null;
        }
      })();
      pending.set(fileId, p);
    }
    return p;
  };

  return Promise.all(
    claims.map(async (c) => {
      if (c.pdf.shortUrl || !c.pdf.driveFileId) return c;
      const shortUrl = await linkFor(c.pdf.driveFileId);
      return shortUrl ? { ...c, pdf: { ...c.pdf, shortUrl } } : c;
    }),
  );
}
