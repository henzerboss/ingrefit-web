#!/usr/bin/env node
/**
 * Answers, in one command, why a contributed product is missing or has no
 * photo.
 *
 * Four things have to line up: the table exists, the row was written, the image
 * directory is writable, and the file is on disk. A failure in any one of them
 * looks identical from the app — "no photo, no alternatives" — so they are
 * checked together rather than guessed at one at a time.
 *
 *   node scripts/community-doctor.mjs
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv('.env');
loadEnv('.env.local');

const directory =
  process.env.INGREFIT_COMMUNITY_IMAGE_DIR?.trim() ||
  path.join(process.cwd(), '..', 'ingrefit-data', 'community-images');

console.log(`image directory: ${directory}`);
try {
  mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, '.write-probe');
  writeFileSync(probe, 'ok');
  unlinkSync(probe);
  const files = readdirSync(directory).filter((name) => name.endsWith('.jpg'));
  console.log(`  writable: yes`);
  console.log(`  stored images: ${files.length}${files.length ? ` (${files.slice(0, 5).join(', ')})` : ''}`);
} catch (error) {
  console.error(`  writable: NO — ${error.message}`);
  console.error('  The node process cannot write here. Create the directory and give it to the app user,');
  console.error('  or point INGREFIT_COMMUNITY_IMAGE_DIR somewhere it can write.');
}

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
try {
  const rows = await prisma.communityProduct.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { barcode: true, name: true, status: true, imagePath: true, createdAt: true },
  });
  console.log(`\ncontributed products: ${rows.length} most recent`);
  for (const row of rows) {
    const onDisk = row.imagePath && existsSync(path.join(directory, path.basename(row.imagePath)));
    console.log(
      `  ${row.barcode}  ${row.status.padEnd(9)} image=${row.imagePath ? (onDisk ? 'on disk' : 'MISSING FILE') : 'none'}  ${row.name ?? ''}`,
    );
  }
  if (!rows.length) {
    console.log('  none. Either no label scan has completed, or the write failed —');
    console.log('  check the log for "[ingrefit] Community" lines.');
  }
} catch (error) {
  console.error(`\ncontributed products: could not read the table — ${error.message}`);
  console.error('  If this says the table does not exist, run: npm run db:push');
} finally {
  await prisma.$disconnect();
}
