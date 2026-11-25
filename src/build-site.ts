import { access, copyFile, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { errorMessage, isMain } from './io.js';

const MODULES = ['fonts','colors','spacing','typography','materials','motion','grid','base','components'] as const;
/** Publish an assembled static website without changing the registry contract. */
export async function buildSite(rootDir = process.cwd()): Promise<void> {
  const root = resolve(rootDir), source = join(root, 'web'), output = join(root, 'dist');
  await access(join(output, 'registry.json')).catch(() => {
    throw new Error('Missing dist/registry.json. Run npm run build first.');
  });
  const read = (file: string) => readFile(join(source, file), 'utf8');
  const css = (await Promise.all([...MODULES.map(name => 'geist/'+name+'.css'), 'styles.css'].map(read))).join('\n').replaceAll('../assets/fonts/', './assets/fonts/');
  const cssName = 'site.' + createHash('sha256').update(css).digest('hex').slice(0,16) + '.css';
  const app = await read('app.js');
  const appName = 'app.' + createHash('sha256').update(app).digest('hex').slice(0,16) + '.js';
  const theme = await read('geist/theme.js');
  if (/<\/script/i.test(theme)) throw new Error('Unsafe inline theme script');
  const html = (await read('index.html'))
    .replace('<script src="./geist/theme.js"></script>', '<script>'+theme+'</script>')
    .replace('<link rel="stylesheet" href="./geist/index.css">', '<link rel="stylesheet" href="./'+cssName+'">')
    .replace('<link rel="stylesheet" href="./styles.css">', '')
    .replace('src="./app.js"', 'src="./'+appName+'"');
  if (html.includes('./geist/index.css') || !html.includes(cssName) || !html.includes(appName)) throw new Error('Website assembly failed');
  await mkdir(join(output,'geist'), { recursive: true });
  await mkdir(join(output,'assets','fonts'), { recursive: true });
  for (const file of ['favicon.svg','geist/icons.svg','geist/LICENSE','geist/README.md']) await copyFile(join(source,file),join(output,file));
  const fontSource=join(root,'.cache','pages-fonts','node_modules','geist');
  for (const [folder,name] of [['geist-sans','Geist-Variable.woff2'],['geist-mono','GeistMono-Variable.woff2']] as const) {
    const input=join(fontSource,'dist','fonts',folder,name);
    if ((await readFile(input)).subarray(0,4).toString() !== 'wOF2') throw new Error('Invalid Geist WOFF2: '+name);
    await copyFile(input,join(output,'assets','fonts',name));
  }
  const license=(await readdir(fontSource)).find(name=>/^(?:license|licence|ofl)(?:\.(?:txt|md))?$/i.test(name));
  if (!license) throw new Error('Geist font license missing');
  await copyFile(join(fontSource,license),join(output,'assets','fonts','LICENSE.txt'));
  await writeFile(join(output,cssName),css);
  await writeFile(join(output,appName),app);
  await writeFile(join(output,'index.html'),html);
  await writeFile(join(output,'.nojekyll'),'');
  console.log('Built GitHub Pages site in dist/ with shared Geist design system and registry.json');
}
if (isMain(import.meta.url)) {
  buildSite().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
