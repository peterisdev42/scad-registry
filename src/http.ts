import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { readJson, writeJson } from './io.js';

const cacheSchema = z.object({ url: z.string(), etag: z.string().nullable(), link: z.string().nullable(), data: z.unknown() });
type CachedResponse = z.infer<typeof cacheSchema>;

interface ClientOptions {
  origin: string;
  cacheDir: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** One client per forge: credentials and pagination are confined to its origin. */
export class JsonClient {
  private readonly request: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private rateLimitError: Error | undefined;

  constructor(private readonly options: ClientOptions) {
    this.request = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => delay(ms));
  }

  private trustedUrl(value: string): URL {
    const url = new URL(value, this.options.origin);
    if (url.origin !== this.options.origin || url.username || url.password) {
      throw new Error('Refusing an API URL outside the configured forge origin');
    }
    return url;
  }

  async get(value: string): Promise<CachedResponse> {
    const url = this.trustedUrl(value).href;
    if (this.rateLimitError) throw this.rateLimitError;
    const path = join(this.options.cacheDir, `${createHash('sha256').update(url).digest('hex')}.json`);
    let cached: CachedResponse | undefined;
    try {
      const parsed = cacheSchema.safeParse(await readJson(path));
      if (parsed.success && parsed.data.url === url) cached = parsed.data;
    } catch { /* A missing or damaged HTTP cache is a cache miss. */ }
    const retries = this.options.retries ?? 2;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const headers = new Headers({ 'User-Agent': 'scad-registry/0.1', ...this.options.headers });
      if (cached?.etag) headers.set('If-None-Match', cached.etag);
      let response: Response;
      try {
        response = await this.request(url, { headers, signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000) });
      } catch {
        if (attempt < retries) { await this.sleep(500 * 2 ** attempt); continue; }
        throw new Error(`API request failed or timed out: ${url}`);
      }
      if (response.status === 304) {
        if (!cached) throw new Error(`API returned 304 without cached data: ${url}`);
        return { ...cached, etag: response.headers.get('etag') ?? cached.etag, link: response.headers.get('link') ?? cached.link };
      }
      if (!response.ok) {
        // Never publish response bodies: they may contain credential or proxy details.
        await response.body?.cancel();
        const limited = response.status === 429 ||
          (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const waitMs = retryAfter === null ? 500 * 2 ** attempt :
          Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        const error = new Error(`API HTTP ${response.status}${limited ? ' (rate limited; use a token or retry later)' : ''}: ${url}`);
        if (limited && (response.headers.get('x-ratelimit-remaining') === '0' || waitMs > 5000 || attempt === retries)) {
          this.rateLimitError = error;
          throw error;
        }
        if ((limited || [500, 502, 503, 504].includes(response.status)) && attempt < retries) {
          if (waitMs > 5000) throw error;
          await this.sleep(Number.isFinite(waitMs) ? Math.max(0, waitMs) : 500 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      // Include body consumption in the timeout/retry boundary as well as fetch().
      let data: unknown;
      try { data = await response.json(); } catch {
        if (attempt < retries) { await this.sleep(500 * 2 ** attempt); continue; }
        throw new Error(`API returned invalid or incomplete JSON: ${url}`);
      }
      const result = { url, etag: response.headers.get('etag'), link: response.headers.get('link'), data };
      await writeJson(path, result);
      return result;
    }
    throw new Error('Unreachable retry state');
  }

  async list(value: string, sizeParameter: 'per_page' | 'limit'): Promise<unknown[]> {
    let url = this.trustedUrl(value);
    url.searchParams.set(sizeParameter, sizeParameter === 'per_page' ? '100' : '50');
    url.searchParams.set('page', '1');
    const seenUrls = new Set<string>();
    const seenPages = new Set<string>();
    const items: unknown[] = [];
    for (let page = 1; page <= 10_000; page++) {
      if (seenUrls.has(url.href)) throw new Error('API pagination repeated a URL');
      seenUrls.add(url.href);
      const response = await this.get(url.href);
      if (!Array.isArray(response.data)) throw new Error(`Expected an API array: ${url.href}`);
      if (response.data.length === 0) return items;
      const fingerprint = createHash('sha256').update(JSON.stringify(response.data)).digest('hex');
      if (seenPages.has(fingerprint)) throw new Error('API pagination repeated a non-empty page');
      seenPages.add(fingerprint);
      items.push(...response.data);
      const next = response.link?.match(/<([^>]+)>\s*;\s*rel="next"/);
      if (next) {
        url = this.trustedUrl(new URL(next[1]!, url).href);
      } else if (response.link) {
        return items;
      } else {
        // Follow numbered pages until empty when a forge omits Link, even if it
        // silently clamps the requested page size to a smaller server maximum.
        url = new URL(url);
        url.searchParams.set('page', String(Number(url.searchParams.get('page')) + 1));
      }
    }
    throw new Error('API exceeded the pagination safety limit');
  }
}
