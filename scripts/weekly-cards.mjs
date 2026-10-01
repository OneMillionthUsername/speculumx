#!/usr/bin/env node
/* Weekly card digest: stores the week's most important news as UNPUBLISHED cards.

   Usage:
     node scripts/weekly-cards.mjs                 create draft cards
     node scripts/weekly-cards.mjs --dry-run       select and print, write nothing
     node scripts/weekly-cards.mjs --check-sources fetch every source and report, no LLM, no database
     node scripts/weekly-cards.mjs --test-image    generate one sample illustration (checks the image model)
     node scripts/weekly-cards.mjs --cleanup-only  only delete expired drafts (add --dry-run to preview)
   Options: --limit <n> (cards per run), --days <n> (age window)

   Every run first deletes auto-generated cards that are still unpublished after
   CARD_DIGEST_DRAFT_TTL_DAYS (default 30) days, with their image files.

   Exit code 0: finished (also when nothing was worth a card). 1: a source, the LLM or the database
   failed. Drafts are reviewed and published in /cards/manage. See docs/weekly-cards-server-setup.md. */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { closeDatabase, initializeDatabase, initializeDatabaseSchema, isMockDatabase } from '../databases/mariaDB.js';
import { CARD_DIGEST, FEEDS } from '../config/cardDigest.js';
import { collectCandidates } from '../services/newsSourceService.js';
import { cleanupExpiredDrafts, runCardDigest } from '../services/cardDigestService.js';
import { generateIllustration } from '../services/imageGenerationService.js';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : Number.parseInt(args[index + 1], 10);
};

function printReport(report) {
  for (const entry of report) {
    console.log(`  ${entry.ok ? 'OK  ' : 'FAIL'} ${entry.source.padEnd(28)} ${entry.ok ? `${entry.count} items` : entry.error}`);
  }
}

async function checkSources() {
  const { candidates, report } = await collectCandidates({
    feeds: FEEDS,
    days: value('--days') ?? CARD_DIGEST.days,
    minPoints: CARD_DIGEST.hnMinPoints,
    maxItems: CARD_DIGEST.hnMaxItems,
    perFeedMax: CARD_DIGEST.perFeedMax,
    userAgent: CARD_DIGEST.userAgent,
  });
  console.log(`Sources (${report.filter(r => r.ok).length}/${report.length} reachable):`);
  printReport(report);
  console.log(`\n${candidates.length} candidates after merging duplicates.`);
  return report.some(entry => entry.ok) ? 0 : 1;
}

async function testImage() {
  const { buffer, model } = await generateIllustration('A mirror reflecting an abstract landscape of circuits and trees');
  const file = path.join(os.tmpdir(), 'card-image-test.webp');
  const info = await sharp(buffer).webp({ quality: 78 }).toFile(file);
  console.log(`Image model ${model} works: ${info.width}x${info.height}, ${info.size} bytes -> ${file}`);
  await fs.rm(file, { force: true });
  return 0;
}

async function prepareDatabase(dryRun) {
  await initializeDatabase();
  if (isMockDatabase() && !dryRun) {
    console.error('Database is in mock mode (DB_* variables missing or connection failed) - refusing to touch cards.');
    return false;
  }
  // Idempotent; makes sure the auto_generated column exists even if the app has not restarted yet
  await initializeDatabaseSchema();
  return true;
}

async function cleanup(dryRun) {
  const result = await cleanupExpiredDrafts({ dryRun });
  if (!result.days) {
    console.log('Cleanup: disabled (CARD_DIGEST_DRAFT_TTL_DAYS=0)\n');
    return 0;
  }
  const count = dryRun ? result.expired.length : result.deleted.length;
  console.log(`Cleanup: ${count} unpublished auto-generated card(s) older than ${result.days} days ${dryRun ? 'would be deleted' : 'deleted'}`);
  for (const card of dryRun ? result.expired : result.deleted) console.log(`  - #${card.id} ${card.title}`);
  for (const card of result.failed) console.log(`  ! #${card.id} ${card.title}: ${card.error}`);
  console.log('');
  return result.failed.length > 0 ? 1 : 0;
}

async function cleanupOnly() {
  const dryRun = flag('--dry-run');
  return await prepareDatabase(dryRun) ? cleanup(dryRun) : 1;
}

async function digest() {
  const dryRun = flag('--dry-run');
  if (!await prepareDatabase(dryRun)) return 1;
  // A failing cleanup must not keep this week's drafts from being created
  let cleanupCode = 1;
  try {
    cleanupCode = await cleanup(dryRun);
  } catch (error) {
    console.error(`Cleanup failed: ${error.message}\n`);
  }
  const result = await runCardDigest({
    dryRun,
    ...(value('--limit') && { maxCards: value('--limit') }),
    ...(value('--days') && { days: value('--days') }),
  });

  console.log(`Sources:${dryRun ? ' (dry run, nothing is written)' : ''}`);
  printReport(result.report);
  console.log(`\n${result.candidateCount} candidates went to the LLM${result.model ? ` (${result.model})` : ''}; ${result.results.length} picked.\n`);
  for (const card of result.results) {
    console.log(`- ${card.title}${card.id ? `  [card #${card.id}, draft]` : ''}`);
    console.log(`    ${card.subtitle}`);
    console.log(`    ${card.link}`);
    console.log(`    image: ${card.image.source} (${card.image.detail})${card.error ? `\n    ERROR: ${card.error}` : ''}`);
  }
  return cleanupCode || result.results.some(card => card.error) ? 1 : 0;
}

try {
  const code = flag('--check-sources') ? await checkSources()
    : flag('--test-image') ? await testImage()
      : flag('--cleanup-only') ? await cleanupOnly()
        : await digest();
  await closeDatabase();
  process.exit(code);
} catch (error) {
  console.error(`Card digest failed: ${error.message}`);
  await closeDatabase().catch(() => {});
  process.exit(1);
}
