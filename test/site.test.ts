import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSite } from '../src/build-site.js';

test('buildSite bundles shared Geist, preserves registry bytes and links to IDE', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scad-registry-pages-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await cp(join(process.cwd(),'web'),join(root,'web'),{recursive:true});
  await mkdir(join(root,'dist'));
  const registry = '{"schemaVersion":1,"libraries":[]}';
  await writeFile(join(root,'dist','registry.json'),registry);
  const fonts=join(root,'.cache','pages-fonts','node_modules','geist');
  for(const [folder,name] of [['geist-sans','Geist-Variable.woff2'],['geist-mono','GeistMono-Variable.woff2']] as const){
    await mkdir(join(fonts,'dist','fonts',folder),{recursive:true});
    await writeFile(join(fonts,'dist','fonts',folder,name),'wOF2fixture');
  }
  await writeFile(join(fonts,'LICENSE.TXT'),'fixture license');
  await buildSite(root);
  const output=await readdir(join(root,'dist'));
  assert.equal(await readFile(join(root,'dist','registry.json'),'utf8'),registry);
  const html=await readFile(join(root,'dist','index.html'),'utf8');
  assert.match(html,/<html lang="en" data-theme="light">/);
  assert.equal((html.match(/rel="stylesheet"/g)||[]).length,1);
  assert.ok((html.match(/href="https:\/\/peterisdev42\.github\.io\/scad-ai-ide\//g)||[]).length>=3);
  assert.match(html,/data-theme-toggle/);
  assert.match(html,/id="library-search"/);
  assert.match(html,/id="library-grid"/);
  assert.doesNotMatch(html,/id="updated"|catalog-meta/);
  const app=output.find(name=>/^app\.[a-f0-9]{16}\.js$/.test(name));
  assert.ok(app);
  assert.ok(html.includes('src="./'+app+'"'));
  const script=await readFile(join(root,'dist',app),'utf8');
  assert.doesNotMatch(script,/getElementById\("updated"\)|querySelector\("#updated"\)|updated\.textContent|versions\.length \+ \(versions\.length|content\.append\(element\("p", "", library\.description\)\)/);
  assert.doesNotMatch(script,/Show details|Hide details|Default branch|Available versions|details-panel|is-expanded/);
  assert.match(script,/externalLink\(library\.documentationUrl, "Documentation"\)/);
  assert.match(script,/externalLink\(library\.repositoryUrl, "Repository"\)/);
  const css=output.find(name=>/^site\.[a-f0-9]{16}\.css$/.test(name));
  assert.ok(css);
  const contents=await readFile(join(root,'dist',css),'utf8');
  assert.match(contents,/\.\/assets\/fonts\/Geist-Variable\.woff2/);
  assert.doesNotMatch(contents,/@import/);
  assert.match(contents,/scroll-padding-top: var\(--header-height\)/);
  for(const name of ['.nojekyll','favicon.svg','index.html','assets','geist']) assert.ok(output.includes(name));
  assert.equal(await readFile(join(root,'dist','assets','fonts','LICENSE.txt'),'utf8'),'fixture license');
});
test('buildSite refuses to publish without a generated registry', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scad-registry-pages-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await assert.rejects(buildSite(root), /Missing dist\/registry.json/);
});
