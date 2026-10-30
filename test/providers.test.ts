import assert from 'node:assert/strict';
import test from 'node:test';
import { JsonClient } from '../src/http.js';
import { CodebergProvider } from '../src/providers/codeberg.js';
import { GitHubProvider } from '../src/providers/github.js';
import { parseRepository } from '../src/types.js';
import { json, temporaryDirectory } from './helpers.js';

const sha = 'a'.repeat(40);
const metadata = { default_branch: 'feature/current', archived: false, private: false };

test('GitHub fetches all tags and releases, excludes drafts and uses canonical SHA archive URLs', async (t) => {
  const paths: string[] = [];
  const client = new JsonClient({ origin: 'https://api.github.com', cacheDir: await temporaryDirectory(t), fetch: async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.searchParams.get('page') === '2') return json([]);
    if (url.pathname.endsWith('/tags')) return json([{ name: 'v1.0.0', commit: { sha } }]);
    if (url.pathname.endsWith('/releases')) return json([
      { tag_name: 'v1.0.0', draft: false, prerelease: false, html_url: 'https://github.com/new/repo/releases/tag/v1.0.0', published_at: null },
      { tag_name: 'v2.0.0', draft: true, prerelease: true, html_url: 'https://github.com/new/repo/releases/tag/v2.0.0', published_at: null },
    ]);
    return json({ ...metadata, html_url: 'https://github.com/new/repo' });
  } });
  const result = await new GitHubProvider(client).fetchRepository(parseRepository('https://github.com/old/repo'));
  assert.deepEqual(result.tags, [{ name: 'v1.0.0', commit: sha }]);
  assert.equal(result.releases.length, 1);
  assert.equal(result.downloadUrl(sha), `https://github.com/new/repo/archive/${sha}.zip`);
  assert.ok(!paths.some((path) => path.includes('/commits/')));
});

test('GitHub resolves the exact default-branch head only when tags are absent', async (t) => {
  let head = false;
  const client = new JsonClient({ origin: 'https://api.github.com', cacheDir: await temporaryDirectory(t), fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/tags') || url.pathname.endsWith('/releases')) return json([]);
    if (url.pathname.includes('/commits/')) { head = true; assert.ok(url.pathname.endsWith('feature%2Fcurrent')); return json({ sha }); }
    return json({ ...metadata, html_url: 'https://github.com/owner/repo' });
  } });
  const result = await new GitHubProvider(client).fetchRepository(parseRepository('https://github.com/owner/repo'));
  assert.equal(result.snapshotCommit, sha);
  assert.equal(head, true);
});

test('Codeberg uses Forgejo pagination and resolves tagless repositories through the commit API', async (t) => {
  const calls: string[] = [];
  const client = new JsonClient({ origin: 'https://codeberg.org', cacheDir: await temporaryDirectory(t), fetch: async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith('/tags') || url.pathname.endsWith('/releases')) {
      assert.equal(url.searchParams.get('limit'), '50');
      assert.equal(url.searchParams.has('per_page'), false);
      return json([]);
    }
    if (url.pathname.includes('/git/commits/')) return json({ sha });
    return json({ ...metadata, html_url: 'https://codeberg.org/owner/repo' });
  } });
  const result = await new CodebergProvider(client).fetchRepository(parseRepository('https://codeberg.org/owner/repo'));
  assert.equal(result.snapshotCommit, sha);
  assert.equal(result.downloadUrl(sha), `https://codeberg.org/owner/repo/archive/${sha}.zip`);
  assert.ok(calls.includes('/api/v1/repos/owner/repo/git/commits/feature%2Fcurrent'));
});

test('Codeberg tags retain raw names and point at their commit, ignoring the mutable zipball_url', async (t) => {
  const client = new JsonClient({ origin: 'https://codeberg.org', cacheDir: await temporaryDirectory(t), fetch: async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get('page') === '2') return json([]);
    if (url.pathname.endsWith('/tags')) return json([{ name: '2025.01', commit: { sha }, zipball_url: 'https://codeberg.org/owner/repo/archive/2025.01.zip' }]);
    if (url.pathname.endsWith('/releases')) return json([]);
    return json({ ...metadata, html_url: 'https://codeberg.org/owner/repo' });
  } });
  const result = await new CodebergProvider(client).fetchRepository(parseRepository('https://codeberg.org/owner/repo'));
  assert.deepEqual(result.tags, [{ name: '2025.01', commit: sha }]);
  assert.equal(result.snapshotCommit, undefined);
  assert.equal(result.downloadUrl(sha), `https://codeberg.org/owner/repo/archive/${sha}.zip`);
});

test('private repositories cannot be published even with authenticated API access', async (t) => {
  const client = new JsonClient({ origin: 'https://api.github.com', cacheDir: await temporaryDirectory(t), fetch: async () =>
    json({ ...metadata, private: true, html_url: 'https://github.com/owner/repo' }) });
  await assert.rejects(new GitHubProvider(client).fetchRepository(parseRepository('https://github.com/owner/repo')), /false/);
});

test('Codeberg repositories with the releases unit disabled still get an installable snapshot', async (t) => {
  const client = new JsonClient({ origin: 'https://codeberg.org', cacheDir: await temporaryDirectory(t), fetch: async (input) => {
    const url = new URL(String(input));
    assert.ok(!url.pathname.endsWith('/releases'), 'Disabled release API must not be called');
    if (url.pathname.endsWith('/tags')) return json([]);
    if (url.pathname.includes('/git/commits/')) return json({ sha });
    return json({ ...metadata, has_releases: false, html_url: 'https://codeberg.org/owner/repo' });
  } });
  const result = await new CodebergProvider(client).fetchRepository(parseRepository('https://codeberg.org/owner/repo'));
  assert.deepEqual(result.releases, []);
  assert.equal(result.snapshotCommit, sha);
});

test('Codeberg releases API failures are not mistaken for an explicitly disabled unit', async (t) => {
  const client = new JsonClient({ origin: 'https://codeberg.org', cacheDir: await temporaryDirectory(t), fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/tags')) return json([]);
    if (url.pathname.endsWith('/releases')) return new Response(null, { status: 404 });
    return json({ ...metadata, has_releases: true, html_url: 'https://codeberg.org/owner/repo' });
  } });
  await assert.rejects(new CodebergProvider(client).fetchRepository(parseRepository('https://codeberg.org/owner/repo')), /HTTP 404/);
});
