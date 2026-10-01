/* eslint-disable */
// One-time setup for a brand-new, empty database (e.g. the production server).
//
// The migration history starts from an existing schema (its first migration is
// an ALTER TABLE), so `prisma migrate deploy` cannot build a database from
// scratch. This script creates the full current schema with `db push`, then
// marks every existing migration as already applied so that future releases
// can use `npx prisma migrate deploy` normally.
//
// Usage: npm run db:init   (refuses to run if the database already has tables)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'prisma', 'migrations');

const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

async function main() {
  const prisma = new PrismaClient();
  try {
    const [{ count }] = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    if (Number(count) > 0) {
      console.error(
        `Database already has ${count} table(s). db:init is for an empty database only.\n` +
          'For an existing database run: npx prisma migrate deploy',
      );
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }

  run('npx prisma db push --skip-generate');

  const migrations = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations) {
    run(`npx prisma migrate resolve --applied ${name}`);
  }

  console.log(`\nSchema created and ${migrations.length} migration(s) marked as applied.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
