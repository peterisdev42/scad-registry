import semver from 'semver';
import { commitSchema, versionSchema } from './types.js';
import type { RegistryVersion, RepositoryData } from './types.js';

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** SemVer tags first; other names retain their spelling and are display-sorted. */
export function compareVersions(a: RegistryVersion, b: RegistryVersion): number {
  if (a.kind !== 'tag' || b.kind !== 'tag') return compareText(a.kind, b.kind);
  const av = semver.valid(a.tag);
  const bv = semver.valid(b.tag);
  if (av && bv) return semver.rcompare(av, bv) || compareText(a.tag, b.tag);
  if (av || bv) return av ? -1 : 1;
  const dates = (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0);
  return dates || compareText(a.tag, b.tag);
}

export function resolveVersions(repository: RepositoryData): { versions: RegistryVersion[]; latestVersion: string | null } {
  const releaseByTag = new Map(repository.releases.map((release) => [release.tag, release]));
  const byTag = new Map<string, RegistryVersion>();
  for (const tag of repository.tags) {
    const commit = commitSchema.parse(tag.commit).toLowerCase();
    const existing = byTag.get(tag.name);
    if (existing && existing.commit !== commit) throw new Error(`Conflicting commits for tag ${tag.name}`);
    const release = releaseByTag.get(tag.name);
    const normalized = semver.valid(tag.name);
    const prerelease = release?.prerelease ?? (normalized ? semver.prerelease(normalized) !== null : null);
    byTag.set(tag.name, versionSchema.parse({
      kind: 'tag',
      tag: tag.name,
      commit,
      prerelease,
      releaseUrl: release?.url ?? null,
      publishedAt: release?.publishedAt ?? null,
      downloadUrl: repository.downloadUrl(commit),
    }));
  }
  if (!byTag.size) {
    const commit = commitSchema.parse(repository.snapshotCommit).toLowerCase();
    return {
      versions: [versionSchema.parse({
        kind: 'snapshot', tag: null, branch: repository.defaultBranch, commit,
        prerelease: true, releaseUrl: null, publishedAt: null, downloadUrl: repository.downloadUrl(commit),
      })],
      latestVersion: null,
    };
  }
  const versions = [...byTag.values()].sort(compareVersions);
  // A date, shortened version, or arbitrary label may be newer than every
  // SemVer tag. Do not claim a reliable latest version in a mixed namespace.
  const allSemver = versions.every((version) => version.kind === 'tag' && semver.valid(version.tag));
  const stable = allSemver ? versions.find((version) => version.kind === 'tag' && version.prerelease === false && semver.prerelease(version.tag) === null) : undefined;
  return { versions, latestVersion: stable?.tag ?? null };
}
