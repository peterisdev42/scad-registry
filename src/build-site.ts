import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { errorMessage, isMain } from './io.js';

const ASSETS = ['index.html', 'styles.css', 'app.js', 'favicon.svg'] as const;

/** Combine the static site with the already-built registry without altering its JSON. */
export async function buildSite(rootDir = process.cwd()): Promise<void> {
  const root = resolve(rootDir);
  const source = join(root, 'web');
  const output = join(root, 'dist');
  await access(join(output, 'registry.json')).catch(() => {
    throw new Error('Missing dist/registry.json. Run npm run build first.');
  });
  await mkdir(output, { recursive: true });
  for (const file of ASSETS) {
    await copyFile(join(source, file), join(output, file));
  }
  await writeFile(join(output, '.nojekyll'), '');
  console.log('Built GitHub Pages site in dist/ (index.html + assets + registry.json)');
}

if (isMain(import.meta.url)) {
  buildSite().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
