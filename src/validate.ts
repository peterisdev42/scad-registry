import { parseArgs } from 'node:util';
import { errorMessage, isMain, readJson } from './io.js';
import { librariesSchema, registrySchema } from './types.js';

export async function loadLibraries(path: string) {
  return librariesSchema.parse(await readJson(path));
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string', default: 'data/libraries.json' }, registry: { type: 'string' } } });
  const libraries = await loadLibraries(values.input);
  console.log(`Validated ${libraries.length} libraries in ${values.input}`);
  if (values.registry) {
    const registry = registrySchema.parse(await readJson(values.registry));
    const byId = new Map(registry.libraries.map((library) => [library.id, library]));
    if (byId.size !== libraries.length) throw new Error('Registry and source library counts differ');
    for (const library of libraries) {
      const generated = byId.get(library.id);
      if (!generated || Object.entries(library).some(([key, value]) => generated[key as keyof typeof generated] !== value)) {
        throw new Error(`Registry base fields differ from source for ${library.id}`);
      }
    }
    console.log(`Validated generated registry in ${values.registry}`);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => { console.error(errorMessage(error)); process.exitCode = 1; });
}
