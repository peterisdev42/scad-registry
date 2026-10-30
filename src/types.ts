import { z } from 'zod';

export function parseRepository(value: string) {
  const url = new URL(value);
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      url.search || url.hash || !['github.com', 'codeberg.org'].includes(url.hostname) || !match ||
      [match[1], match[2]].some((part) => part === '.' || part === '..')) {
    throw new Error('Expected an HTTPS GitHub or Codeberg owner/repository URL');
  }
  const owner = match[1]!;
  const repo = match[2]!.replace(/\.git$/, '');
  if (!repo || repo === '.' || repo === '..') throw new Error('Invalid repository name');
  return {
    provider: url.hostname === 'github.com' ? 'github' as const : 'codeberg' as const,
    owner,
    repo,
    url: `https://${url.hostname}/${owner}/${repo}`,
  };
}

const text = z.string().trim().min(1);
const httpsUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Expected an HTTPS URL without credentials');
const repositoryUrl = text.refine((value) => {
  try { parseRepository(value); return true; } catch { return false; }
}, 'Expected an HTTPS GitHub or Codeberg owner/repository URL');

export const librarySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: text,
  description: text,
  repositoryUrl,
  documentationUrl: httpsUrl,
  license: text,
});

export const librariesSchema = z.array(librarySchema).min(1).superRefine((libraries, ctx) => {
  const ids = new Set<string>();
  const repositories = new Set<string>();
  libraries.forEach((library, index) => {
    const repository = parseRepository(library.repositoryUrl).url.toLowerCase();
    if (ids.has(library.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'Duplicate library id' });
    if (repositories.has(repository)) ctx.addIssue({ code: 'custom', path: [index, 'repositoryUrl'], message: 'Duplicate repository' });
    ids.add(library.id);
    repositories.add(repository);
  });
});

export const commitSchema = z.string().regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i, 'Expected a full commit SHA');
const timestamp = z.iso.datetime({ offset: true });
const versionFields = {
  commit: commitSchema,
  prerelease: z.boolean().nullable(),
  releaseUrl: httpsUrl.nullable(),
  publishedAt: timestamp.nullable(),
  downloadUrl: httpsUrl,
};
export const versionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tag'), tag: text, ...versionFields }),
  z.strictObject({ kind: z.literal('snapshot'), tag: z.null(), branch: text, ...versionFields,
    prerelease: z.literal(true), releaseUrl: z.null(), publishedAt: z.null() }),
]).superRefine((version, ctx) => {
  if (!URL.canParse(version.downloadUrl)) return;
  const url = new URL(version.downloadUrl);
  if (!['github.com', 'codeberg.org'].includes(url.hostname) || url.port || url.search || url.hash ||
      !new RegExp(`^/[^/]+/[^/]+/archive/${version.commit}\\.zip$`, 'i').test(url.pathname)) {
    ctx.addIssue({ code: 'custom', path: ['downloadUrl'], message: 'Archive URL must be pinned to the exact commit SHA' });
  }
});

export const registryLibrarySchema = librarySchema.extend({
  defaultBranch: text.nullable(),
  archived: z.boolean().nullable(),
  versions: z.array(versionSchema),
  latestVersion: text.nullable(),
  sync: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('ok'), attemptedAt: timestamp, lastSuccessAt: timestamp }),
    z.strictObject({ status: z.literal('stale'), attemptedAt: timestamp, lastSuccessAt: timestamp, error: text }),
    z.strictObject({ status: z.literal('error'), attemptedAt: timestamp, lastSuccessAt: z.null(), error: text }),
  ]),
}).superRefine((library, ctx) => {
  const tags = library.versions.filter((version) => version.kind === 'tag').map((version) => version.tag);
  if (new Set(tags).size !== tags.length) ctx.addIssue({ code: 'custom', path: ['versions'], message: 'Duplicate tags' });
  const snapshots = library.versions.filter((version) => version.kind === 'snapshot');
  if (snapshots.length > 1 || (snapshots.length && tags.length)) {
    ctx.addIssue({ code: 'custom', path: ['versions'], message: 'A snapshot is only valid for a tagless repository' });
  }
  if (library.latestVersion !== null && !tags.includes(library.latestVersion)) {
    ctx.addIssue({ code: 'custom', path: ['latestVersion'], message: 'Latest version must reference an existing tag' });
  }
  if (library.sync.status !== 'error' && (!library.defaultBranch || !library.versions.length || library.archived === null)) {
    ctx.addIssue({ code: 'custom', message: 'Successful data must have repository metadata and installable versions' });
  }
});

export const registrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: timestamp,
  libraries: z.array(registryLibrarySchema),
}).superRefine((registry, ctx) => {
  const ids = registry.libraries.map((library) => library.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['libraries'], message: 'Duplicate library ids' });
});

export type Library = z.infer<typeof librarySchema>;
export type RegistryVersion = z.infer<typeof versionSchema>;
export type RegistryLibrary = z.infer<typeof registryLibrarySchema>;
export type Registry = z.infer<typeof registrySchema>;
export type Repository = ReturnType<typeof parseRepository>;

export interface Tag { name: string; commit: string }
export interface Release { tag: string; prerelease: boolean; url: string; publishedAt: string | null }
export interface RepositoryData {
  defaultBranch: string;
  archived: boolean;
  tags: Tag[];
  releases: Release[];
  snapshotCommit?: string;
  downloadUrl: (commit: string) => string;
}
export interface Provider { fetchRepository(repository: Repository): Promise<RepositoryData> }
