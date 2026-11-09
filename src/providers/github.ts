import { JsonClient } from '../http.js';
import type { Provider, Repository, RepositoryData } from '../types.js';
import { canonicalRepository, headSchema, releases, repositorySchema, tags } from './shared.js';

export class GitHubProvider implements Provider {
  constructor(private readonly client: JsonClient) {}

  async fetchRepository(repository: Repository): Promise<RepositoryData> {
    const base = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
    const metadata = repositorySchema.parse((await this.client.get(base)).data);
    const canonical = canonicalRepository(metadata.html_url, repository);
    const repoTags = tags(await this.client.list(`${base}/tags`, 'per_page'));
    const repoReleases = releases(await this.client.list(`${base}/releases`, 'per_page'));
    const result: RepositoryData = {
      defaultBranch: metadata.default_branch,
      archived: metadata.archived,
      tags: repoTags,
      releases: repoReleases,
      downloadUrl: (commit) => `${canonical.url}/archive/${encodeURIComponent(commit)}.zip`,
    };
    if (!repoTags.length) {
      result.snapshotCommit = headSchema.parse((await this.client.get(`${base}/commits/${encodeURIComponent(metadata.default_branch)}`)).data).sha;
    }
    return result;
  }
}
