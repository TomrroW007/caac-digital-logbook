/**
 * @file database/index.web.ts
 * @description WatermelonDB singleton for WEB platform (PWA).
 *
 * Uses LokiJSAdapter which stores data in the browser's IndexedDB.
 * Metro resolves this file automatically on web targets via the
 * `.web.ts` platform extension.
 *
 * IMPORTANT — iOS Safari ITP policy:
 *   If the user doesn't open the PWA for 7+ consecutive days, iOS may
 *   purge all IndexedDB data. The app displays a warning banner and
 *   encourages regular Excel backups.
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from '../model/schema';
import { migrations } from '../migrations';
import { LogbookRecord } from '../model/LogbookRecord';

// ─── LokiJS Adapter (IndexedDB persistence) ──────────────────────────────────

const adapter = new LokiJSAdapter({
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: true,
    dbName: 'caac_logbook_v1',
});

// ─── Database Instance ────────────────────────────────────────────────────────

export const database = new Database({
    adapter,
    modelClasses: [LogbookRecord],
});
