import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSite } from '../src/build-site.js';

test('buildSite copies assets alongside the unchanged registry and adds .nojekyll', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scad-registry-pages-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'web'));
  await mkdir(join(root, 'dist'));
  const registry = '{"schemaVersion":1,"libraries":[]}';
  await writeFile(join(root, 'dist', 'registry.json'), registry);
  for (const file of ['index.html', 'styles.css', 'app.js', 'favicon.svg']) {
    await writeFile(join(root, 'web', file), 'asset:' + file);
  }
  await buildSite(root);
  const output = await readdir(join(root, 'dist'));
  assert.deepEqual(output.sort(), ['.nojekyll', 'app.js', 'favicon.svg', 'index.html', 'registry.json', 'styles.css']);
  assert.equal(await readFile(join(root, 'dist', 'registry.json'), 'utf8'), registry);
  assert.equal(await readFile(join(root, 'dist', 'index.html'), 'utf8'), 'asset:index.html');
});

test('buildSite refuses to publish without a generated registry', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scad-registry-pages-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await assert.rejects(buildSite(root), /Missing dist\/registry.json/);
});
