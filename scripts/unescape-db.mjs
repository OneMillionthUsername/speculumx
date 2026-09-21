#!/usr/bin/env node
// Einmalige Daten-Migration: Ent-escapt HTML-Entities (&quot; &#39; &amp; &lt; &gt;)
// aus Text-Spalten, die durch das frühere Input-Escaping korrumpiert wurden.
//
// Ausgenommen:
// - content/description-Spalten (DOMPurify-sanitized HTML, Entities dort gewollt)
// - slug-Spalten (URL-Stabilität)
// - categories (werden nicht via HTTP angelegt, waren nie input-escapt)
//
// Verwendung:
//   npm run unescape-db:dry   # Vorschau (id, Spalte, vorher → nachher)
//   npm run unescape-db       # Ausführen
import { initializeDatabase, getDatabasePool, isMockDatabase } from '../databases/mariaDB.js';
import { unescapeHtml } from '../utils/utils.js';
import { fileURLToPath } from 'url';

// Spalten pro Tabelle, die ent-escapt werden sollen
const COLUMN_MAP = {
  posts: ['title', 'author', 'tags'],
  deleted_posts: ['title', 'author', 'tags', 'reason'],
  comments: ['username', 'text'],
  cards: ['title', 'subtitle', 'link', 'img_link'],
  media: ['alt_text', 'original_name'],
};

// Spalten mit JSON-Array-Inhalt (Elemente einzeln ent-escapen)
const JSON_ARRAY_COLUMNS = new Set(['tags']);

/**
 * Wendet unescapeHtml wiederholt an, bis sich nichts mehr ändert (Fixpoint).
 * Behandelt mehrfach escapte Daten (z. B. doppelt escapte Usernamen).
 * Cap bei 5 Iterationen als Sicherheitsnetz.
 * @param {string} value
 * @returns {string}
 */
export function unescapeFixpoint(value) {
  if (typeof value !== 'string') return value;
  let current = value;
  for (let i = 0; i < 5; i++) {
    const next = unescapeHtml(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Ent-escapt eine Spalte; JSON-Array-Spalten (tags) werden geparst,
 * elementweise ent-escapt und wieder serialisiert.
 * @param {string} column
 * @param {any} value
 * @returns {any} neuer Wert (identisch, wenn nichts zu tun)
 */
function unescapeColumnValue(column, value) {
  if (value === null || value === undefined) return value;
  const str = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  if (JSON_ARRAY_COLUMNS.has(column)) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        const unescaped = parsed.map(item => typeof item === 'string' ? unescapeFixpoint(item) : item);
        const result = JSON.stringify(unescaped);
        return result === str ? value : result;
      }
    } catch (_e) {
      // kein valides JSON — als normalen String behandeln
    }
  }
  const unescaped = unescapeFixpoint(str);
  return unescaped === str ? value : unescaped;
}

/**
 * Führt die Migration aus.
 * @param {object} options
 * @param {boolean} options.dryRun - nur Änderungen ausgeben, nichts schreiben
 */
export async function unescapeAll(options = {}) {
  const { dryRun = false } = options;
  await initializeDatabase();
  if (isMockDatabase()) {
    console.error('Mock-Datenbank aktiv — Abbruch (keine echte DB-Verbindung).');
    process.exitCode = 1;
    return;
  }
  const pool = getDatabasePool();
  let totalChanged = 0;

  for (const [table, columns] of Object.entries(COLUMN_MAP)) {
    const conn = await pool.getConnection();
    try {
      const rows = await conn.query(`SELECT id, ${columns.join(', ')} FROM ${table}`);
      const changes = [];
      for (const row of rows) {
        const updated = {};
        for (const col of columns) {
          const newValue = unescapeColumnValue(col, row[col]);
          if (newValue !== row[col]) {
            updated[col] = newValue;
            console.log(`[${table}#${row.id}] ${col}:`);
            console.log(`  vorher:  ${String(row[col]).slice(0, 200)}`);
            console.log(`  nachher: ${String(newValue).slice(0, 200)}`);
          }
        }
        if (Object.keys(updated).length > 0) {
          changes.push({ id: row.id, updated });
        }
      }

      if (changes.length === 0) {
        console.log(`${table}: keine Änderungen nötig`);
        continue;
      }
      totalChanged += changes.length;
      if (dryRun) {
        console.log(`${table}: ${changes.length} Zeile(n) würden geändert (dry-run)`);
        continue;
      }

      await conn.beginTransaction();
      try {
        for (const change of changes) {
          const setClause = Object.keys(change.updated).map(c => `${c} = ?`).join(', ');
          const values = [...Object.values(change.updated), change.id];
          await conn.query(`UPDATE ${table} SET ${setClause} WHERE id = ?`, values);
        }
        await conn.commit();
        console.log(`${table}: ${changes.length} Zeile(n) aktualisiert`);
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    } finally {
      conn.release();
    }
  }

  console.log(`Fertig. ${totalChanged} Zeile(n) ${dryRun ? 'würden geändert (dry-run)' : 'geändert'}.`);
}

// Direktaufruf (analog sanitize-db-posts.js)
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryrun');
  unescapeAll({ dryRun }).then(() => process.exit(process.exitCode || 0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
