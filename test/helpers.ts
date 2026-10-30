import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

export async function temporaryDirectory(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'scad-registry-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

export function json(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', ...headers } });
}
