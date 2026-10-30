import { z } from 'zod';
import { commitSchema, parseRepository } from '../types.js';
import type { Repository } from '../types.js';

export const repositorySchema = z.object({
  default_branch: z.string().min(1),
  archived: z.boolean(),
  private: z.literal(false),
  html_url: z.string(),
});
export const tagsSchema = z.array(z.object({ name: z.string().min(1), commit: z.object({ sha: commitSchema }) }));
export const releasesSchema = z.array(z.object({
  tag_name: z.string().min(1),
  draft: z.boolean(),
  prerelease: z.boolean(),
  html_url: z.url(),
  published_at: z.iso.datetime({ offset: true }).nullable(),
}));
export const headSchema = z.object({ sha: commitSchema });

export function canonicalRepository(htmlUrl: string, repository: Repository): Repository {
  const canonical = parseRepository(htmlUrl);
  if (canonical.provider !== repository.provider) throw new Error('Repository redirected to a different forge');
  return canonical;
}

export function releases(value: unknown) {
  return releasesSchema.parse(value).filter((release) => !release.draft).map((release) => ({
    tag: release.tag_name,
    prerelease: release.prerelease,
    url: release.html_url,
    publishedAt: release.published_at,
  }));
}

export function tags(value: unknown) {
  return tagsSchema.parse(value).map((tag) => ({ name: tag.name, commit: tag.commit.sha }));
}
