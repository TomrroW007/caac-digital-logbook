/**
 * @file database/index.native.ts
 * @description WatermelonDB singleton for NATIVE platforms (iOS/Android).
 *
 * Uses SQLiteAdapter with JSI bridge for maximum performance on Hermes.
 * Metro resolves this file automatically on native targets via the
 * `.native.ts` platform extension.
 */

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { schema } from '../model/schema';
import { migrations } from '../migrations';
import { LogbookRecord } from '../model/LogbookRecord';

// ─── SQLite Adapter ───────────────────────────────────────────────────────────

const adapter = new SQLiteAdapter({
    schema,
    dbName: 'caac_logbook_v1',
    jsi: true,
    migrations,
});

// ─── Database Instance ────────────────────────────────────────────────────────

export const database = new Database({
    adapter,
    modelClasses: [LogbookRecord],
});
