/**
 * @file migrations/index.ts
 * @description WatermelonDB schema migration steps for CAAC Digital Logbook.
 *
 * IMPORTANT: Never mutate existing migration entries — always append new ones.
 * Each migration must be idempotent and describe a single schema version bump.
 *
 * Architecture rule (PRD §二):
 *   Migrations ensure existing pilot logbook data is preserved intact across
 *   app updates. A missing or undefined migrations object causes WatermelonDB
 *   to reset the database on schema version change — a catastrophic data loss
 *   for a logbook application.
 *
 * Version history:
 *   v1  → v2 : Added `uuid` column (cloud-sync pre-reservation, PRD §二 §五).
 *   v2  → v3 : Added `day_to` / `night_to` columns (PRD V1.1 — CCAR-61 T/O counts).
 *              Both columns are isOptional:true — SQLite cannot add NOT NULL columns
 *              to existing rows without a DEFAULT; business layer coalesces null → 0.
 */

import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';
import { TABLE_LOGBOOK_RECORDS } from '../model/schema';

export const migrations = schemaMigrations({
    migrations: [
        // ── v1 → v2 ──────────────────────────────────────────────────────────
        {
            toVersion: 2,
            steps: [
                addColumns({
                    table: TABLE_LOGBOOK_RECORDS,
                    columns: [
                        /**
                         * uuid: universally unique identifier for cloud sync conflict resolution.
                         * PRD §二: "UUID" listed as mandatory sync-readiness column.
                         * V1.0 — stored as NULL (Phase 5 will generate RFC 4122 UUIDs on upload).
                         * isOptional: true so existing records (null) remain valid.
                         */
                        { name: 'uuid', type: 'string', isOptional: true },
                    ],
                }),
            ],
        },

        // ── v2 → v3 ──────────────────────────────────────────────────────────
        {
            toVersion: 3,
            steps: [
                addColumns({
                    table: TABLE_LOGBOOK_RECORDS,
                    columns: [
                        /**
                         * day_to: daytime takeoff count (PRD V1.1 §六).
                         * CCAR-61 requires independent T/O counts for near-recency audit.
                         * isOptional: true — existing rows will receive NULL; business layer
                         * coalesces to 0 via LogbookRecord.safeDayTo getter.
                         */
                        { name: 'day_to', type: 'number', isOptional: true },

                        /**
                         * night_to: nighttime takeoff count (PRD V1.1 §六).
                         * Same migration-safety requirement as day_to.
                         */
                        { name: 'night_to', type: 'number', isOptional: true },
                    ],
                }),
            ],
        },
    ],
});
