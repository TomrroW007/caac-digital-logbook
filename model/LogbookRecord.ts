/**
 * @file model/LogbookRecord.ts
 * @description WatermelonDB Model class for the logbook_records table.
 *
 * Note on `declare` keyword:
 *   Babel's legacy decorator transform does not support `!` (definite assignment assertions)
 *   on decorated class fields. Instead we use `declare`, which tells TypeScript
 *   "this property exists at runtime" without emitting any JS — the decorator handles binding.
 */

import { Model } from '@nozbe/watermelondb';
import { field, readonly, date, text } from '@nozbe/watermelondb/decorators';
import {
    TABLE_LOGBOOK_RECORDS,
    type DutyType,
    type PilotRole,
    type AppSyncStatus,
} from './schema';

export class LogbookRecord extends Model {
    /** The WatermelonDB table this model reads/writes. */
    static table = TABLE_LOGBOOK_RECORDS;

    // ── Identity & Duty ──────────────────────────────────────────────────────────

    /** 'FLIGHT' or 'SIMULATOR' — the top-level dual-track discriminator. */
    @field('duty_type') declare dutyType: DutyType;

    /**
     * Optional flight number (e.g. "CA1501").
     * Used in exportRemarks concatenation and PDF route identification.
     */
    @field('flight_no') declare flightNo: string | null;

    // ── Dates ─────────────────────────────────────────────────────────────────────

    /** Scheduled date in YYYY-MM-DD format. */
    @field('schd_date') declare schdDate: string;

    /**
     * Actual operational date in YYYY-MM-DD format. INDEXED.
     * Primary key for 90-day rolling queries in Dashboard.
     */
    @field('actl_date') declare actlDate: string;

    // ── Aircraft / Route Identity ─────────────────────────────────────────────────

    /** Aircraft type (e.g. "A320", "B737"). Remembered across sessions. */
    @field('acft_type') declare acftType: string;

    /** Aircraft registration number (e.g. "B-6712"). Null for simulators. */
    @field('reg_no') declare regNo: string | null;

    /** DEP ICAO code (e.g. "ZBAA"). Null in SIMULATOR mode. */
    @field('dep_icao') declare depIcao: string | null;

    /** ARR ICAO code (e.g. "ZSSS"). Null in SIMULATOR mode. */
    @field('arr_icao') declare arrIcao: string | null;

    // ── Time Points (UTC ISO-8601 Strings) ────────────────────────────────────────

    /** Chock-OFF / SIM-From time in UTC ISO-8601. Always required. */
    @field('off_time_utc') declare offTimeUtc: string;

    /** Takeoff time in UTC ISO-8601. FLIGHT mode only; null for SIM. */
    @field('to_time_utc') declare toTimeUtc: string | null;

    /** Landing time in UTC ISO-8601. FLIGHT mode only; null for SIM. */
    @field('ldg_time_utc') declare ldgTimeUtc: string | null;

    /** Chock-ON / SIM-To time in UTC ISO-8601. Always required. */
    @field('on_time_utc') declare onTimeUtc: string;

    // ── Duration Fields (INTEGER minutes) ─────────────────────────────────────────

    /**
     * Total block time in INTEGER minutes. Calculated by the engine (ON - OFF).
     * The denominator in the compliance formula (§4.1).
     */
    @field('block_time_min') declare blockTimeMin: number;

    /** PIC time in INTEGER minutes. Default 0. */
    @field('pic_min') declare picMin: number;

    /** SIC time in INTEGER minutes. Default 0. */
    @field('sic_min') declare sicMin: number;

    /** Dual-received time in INTEGER minutes. Default 0. */
    @field('dual_min') declare dualMin: number;

    /** Instructor time in INTEGER minutes. Default 0. */
    @field('instructor_min') declare instructorMin: number;

    /** Night flight time in INTEGER minutes. Default 0. */
    @field('night_flight_min') declare nightFlightMin: number;

    /** Instrument flight time in INTEGER minutes. Default 0. */
    @field('instrument_min') declare instrumentMin: number;

    // ── Role & Approach ───────────────────────────────────────────────────────────

    /**
     * Pilot role during the flight.
     * - 'PF' (Pilot Flying): controlling the aircraft.
     * - 'PM' (Pilot Monitoring): managing systems and communications.
     * - 'PICUS' (Pilot-In-Command Under Supervision): 机长受监视飞行.
     *   This time is recorded as PIC time but MUST be annotated in remarks
     *   for ATPL applications per CCAR-61.
     */
    @field('pilot_role') declare pilotRole: PilotRole | null;

    /** Approach type (e.g. "ILS", "VOR", "RNAV"). Optional. */
    @field('approach_type') declare approachType: string | null;

    // ── Takeoff & Landing Counts (PRD V1.1 §六) ──────────────────────────────

