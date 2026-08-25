import { config } from '../src/config.js';
import { provisionLocalDemoUser } from '../src/auth/local-demo.js';
import { pool } from '../src/db/pool.js';

if (!config.auth.localDevLoginEnabled || !config.auth.localDevLoginUserEmail) {
  throw new Error('Local demo login must be enabled with a dedicated user email before provisioning.');
}
if (!pool) throw new Error('The database pool is unavailable.');

try {
  await provisionLocalDemoUser(pool, config.auth.localDevLoginUserEmail);
  process.stdout.write('Local demo account is ready.\n');
} finally {
  await pool.end();
}
