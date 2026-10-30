import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRegistry } from '../src/registry.js';
import { librariesSchema, parseRepository } from '../src/types.js';
import type { Library, Provider } from '../src/types.js';

const sha = 'a'.repeat(40);
const now = () => new Date('2026-10-29T10:00:00Z');
const tomorrow = () => new Date('2026-10-30T10:00:00Z');
const base: Library = { id: 'example', name: 'Example', description: 'A library',
  repositoryUrl: 'https://github.com/owner/repo', documentationUrl: 'https://example.com/docs', license: 'MIT' };
const success: Provider = { fetchRepository: async () => ({ defaultBranch: 'main', archived: false,
  tags: [{ name: 'v1.0.0', commit: sha }], releases: [], downloadUrl: (commit) => `https://github.com/owner/repo/archive/${commit}.zip` }) };
const failure: Provider = { fetchRepository: async () => { throw new Error('Upstream unavailable'); } };
const providers = (provider: Provider) => ({ github: provider, codeberg: provider });

test('keeps every base field, source order, and successful versions despite an individual failure', async () => {
  const input = [base, { ...base, id: 'failed', repositoryUrl: 'https://codeberg.org/owner/failed' }];
  const result = await buildRegistry(input, { providers: { github: success, codeberg: failure }, now });
  assert.deepEqual(result.libraries.map((library) => library.id), ['example', 'failed']);
  assert.equal(result.libraries[0]!.sync.status, 'ok');
  for (const [key, value] of Object.entries(base)) assert.equal(result.libraries[0]![key as keyof Library], value);
  assert.deepEqual(result.libraries[1]!.versions, []);
  assert.equal(result.libraries[1]!.sync.status, 'error');
  assert.equal(result.libraries[1]!.sync.lastSuccessAt, null);
});

test('repeated failures preserve the last successful versions and timestamp while updating base metadata', async () => {
  const first = await buildRegistry([base], { providers: providers(success), now });
  const second = await buildRegistry([{ ...base, description: 'Updated description' }], { providers: providers(failure), previous: first, now: tomorrow });
  const third = await buildRegistry([{ ...base, description: 'Updated description' }], { providers: providers(failure), previous: second, now: tomorrow });
  assert.deepEqual(third.libraries[0]!.versions, first.libraries[0]!.versions);
  assert.equal(third.libraries[0]!.description, 'Updated description');
  assert.equal(third.libraries[0]!.sync.status, 'stale');
  assert.equal(third.libraries[0]!.sync.lastSuccessAt, '2026-10-29T10:00:00.000Z');
  assert.equal(third.libraries[0]!.sync.attemptedAt, '2026-10-30T10:00:00.000Z');
  const recovered = await buildRegistry([base], { providers: providers(success), previous: third, now: tomorrow });
  assert.equal(recovered.libraries[0]!.sync.status, 'ok');
  assert.equal(recovered.libraries[0]!.sync.lastSuccessAt, '2026-10-30T10:00:00.000Z');
});

test('does not reuse a different repository under the same library id', async () => {
  const first = await buildRegistry([base], { providers: providers(success), now });
  const result = await buildRegistry([{ ...base, repositoryUrl: 'https://github.com/owner/different' }], { providers: providers(failure), previous: first, now });
  assert.equal(result.libraries[0]!.sync.status, 'error');
  assert.deepEqual(result.libraries[0]!.versions, []);
});

test('repository processing stays within the concurrency limit and preserves input order', async () => {
  let active = 0;
  let maximum = 0;
  const pending: (() => void)[] = [];
  const provider: Provider = { fetchRepository: async (repository) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => { pending.push(resolve); });
    active--;
    return success.fetchRepository(repository);
  } };
  const input = Array.from({ length: 7 }, (_, i) => ({ ...base, id: `lib-${i}`, repositoryUrl: `https://github.com/owner/repo-${i}` }));
  const resultPromise = buildRegistry(input, { providers: providers(provider), now, concurrency: 2 });
  // Release one request at a time, allowing another worker to start each turn.
  for (let i = 0; i < input.length; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    pending.shift()!();
  }
  const result = await resultPromise;
  assert.equal(maximum, 2);
  assert.deepEqual(result.libraries.map((library) => library.id), input.map((library) => library.id));
});

test('malformed upstream metadata triggers fallback rather than discarding the whole registry', async () => {
  const provider: Provider = { fetchRepository: async (repository) => ({ ...await success.fetchRepository(repository), defaultBranch: '' }) };
  const first = await buildRegistry([base], { providers: providers(success), now });
  const result = await buildRegistry([base], { providers: providers(provider), previous: first, now });
  assert.equal(result.libraries[0]!.sync.status, 'stale');
  assert.deepEqual(result.libraries[0]!.versions, first.libraries[0]!.versions);
});

test('validates required fields, duplicate ids/repositories, supported URLs and concurrency', async () => {
  assert.throws(() => librariesSchema.parse([{ ...base, id: 'Bad ID' }]), /id/);
  assert.throws(() => librariesSchema.parse([{ ...base, license: '' }]), /license/);
  assert.equal(librariesSchema.safeParse([{ ...base, documentationUrl: 'not a URL' }]).success, false);
  assert.throws(() => librariesSchema.parse([base, { ...base, repositoryUrl: 'https://github.com/other/repo' }]), /Duplicate library/);
  assert.throws(() => librariesSchema.parse([base, { ...base, id: 'other', repositoryUrl: 'https://github.com/OWNER/repo.git/' }]), /Duplicate repository/);
  for (const url of ['http://github.com/owner/repo', 'https://github.com/owner/repo/tree/main', 'https://gitlab.com/owner/repo', 'https://token@github.com/owner/repo', 'https://github.com/owner/repo?x=1']) {
    assert.throws(() => parseRepository(url));
  }
  await assert.rejects(buildRegistry([base], { providers: providers(success), concurrency: 4 }), /Concurrency/);
});