    /**
     * Daytime takeoff count. INTEGER (null for pre-v3 migrated rows).
     * ALWAYS use `safeDayTo` in business logic to get a guaranteed 0 instead of null.
     */
    @field('day_to') declare dayTo: number | null;

    /**
     * Nighttime takeoff count. INTEGER (null for pre-v3 migrated rows).
     * ALWAYS use `safeNightTo` in business logic.
     */
    @field('night_to') declare nightTo: number | null;

    /** Number of daytime landings. INTEGER, default 0. */
    @field('day_ldg') declare dayLdg: number;

    /** Number of nighttime landings. INTEGER, default 0. */
    @field('night_ldg') declare nightLdg: number;

    // ── Simulator-Specific Fields ─────────────────────────────────────────────────

    /** Simulator unit ID. SIM mode only; null in FLIGHT mode. */
    @field('sim_no') declare simNo: string | null;

    /** Simulator qualification category (e.g. "FFS Level D"). SIM mode only. */
    @field('sim_cat') declare simCat: string | null;

    /** Approved Training Organization name. SIM mode only. */
    @field('training_agency') declare trainingAgency: string | null;

    /** Type of training (e.g. "OPC", "PC", "IR"). SIM mode only. */
    @field('training_type') declare trainingType: string | null;

    // ── Notes ─────────────────────────────────────────────────────────────────────

    /** Free-text pilot remarks. Optional. */
    @field('remarks') declare remarks: string | null;
    // ── Cloud Sync Pre-Reservation ─────────────────────────────────────────────

    /**
     * UUID for future cloud sync conflict resolution (PRD §二 §五).
     * V1.0 default: null. Phase 5 will generate RFC 4122 UUIDs on first sync upload.
     */
    @field('uuid') declare uuid: string | null;
    // ── Soft Delete & Sync ────────────────────────────────────────────────────────

    /**
     * Soft-delete flag. All queries MUST filter `WHERE is_deleted = false`.
     * Records are never physically deleted in V1.0.
     */
    @field('is_deleted') declare isDeleted: boolean;

    /**
     * Last modification timestamp as UTC ISO-8601 string.
     * Updated on every write operation for future conflict resolution.
     */
    @field('last_modified_at') declare lastModifiedAt: string;

    /**
     * App-level sync state. V1.0 default: 'LOCAL_ONLY'.
     * Named appSyncStatus (not syncStatus) to avoid collision with
     * WatermelonDB's built-in Model.syncStatus accessor.
     */
    @field('sync_status') declare appSyncStatus: AppSyncStatus;

    // ─── Computed Properties ───────────────────────────────────────────────────

    /** Convenience flag — true when this is a real-flight record. */
    get isFlight(): boolean {
        return this.dutyType === 'FLIGHT';
    }

    /** Convenience flag — true when this is a simulator record. */
    get isSimulator(): boolean {
        return this.dutyType === 'SIMULATOR';
    }

    /**
     * Route string for display and PDF/Excel export.
     * Returns "ZBAA-ZSSS" if both ICAO codes are present, or "" for SIM records.
     */
    get routeString(): string {
        if (this.depIcao && this.arrIcao) {
            return `${this.depIcao.toUpperCase()}-${this.arrIcao.toUpperCase()}`;
        }
        return '';
    }

    /**
     * Remarks column string for export (column 16 in PRD V1.1 §5.3).
     * Null-safe concatenation of flightNo, pilotRole, and free-text remarks.
     * Uses filter(Boolean) to silently drop any null/undefined parts.
     *
     * @example
     * // flightNo='CA1501', pilotRole='PICUS', remarks='气象雷达不工作'
     * // → 'CA1501 PICUS 气象雷达不工作'
     *
     * @example
     * // flightNo=null, pilotRole='PF', remarks=null
     * // → 'PF'  (no null fragments)
     */
    get exportRemarks(): string {
        return [this.flightNo, this.pilotRole, this.remarks]
            .filter(Boolean)
            .join(' ');
    }

    // ─── Null-Safe Takeoff Count Getters ─────────────────────────

    /**
     * Safe accessor for daytime takeoff count.
     * Coalesces null (pre-v3 migrated rows) to 0 for business logic.
     */
    get safeDayTo(): number {
        return this.dayTo ?? 0;
    }

    /**
     * Safe accessor for nighttime takeoff count.
     * Coalesces null (pre-v3 migrated rows) to 0 for business logic.
     */
    get safeNightTo(): number {
        return this.nightTo ?? 0;
    }

    // ─── Compliance Methods ────────────────────────────────────────────────────

    /**
     * Validates the PRD §4.1 compliance red-line:
     *   PIC + SIC + Dual + Instructor <= BlockTime
     */
    isRoleTimeValid(): boolean {
        return (
            this.picMin + this.sicMin + this.dualMin + this.instructorMin <=
            this.blockTimeMin
        );
    }
}

export default LogbookRecord;
