import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const blueprintUrl = new URL('../../../render.yaml', import.meta.url);
const packageUrl = new URL('../../package.json', import.meta.url);
const startScriptUrl = new URL('../../scripts/migrate-and-start.js', import.meta.url);

describe('Render deployment contract', () => {
  it('migrates with separate credentials before starting the free web service', async () => {
    const [blueprint, packageSource, startSource] = await Promise.all([
      readFile(blueprintUrl, 'utf8'),
      readFile(packageUrl, 'utf8'),
      readFile(startScriptUrl, 'utf8')
    ]);
    const packageJson = JSON.parse(packageSource);

    expect(blueprint).toContain('startCommand: npm run start:with-migrations --prefix server');
    expect(blueprint).toMatch(/- key: DB_MIGRATION_USER\s+sync: false/);
    expect(blueprint).toMatch(/- key: DB_MIGRATION_PASSWORD\s+sync: false/);
    expect(packageJson.scripts['start:with-migrations']).toBe('node scripts/migrate-and-start.js');
    expect(startSource).toContain("DB_USER: migrationUser");
    expect(startSource).toContain("DB_PASSWORD: migrationPassword");
    expect(startSource).toContain("delete process.env.DB_MIGRATION_PASSWORD");
    expect(startSource).toContain("await import('../src/server.js')");
  });
});
