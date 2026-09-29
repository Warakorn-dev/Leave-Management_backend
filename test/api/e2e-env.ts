/**
 * Runs before the full-API spec is loaded: points DATABASE_URL at a
 * throw-away test database so the suite can create / approve / delete data
 * without touching the real one.
 *
 * Uses E2E_DATABASE_URL when set, otherwise the DATABASE_URL from `.env` with
 * the database name swapped for `leave_management_e2e`. Refuses to run unless
 * the database name ends in `_e2e` — the suite wipes that database.
 */
import * as fs from 'fs';
import * as path from 'path';

const envFile = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const baseUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL;
if (!baseUrl) throw new Error('DATABASE_URL (or E2E_DATABASE_URL) is not set');

const url = new URL(baseUrl);
if (!process.env.E2E_DATABASE_URL) url.pathname = '/leave_management_e2e';
if (!/_e2e$/.test(url.pathname)) {
  throw new Error(
    `Refusing to run: test database "${url.pathname.slice(1)}" must end in _e2e`,
  );
}

process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = 'test';
// Never talk to a real SMTP server from tests (sendEmail is also mocked).
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1';
