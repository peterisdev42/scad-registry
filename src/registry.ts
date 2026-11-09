import { errorMessage } from './io.js';
import { librariesSchema, parseRepository, registrySchema } from './types.js';
import type { Library, Provider, Registry, RegistryLibrary } from './types.js';
import { resolveVersions } from './versions.js';

export interface BuildOptions {
  providers: Record<'github' | 'codeberg', Provider>;
  previous?: Registry;
  concurrency?: number;
  now?: () => Date;
  onLibrary?: (library: RegistryLibrary) => void;
}

export async function buildRegistry(input: Library[], options: BuildOptions): Promise<Registry> {
  const libraries = librariesSchema.parse(input);
  const concurrency = options.concurrency ?? 3;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('Concurrency must be an integer from 1 to 3');
  const previous = new Map(options.previous?.libraries.map((library) => [library.id, library]));
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const results: RegistryLibrary[] = new Array(libraries.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < libraries.length) {
      const index = cursor++;
      const library = libraries[index]!;
      const repository = parseRepository(library.repositoryUrl);
      let result: RegistryLibrary;
      try {
        const data = await options.providers[repository.provider].fetchRepository(repository);
        result = {
          ...library,
          defaultBranch: data.defaultBranch,
          archived: data.archived,
          ...resolveVersions(data),
          sync: { status: 'ok', attemptedAt: generatedAt, lastSuccessAt: generatedAt },
        };
        // Treat malformed third-party data exactly like a failed synchronization.
        registrySchema.parse({ schemaVersion: 1, generatedAt, libraries: [result] });
      } catch (error) {
        const old = previous.get(library.id);
        const reusable = old?.sync.lastSuccessAt &&
          parseRepository(old.repositoryUrl).url.toLowerCase() === repository.url.toLowerCase();
        result = reusable ? {
          ...old,
          ...library,
          sync: { status: 'stale', attemptedAt: generatedAt, lastSuccessAt: old.sync.lastSuccessAt!, error: errorMessage(error) },
        } : {
          ...library,
          defaultBranch: null,
          archived: null,
          versions: [],
          latestVersion: null,
          sync: { status: 'error', attemptedAt: generatedAt, lastSuccessAt: null, error: errorMessage(error) },
        };
      }
      results[index] = result;
      options.onLibrary?.(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, libraries.length) }, worker));
  return registrySchema.parse({ schemaVersion: 1, generatedAt, libraries: results });
}
