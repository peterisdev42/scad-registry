import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { JsonClient } from '../src/http.js';
import { json, temporaryDirectory } from './helpers.js';

const origin = 'https://api.github.com';

test('follows every Link page and reuses cached page data and Link headers on 304', async (t) => {
  const cacheDir = await temporaryDirectory(t);
  let round = 0;
  const calls: string[] = [];
  const client = new JsonClient({ origin, cacheDir, fetch: async (input, init) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page'));
    calls.push(url.href);
    if (round) {
      assert.equal(new Headers(init?.headers).get('if-none-match'), `"page-${page}"`);
      return new Response(null, { status: 304 });
    }
    const headers = { etag: `"page-${page}"`, link: page === 1 ?
      `<${origin}/tags?per_page=100&page=2>; rel="next", <${origin}/tags?per_page=100&page=2>; rel="last"` :
      `<${origin}/tags?per_page=100&page=1>; rel="prev"` };
    return json(page === 1 ? Array.from({ length: 100 }, (_, i) => i) : [100, 101], headers);
  } });
  assert.equal((await client.list('/tags', 'per_page')).length, 102);
  round++;
  const again = await client.list('/tags', 'per_page');
  assert.equal(again.length, 102);
  assert.equal(again[101], 101);
  assert.equal(calls.length, 4);
});

test('handles missing Link headers and server-clamped page sizes without dropping tags', async (t) => {
  const calls: number[] = [];
  const client = new JsonClient({ origin, cacheDir: await temporaryDirectory(t), fetch: async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));
    calls.push(page);
    return json(page <= 3 ? [page] : []);
  } });
  assert.deepEqual(await client.list('/tags', 'limit'), [1, 2, 3]);
  assert.deepEqual(calls, [1, 2, 3, 4]);
});

test('damaged HTTP caches are refetched', async (t) => {
  const cacheDir = await temporaryDirectory(t);
  let calls = 0;
  const client = new JsonClient({ origin, cacheDir, fetch: async () => { calls++; return json([calls], { etag: '"etag"' }); } });
  await client.get('/repo');
  const [file] = await readdir(cacheDir);
  await writeFile(join(cacheDir, file!), 'broken json');
  assert.deepEqual((await client.get('/repo')).data, [2]);
});

test('retries transient errors and honors short Retry-After delays', async (t) => {
  const waits: number[] = [];
  let calls = 0;
  const client = new JsonClient({ origin, cacheDir: await temporaryDirectory(t), sleep: async (ms) => { waits.push(ms); }, fetch: async () => {
    calls++;
    if (calls === 1) return new Response('unavailable', { status: 503 });
    if (calls === 2) return new Response('limited', { status: 429, headers: { 'Retry-After': '1' } });
    return json({ ok: true });
  } });
  assert.deepEqual((await client.get('/repo')).data, { ok: true });
  assert.deepEqual(waits, [500, 1000]);
});

test('network failures retry with a bound and do not expose raw errors', async (t) => {
  let calls = 0;
  const client = new JsonClient({ origin, cacheDir: await temporaryDirectory(t), sleep: async () => {}, fetch: async () => {
    calls++;
    throw new Error('a secret from a proxy');
  } });
  await assert.rejects(client.get('/repo'), (error: Error) => error.message.includes('failed or timed out') && !error.message.includes('secret'));
  assert.equal(calls, 3);
});

test('quota exhaustion stops further requests to the forge and never serves stale cache as fresh', async (t) => {
  let calls = 0;
  const client = new JsonClient({ origin, cacheDir: await temporaryDirectory(t), fetch: async () => {
    calls++;
    return new Response('secret response', { status: 403, headers: { 'X-RateLimit-Remaining': '0' } });
  } });
  await assert.rejects(client.get('/repo'), /rate limited/);
  await assert.rejects(client.get('/another'), /rate limited/);
  assert.equal(calls, 1);
});

test('rejects untrusted pagination links before forwarding credentials', async (t) => {
  let calls = 0;
  const client = new JsonClient({ origin, cacheDir: await temporaryDirectory(t), headers: { Authorization: 'Bearer test' }, fetch: async () => {
    calls++;
    return json([1], { Link: '<https://evil.example/steal>; rel="next"' });
  } });
  await assert.rejects(client.list('/tags', 'per_page'), /outside/);
  assert.equal(calls, 1);
  await assert.rejects(client.get('https://evil.example'), /outside/);
});

test('repeated non-empty pages fail instead of looping or publishing a truncated list', async (t) => {
  const client = new JsonClient({ origin, cacheDir: await temporaryDirectory(t), fetch: async () => json([1]) });
  await assert.rejects(client.list('/tags', 'per_page'), /repeated a non-empty page/);
});

test('malformed API shapes and 304 without cache fail clearly', async (t) => {
  const client = new JsonClient({ origin, cacheDir: await temporaryDirectory(t), fetch: async () => json({ error: true }) });
  await assert.rejects(client.list('/tags', 'per_page'), /Expected an API array/);
  const uncached = new JsonClient({ origin, cacheDir: await temporaryDirectory(t), fetch: async () => new Response(null, { status: 304 }) });
  await assert.rejects(uncached.get('/repo'), /without cached data/);
});
