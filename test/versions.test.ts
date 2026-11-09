import assert from 'node:assert/strict';
import test from 'node:test';
import { versionSchema } from '../src/types.js';
import type { RepositoryData } from '../src/types.js';
import { resolveVersions } from '../src/versions.js';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
function data(tags: string[], overrides: Partial<RepositoryData> = {}): RepositoryData {
  return {
    defaultBranch: 'main', archived: false,
    tags: tags.map((name) => ({ name, commit: sha })), releases: [],
    downloadUrl: (commit) => `https://github.com/test/repo/archive/${commit}.zip`,
    ...overrides,
  };
}

test('merges tags and releases, deduplicates tags, and pins downloads to the tag commit', () => {
  const result = resolveVersions(data(['v1.0.0', 'v1.0.0', 'v2.0.0', 'v1.9.0'], {
    releases: [
      { tag: 'v2.0.0', prerelease: true, url: 'https://github.com/test/repo/releases/tag/v2.0.0', publishedAt: '2026-08-01T12:00:00Z' },
      { tag: 'deleted-tag', prerelease: false, url: 'https://github.com/test/repo/releases/tag/deleted-tag', publishedAt: null },
    ],
  }));
  assert.deepEqual(result.versions.map((v) => v.tag), ['v2.0.0', 'v1.9.0', 'v1.0.0']);
  assert.equal(result.latestVersion, 'v1.9.0');
  assert.equal(result.versions[0]!.prerelease, true);
  assert.equal(result.versions[0]!.publishedAt, '2026-08-01T12:00:00Z');
  assert.equal(result.versions[2]!.releaseUrl, null);
  for (const version of result.versions) assert.equal(version.downloadUrl, `https://github.com/test/repo/archive/${sha}.zip`);
});

test('SemVer comparison handles multi-digit components and prereleases', () => {
  const result = resolveVersions(data(['v1.9.0', 'v1.10.0', 'v2.0.0-beta.2', 'v2.0.0-beta.10']));
  assert.deepEqual(result.versions.map((v) => v.tag), ['v2.0.0-beta.10', 'v2.0.0-beta.2', 'v1.10.0', 'v1.9.0']);
  assert.equal(result.latestVersion, 'v1.10.0');
  assert.equal(result.versions[0]!.prerelease, true);
});

test('preserves non-SemVer names and leaves latest ambiguous, independent of API ordering', () => {
  const names = ['2025.01', 'v1.2', 'beta', 'v3.0.0'];
  const a = resolveVersions(data(names));
  const b = resolveVersions(data([...names].reverse()));
  assert.deepEqual(a, b);
  assert.equal(a.latestVersion, null);
  assert.equal(a.versions.find((v) => v.tag === 'v1.2')!.prerelease, null);
  assert.deepEqual(new Set(a.versions.map((v) => v.tag)), new Set(names));
});

test('sorts non-SemVer releases by publication date with deterministic ties', () => {
  const result = resolveVersions(data(['old', 'new', 'beta'], { releases: [
    { tag: 'old', prerelease: false, url: 'https://github.com/test/repo/releases/tag/old', publishedAt: '2025-01-01T00:00:00Z' },
    { tag: 'new', prerelease: true, url: 'https://github.com/test/repo/releases/tag/new', publishedAt: '2026-01-01T00:00:00Z' },
  ] }));
  assert.deepEqual(result.versions.map((v) => v.tag), ['new', 'old', 'beta']);
  assert.equal(result.latestVersion, null);
});

test('tagless repositories have a clearly marked immutable development snapshot', () => {
  const result = resolveVersions(data([], { snapshotCommit: other }));
  assert.deepEqual(result, {
    latestVersion: null,
    versions: [{ kind: 'snapshot', tag: null, branch: 'main', commit: other,
      prerelease: true, releaseUrl: null, publishedAt: null,
      downloadUrl: `https://github.com/test/repo/archive/${other}.zip` }],
  });
  assert.throws(() => resolveVersions(data([])), /commit SHA|Invalid input/);
});

test('rejects conflicting tag commits and abbreviated SHAs', () => {
  assert.throws(() => resolveVersions(data([], { tags: [{ name: 'v1.0.0', commit: sha }, { name: 'v1.0.0', commit: other }] })), /Conflicting/);
  assert.throws(() => resolveVersions(data([], { tags: [{ name: 'v1.0.0', commit: 'abcdef0' }] })), /full commit SHA/);
});

test('prereleases alone never become the latest stable version', () => {
  assert.equal(resolveVersions(data(['v1.0.0-rc.1'])).latestVersion, null);
});

test('output validation rejects a mutable or mismatched archive URL', () => {
  const version = resolveVersions(data(['v1.0.0'])).versions[0]!;
  assert.throws(() => versionSchema.parse({ ...version, downloadUrl: 'https://github.com/test/repo/archive/v1.0.0.zip' }), /pinned/);
  assert.throws(() => versionSchema.parse({ ...version, downloadUrl: `https://github.com/test/repo/archive/${other}.zip` }), /pinned/);
  assert.equal(versionSchema.safeParse({ ...version, downloadUrl: 'not a URL' }).success, false);
});
