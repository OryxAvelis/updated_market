import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const run = promisify(execFile);
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function JavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return JavaScriptFiles(target);
    return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
  }));
  return nested.flat();
}

const roots = ['src', 'scripts', 'tests'];
const files = [];
for (const root of roots) {
  try {
    files.push(...await JavaScriptFiles(path.join(serverRoot, root)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

for (const file of files.sort()) await run(process.execPath, ['--check', file]);
console.info(`Syntax check passed for ${files.length} server JavaScript files.`);
