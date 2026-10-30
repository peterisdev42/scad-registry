import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { JsonClient } from './http.js';
import { errorMessage, isMain, isMissing, readJson, writeJson } from './io.js';
import { CodebergProvider } from './providers/codeberg.js';
import { GitHubProvider } from './providers/github.js';
import { buildRegistry } from './registry.js';
import { parseRepository, registrySchema } from './types.js';
import type { Registry } from './types.js';
import { loadLibraries } from './validate.js';

async function loadPrevious(paths: string[]): Promise<Registry | undefined> {
  const registries: Registry[] = [];
  for (const path of new Set(paths)) {
    try { registries.push(registrySchema.parse(await readJson(path))); } catch (error) {
      if (!isMissing(error)) throw new Error(`Cannot read previous registry ${path}: ${errorMessage(error)}`);
    }
  }
  return registries.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: 'string', default: 'data/libraries.json' },
    output: { type: 'string', default: 'dist/registry.json' },
    'cache-dir': { type: 'string', default: '.cache' },
    concurrency: { type: 'string', default: '3' },
    'allow-partial': { type: 'boolean', default: false },
  } });
  const inputPath = resolve(values.input);
  const outputPath = resolve(values.output);
  const cacheDir = resolve(values['cache-dir']);
  const previousPath = join(cacheDir, 'registry.json');
  if (inputPath === outputPath || inputPath === previousPath) throw new Error('Input must not be overwritten by output or cache');
  const libraries = await loadLibraries(inputPath);
  const previous = await loadPrevious([outputPath, previousPath]);
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  const codebergToken = process.env.CODEBERG_TOKEN?.trim();
  if (!githubToken && libraries.some((library) => parseRepository(library.repositoryUrl).provider === 'github')) {
    console.warn('GITHUB_TOKEN is unset. A full build may exceed the unauthenticated GitHub API quota.');
  }
  const github = new JsonClient({
    origin: 'https://api.github.com', cacheDir: join(cacheDir, 'http', 'github'),
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}) },
  });
  const codeberg = new JsonClient({
    origin: 'https://codeberg.org', cacheDir: join(cacheDir, 'http', 'codeberg'),
    headers: { Accept: 'application/json', ...(codebergToken ? { Authorization: `token ${codebergToken}` } : {}) },
  });
  const registry = await buildRegistry(libraries, {
    providers: { github: new GitHubProvider(github), codeberg: new CodebergProvider(codeberg) },
    concurrency: Number(values.concurrency),
    ...(previous ? { previous } : {}),
    onLibrary: (library) => {
      console.log(`${library.sync.status.padEnd(5)} ${library.id}: ${library.versions.length} version(s)`);
      if (library.sync.status !== 'ok') console.error(`  ${library.sync.error}`);
    },
  });
  await writeJson(outputPath, registry);
  await writeJson(previousPath, registry);
  const failed = registry.libraries.filter((library) => library.sync.status !== 'ok').length;
  const versions = registry.libraries.reduce((sum, library) => sum + library.versions.length, 0);
  console.log(`Wrote ${outputPath}: ${libraries.length} libraries, ${versions} versions, ${failed} sync failure(s)`);
  if (failed && !values['allow-partial']) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => { console.error(errorMessage(error)); process.exitCode = 1; });
}
