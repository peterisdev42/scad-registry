import { JsonClient } from '../http.js';
import { z } from 'zod';
import type { Provider, Repository, RepositoryData } from '../types.js';
import { canonicalRepository, headSchema, releases, repositorySchema, tags } from './shared.js';

export class CodebergProvider implements Provider {
  constructor(private readonly client: JsonClient) {}

  async fetchRepository(repository: Repository): Promise<RepositoryData> {
    const base = `/api/v1/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
    const metadata = repositorySchema.extend({ has_releases: z.boolean().optional() }).parse((await this.client.get(base)).data);
    const canonical = canonicalRepository(metadata.html_url, repository);
    const repoTags = tags(await this.client.list(`${base}/tags`, 'limit'));
    // Forgejo returns 404 for the releases endpoint when this repository unit
    // is disabled. Only explicit metadata permits skipping that endpoint.
    const repoReleases = metadata.has_releases === false ? [] : releases(await this.client.list(`${base}/releases`, 'limit'));
    const result: RepositoryData = {
      defaultBranch: metadata.default_branch,
      archived: metadata.archived,
      tags: repoTags,
      releases: repoReleases,
      downloadUrl: (commit) => `${canonical.url}/archive/${encodeURIComponent(commit)}.zip`,
    };
    if (!repoTags.length) {
      result.snapshotCommit = headSchema.parse((await this.client.get(`${base}/git/commits/${encodeURIComponent(metadata.default_branch)}`)).data).sha;
    }
    return result;
  }
}
