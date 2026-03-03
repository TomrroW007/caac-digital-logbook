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
    ],
});
