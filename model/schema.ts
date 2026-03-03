/**
 * @file model/schema.ts
 * @description WatermelonDB app schema for CAAC Digital Logbook.
 *
 * Architecture rules (from PRD §二):
 *  - Single dual-track table "logbook_records" covers both FLIGHT and SIMULATOR duties.
 *  - All time *durations* (block time, PIC, SIC, …) stored as INTEGER minutes — zero float risk.
 *  - Time *points* (OFF/TO/LDG/ON) stored as UTC ISO-8601 strings.
 *  - Date fields stored as YYYY-MM-DD strings.
 *  - actl_date is indexed for fast 90-day rolling queries.
 *  - Sync-readiness columns (is_deleted, sync_status, last_modified_at) always present.
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb';

// ─── Shared Type Constants ────────────────────────────────────────────────────

/** Top-level duty discriminator. Drives which form track is shown. */
export type DutyType = 'FLIGHT' | 'SIMULATOR';

/** Sync status values. V1.0 only ever writes LOCAL_ONLY. */
export type AppSyncStatus = 'LOCAL_ONLY' | 'PENDING_UPLOAD' | 'SYNCED';

/** Pilot role during the flight. */
export type PilotRole = 'PF' | 'PM';

// Table name constant — single source of truth to avoid typos.
export const TABLE_LOGBOOK_RECORDS = 'logbook_records' as const;

// ─── Schema Definition ────────────────────────────────────────────────────────

/**
 * The application schema.
 *
 * Version history:
 *  - version 1: Initial schema (Phase 1 — all core fields established).
 *  - version 2: Added `uuid` column for cloud-sync pre-reservation (PRD §二 §五).
 */
