import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/security/passwords.js';
import { emailSchema } from '../src/validation/common.js';

const inputSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(2).max(120),
  role: z.enum(['owner', 'manager', 'support']),
  password: z.string().min(16, 'Administrator passwords must contain at least 16 characters.').max(128)
});

async function visiblePrompt(label, fallback = '') {
  if (!process.stdin.isTTY) throw new Error(`${label} must be supplied through the environment in a non-interactive shell.`);
  const prompt = fallback ? `${label} [${fallback}]: ` : `${label}: `;
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await reader.question(prompt)).trim() || fallback;
  } finally {
    reader.close();
  }
}

async function hiddenPrompt(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${label} must be supplied through the environment in a non-interactive shell.`);
  }
  const reader = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write(`${label}: `);
  const originalWriter = reader._writeToOutput.bind(reader);
  reader._writeToOutput = () => {};
  try {
    return await reader.question('');
  } finally {
    reader._writeToOutput = originalWriter;
    process.stdout.write('\n');
    reader.close();
  }
}

async function collectInput() {
  const email = process.env.ADMIN_EMAIL || await visiblePrompt('Administrator email');
  const displayName = process.env.ADMIN_DISPLAY_NAME || await visiblePrompt('Display name', 'AM MARKET Administrator');
  const role = process.env.ADMIN_ROLE || await visiblePrompt('Role (owner, manager, support)', 'owner');
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await hiddenPrompt('Administrator password');
    const confirmation = await hiddenPrompt('Confirm administrator password');
    if (password !== confirmation) throw new Error('The password confirmation does not match.');
  }
  return inputSchema.parse({ email, displayName, role, password });
}

async function provision() {
  if (!pool) throw new Error('The database pool is unavailable.');
  const input = await collectInput();
  const passwordHash = await hashPassword(input.password);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO admin_identities
        (public_id, email, email_normalized, display_name, password_hash, role, status, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(3))`,
      [randomUUID(), input.email, input.email, input.displayName, passwordHash, input.role]
    );
    await connection.commit();
    console.info(`Administrator ${input.email} was provisioned with the ${input.role} role.`);
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      throw new Error('An administrator with that email already exists. No credentials were changed.');
    }
    throw error;
  } finally {
    connection.release();
  }
}

try {
  await provision();
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error(`Administrator input is invalid: ${error.issues.map((issue) => issue.message).join('; ')}`);
  } else {
    console.error(`Administrator provisioning failed: ${error.message}`);
  }
  process.exitCode = 1;
} finally {
  await pool?.end();
}
