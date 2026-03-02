/**
 * @file database/index.ts
 * @description WatermelonDB singleton — the single source of truth for the
 * offline-first SQLite database used across the entire CAAC Digital Logbook app.
 *
 * Usage:
 *   import { database } from '../database';
 *
 * The singleton is created once at module load time and shared across all
 * screens/components. In tests, the production database is never imported
 * (tests use Jest mocks for WatermelonDB).
 */

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { schema } from '../model/schema';
import { migrations } from '../migrations';
import { LogbookRecord } from '../model/LogbookRecord';

// ─── SQLite Adapter ───────────────────────────────────────────────────────────

const adapter = new SQLiteAdapter({
    schema,
    // The on-disk file name of the SQLite database.
    // Changing this will create a new empty database.
    dbName: 'caac_logbook_v1',

    // jsi: true enables the JSI (JavaScript Interface) bridge on Hermes,
    // which is significantly faster than the legacy async bridge.
    // Requires Hermes as the JS engine (set in app.json: "jsEngine": "hermes").
    jsi: true,

    // Migration steps — applied automatically when schema.version increases.
    // CRITICAL: Never set this to undefined in production; doing so causes
    // WatermelonDB to wipe and recreate the database on any schema version change.
    migrations,
});

// ─── Database Instance ────────────────────────────────────────────────────────

/**
 * The singleton WatermelonDB Database instance.
 * Wrap your root component with:
 *   <DatabaseProvider database={database}>
 * to make it accessible via withDatabase() HOC or useDatabase() hook.
 */
export const database = new Database({
    adapter,
    modelClasses: [LogbookRecord],
});
