#!/usr/bin/env node
import { unescapeAll } from './unescape-db.mjs';
import logger from '../utils/logger.js';

(async function main(){
  try {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || args.includes('--dryrun');

    if (process.env.NODE_ENV === 'production') {
      if (process.env.UNESCAPE_DB_CONFIRM !== 'yes' && process.env.UNESCAPE_DB_CONFIRM !== 'YES') {
        console.error('Refusing to run unescape in production without explicit confirmation.');
        console.error('Set environment variable UNESCAPE_DB_CONFIRM=yes to acknowledge you understand this will modify production data.');
        process.exitCode = 2;
        return;
      }
    }

    console.log('Starting DB unescape' + (process.env.NODE_ENV === 'production' ? ' (production mode)':'') + (dryRun ? ' (dry-run)' : '') + '...');
    await unescapeAll({ dryRun });
    console.log('DB unescape finished.');
    process.exit(process.exitCode || 0);
  } catch (err) {
    logger.error('Fatal error running unescape wrapper', err);
    console.error(err);
    process.exit(1);
  }
})();
