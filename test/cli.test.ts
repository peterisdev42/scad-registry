import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { registrySchema } from '../src/types.js';
import { temporaryDirectory } from './helpers.js';

const run = promisify(execFile);
const library = { id: 'test', name: 'Test', description: 'Test library', repositoryUrl: 'https://github.com/owner/repo',
  documentationUrl: 'https://example.com/docs', license: 'MIT' };

async function fixture(t: Parameters<typeof temporaryDirectory>[0]) {
  const directory = await temporaryDirectory(t);
  const input = join(directory, 'libraries.json');
  const output = join(directory, 'dist', 'registry.json');
  const cache = join(directory, 'cache');
  const mock = join(directory, 'mock.mjs');
  await writeFile(input, JSON.stringify([library]));
  await writeFile(mock, `
    globalThis.fetch = async (input) => {
      if (process.env.TEST_UPSTREAM_DOWN) return new Response('', { status: 404 });
      const url = new URL(String(input));
      const body = url.pathname.endsWith('/tags') ?
        (url.searchParams.get('page') === '1' ? [{ name: 'v1.0.0', commit: { sha: '${'a'.repeat(40)}' } }] : []) :
        url.pathname.endsWith('/releases') ? [] :
        { default_branch: 'main', archived: false, private: false, html_url: 'https://github.com/owner/repo' };
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    };
  `);
  const build = async (down = false, extra: string[] = []) => {
    try {
      return { code: 0, ...await run(process.execPath, ['--import', 'tsx', '--import', mock, resolve('src/build.ts'),
        '--input', input, '--output', output, '--cache-dir', cache, ...extra], {
        env: { ...process.env, GITHUB_TOKEN: '', CODEBERG_TOKEN: '', TEST_UPSTREAM_DOWN: down ? '1' : '' },
      }) };
    } catch (error) {
      const failed = error as Error & { code: number; stdout: string; stderr: string };
      return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
    }
  };
  return { input, output, cache, build };
}

test('CLI builds a validated artifact and restores last success from cache when dist is removed', async (t) => {
  const f = await fixture(t);
  const first = await f.build();
  assert.equal(first.code, 0, first.stderr);
  const original = registrySchema.parse(JSON.parse(await readFile(f.output, 'utf8')));
  await rm(f.output);
  const failed = await f.build(true);
  assert.equal(failed.code, 1);
  const stale = registrySchema.parse(JSON.parse(await readFile(f.output, 'utf8')));
  assert.equal(stale.libraries[0]!.sync.status, 'stale');
  assert.deepEqual(stale.libraries[0]!.versions, original.libraries[0]!.versions);
  const partial = await f.build(true, ['--allow-partial']);
  assert.equal(partial.code, 0, partial.stderr);
});

test('CLI writes failed base entries and returns nonzero on a first-run API failure', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.build(true)).code, 1);
  const registry = registrySchema.parse(JSON.parse(await readFile(f.output, 'utf8')));
  assert.equal(registry.libraries.length, 1);
  assert.equal(registry.libraries[0]!.sync.status, 'error');
  assert.deepEqual(registry.libraries[0]!.versions, []);
});

test('CLI validates input before touching previous output and refuses to overwrite the input', async (t) => {
  const f = await fixture(t);
  await writeFile(f.input, JSON.stringify([{ ...library, license: '' }]));
  assert.equal((await f.build()).code, 1);
  await assert.rejects(access(f.output));
  await writeFile(f.input, JSON.stringify([library]));
  const before = await readFile(f.input, 'utf8');
  const attempt = await f.build(false, ['--output', f.input]);
  assert.equal(attempt.code, 1);
  assert.equal(await readFile(f.input, 'utf8'), before);
});

test('CLI refuses to replace a damaged previous registry with an empty fallback', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.build()).code, 0);
  await writeFile(f.output, 'damaged registry');
  const result = await f.build(true);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Cannot read previous registry/);
  assert.equal(await readFile(f.output, 'utf8'), 'damaged registry');
});