export const schema = appSchema({
    version: 2,
    tables: [
        tableSchema({
            name: TABLE_LOGBOOK_RECORDS,
            columns: [
                // ── Identity & Duty ───────────────────────────────────────────────────

                /**
                 * duty_type: 'FLIGHT' | 'SIMULATOR'
                 * Drives dual-track form rendering and Dashboard physical isolation.
                 */
                { name: 'duty_type', type: 'string' },

                /**
                 * flight_no: optional flight number (e.g. "CA1501").
                 * Used in the exportRemarks concatenation.
                 */
                { name: 'flight_no', type: 'string', isOptional: true },

                // ── Dates ─────────────────────────────────────────────────────────────

                /**
                 * schd_date: scheduled date, YYYY-MM-DD string.
                 * Used for roster comparison, not for 90-day queries.
                 */
                { name: 'schd_date', type: 'string' },

                /**
                 * actl_date: actual flight/session date, YYYY-MM-DD string.
                 * INDEXED — the primary key for all 90-day rolling aggregate queries.
                 */
                { name: 'actl_date', type: 'string', isIndexed: true },

                // ── Aircraft / Simulator Identity ────────────────────────────────────

                /**
                 * acft_type: aircraft type (e.g. "A320", "B737").
                 * Remembered across sessions (Memory State pattern).
                 */
                { name: 'acft_type', type: 'string' },

                /**
                 * reg_no: aircraft registration (e.g. "B-6712").
                 * Optional — simulators do not have registrations.
                 */
                { name: 'reg_no', type: 'string', isOptional: true },

                // ── Route (FLIGHT mode only) ─────────────────────────────────────────

                /** dep_icao: departure airport ICAO code (e.g. "ZBAA"). NULL in SIM mode. */
                { name: 'dep_icao', type: 'string', isOptional: true },

                /** arr_icao: arrival airport ICAO code (e.g. "ZSSS"). NULL in SIM mode. */
                { name: 'arr_icao', type: 'string', isOptional: true },

                // ── Time Points (UTC ISO-8601 strings) ───────────────────────────────

                /**
                 * off_time_utc: chock-off / start time (UTC ISO-8601).
                 * In SIM mode this is repurposed as "From" time.
                 * Required for ALL duty types.
                 */
                { name: 'off_time_utc', type: 'string' },

                /**
                 * to_time_utc: takeoff time (UTC ISO-8601).
                 * FLIGHT mode only — NULL in SIM mode.
                 * May be inferred: OFF = TO - 10 min.
                 */
                { name: 'to_time_utc', type: 'string', isOptional: true },

                /**
                 * ldg_time_utc: landing time (UTC ISO-8601).
                 * FLIGHT mode only — NULL in SIM mode.
                 * May be inferred: ON = LDG + 5 min.
                 */
                { name: 'ldg_time_utc', type: 'string', isOptional: true },

                /**
                 * on_time_utc: chock-on / end time (UTC ISO-8601).
                 * In SIM mode this is repurposed as "To" time.
                 * Required for ALL duty types.
                 */
                { name: 'on_time_utc', type: 'string' },

                // ── Duration Fields (INTEGER minutes) ────────────────────────────────

                /**
                 * block_time_min: total elapsed time in INTEGER minutes.
                 * = (on_time_utc - off_time_utc), calculated by the engine.
                 * The denominator in the compliance formula.
                 */
                { name: 'block_time_min', type: 'number' },

                /**
                 * pic_min: Pilot-In-Command time in INTEGER minutes. Default 0.
                 * Compliance formula: PIC + SIC + Dual + Instructor <= BlockTime.
                 */
                { name: 'pic_min', type: 'number' },

                /** sic_min: Second-In-Command time in INTEGER minutes. Default 0. */
                { name: 'sic_min', type: 'number' },

                /** dual_min: Dual received time in INTEGER minutes. Default 0. */
                { name: 'dual_min', type: 'number' },

                /** instructor_min: Instructor time in INTEGER minutes. Default 0. */
                { name: 'instructor_min', type: 'number' },

                /** night_flight_min: Night flight duration in INTEGER minutes. Default 0. */
                { name: 'night_flight_min', type: 'number' },

                /** instrument_min: Instrument flight time in INTEGER minutes. Default 0. */
                { name: 'instrument_min', type: 'number' },

                // ── Role & Approach ───────────────────────────────────────────────────

                /**
                 * pilot_role: 'PF' (Pilot Flying) or 'PM' (Pilot Monitoring).
                 * Optional — not required for every record.
                 */
                { name: 'pilot_role', type: 'string', isOptional: true },

                /**
                 * approach_type: type of instrument approach flown (e.g. "ILS", "VOR", "RNAV").
                 * Optional — may be empty for VFR legs or SIM sessions without approach training.
                 */
                { name: 'approach_type', type: 'string', isOptional: true },

                // ── Landing Counts ────────────────────────────────────────────────────

                /**
                 * day_ldg: number of daytime landings. INTEGER. Default 0.
                 * 90-day monitoring: triggers yellow ≤3, red =0.
                 */
                { name: 'day_ldg', type: 'number' },

                /**
                 * night_ldg: number of nighttime landings. INTEGER. Default 0.
                 * 90-day monitoring: triggers yellow ≤3, red =0.
                 */
                { name: 'night_ldg', type: 'number' },

                // ── Simulator-Specific Fields ─────────────────────────────────────────

                /**
                 * sim_no: simulator unit identification number.
                 * SIM mode only — NULL in FLIGHT mode.
                 */
                { name: 'sim_no', type: 'string', isOptional: true },

                /**
                 * sim_cat: simulator qualification category (e.g. "FNPT II", "FFS Level D").
                 * SIM mode only — NULL in FLIGHT mode.
                 */
                { name: 'sim_cat', type: 'string', isOptional: true },

                /**
                 * training_agency: name of the approved training organization (ATO).
                 * SIM mode only.
                 */
                { name: 'training_agency', type: 'string', isOptional: true },

                /**
                 * training_type: type of training conducted (e.g. "OPC", "PC", "IR").
                 * SIM mode only.
                 */
                { name: 'training_type', type: 'string', isOptional: true },

                // ── Notes ─────────────────────────────────────────────────────────────

                /**
                 * remarks: free-text notes from the pilot.
                 * Exported as: "{flight_no} | {remarks}" in the Remarks column.
                 */
                { name: 'remarks', type: 'string', isOptional: true },

                // ── Cloud Sync Pre-Reservation (PRD §二 §五) ──────────────────────

                /**
                 * uuid: RFC 4122 UUID for future cloud sync conflict resolution.
                 * V1.0 default: NULL. Phase 5 will populate on first upload.
                 * isOptional: true so migrated records (null) remain schema-valid.
                 */
                { name: 'uuid', type: 'string', isOptional: true },

                // ── Soft Delete & Sync (mandatory for all records) ────────────────────

                /**
                 * is_deleted: soft-delete flag.
                 * Dashboard and 90-day queries MUST always filter WHERE is_deleted = false.
                 */
                { name: 'is_deleted', type: 'boolean' },

                /**
                 * last_modified_at: UTC ISO-8601 timestamp of the last write.
                 * Used by the future cloud sync engine for conflict resolution.
                 */
                { name: 'last_modified_at', type: 'string' },

                /**
                 * sync_status: V1.0 default is always 'LOCAL_ONLY'.
                 * Pre-reserved for the Phase 5 cloud sync architecture.
                 */
                { name: 'sync_status', type: 'string' },
            ],
        }),
    ],
});

export default schema;
