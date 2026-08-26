import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDirectory, '..');

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required before starting with migrations.`);
  return value;
}

async function runMigrationProcess() {
  const migrationUser = requiredEnvironment('DB_MIGRATION_USER');
  const migrationPassword = requiredEnvironment('DB_MIGRATION_PASSWORD');
  const childEnvironment = {
    ...process.env,
    DB_USER: migrationUser,
    DB_PASSWORD: migrationPassword
  };

  // The long-running application must not retain the higher-privilege
  // migration credentials after the short-lived migration child is spawned.
  delete process.env.DB_MIGRATION_USER;
  delete process.env.DB_MIGRATION_PASSWORD;

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/db/migrate.js'], {
      cwd: serverRoot,
      env: childEnvironment,
      stdio: 'inherit',
      windowsHide: true
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        signal
          ? `Migration process terminated by ${signal}.`
          : `Migration process exited with code ${code}.`
      ));
    });
  });
}

await runMigrationProcess();
await import('../src/server.js');
