/**
 * @file utils/ComplianceValidator.ts
 * @description Structured compliance validation engine for the CAAC Digital Logbook.
 *
 * Replaces the bare boolean from TimeCalculator.isRoleTimeSumValid with:
 *  1. A full structured ValidationResult object with field-level errors and error codes,
 *     so the UI can highlight exactly which field is wrong.
 *  2. A 90-day landing experience monitor that implements the PRD §4.2 alert system.
 *
 * All functions are pure: they receive plain data objects and return plain results.
 * No WatermelonDB model objects are imported here.
 */

// ─── Shared Types ──────────────────────────────────────────────────────────────

/**
 * A single field-level validation failure.
 */
export type ValidationError = {
    /** The field name that caused the error (maps to schema column name). */
    field: string;
    /** Human-readable message shown inline next to the field (Chinese/English). */
    message: string;
    /** Machine-readable error code for programmatic handling. */
    code: string;
};

/**
 * The result of running a full record validation.
 * If valid = true, errors is always an empty array.
 */
export type ValidationResult = {
    valid: boolean;
    errors: ValidationError[];
};

/** Alert severity level for the 90-day experience monitor. */
export type ExperienceAlertLevel = 'ok' | 'yellow' | 'red';

/**
 * 90-day landing experience report.
 * PRD §4.2: 昼/夜落地任一项 ≤ 3 次触发黄牌，= 0 次触发红牌。
 */
export type ExperienceReport = {
    /** Total daytime landings in the last 90 days. */
    dayLdg: number;
    /** Total nighttime landings in the last 90 days. */
    nightLdg: number;
    /** Computed alert level based on PRD thresholds. */
    alertLevel: ExperienceAlertLevel;
    /** Human-readable alert message (Chinese). */
    alertMessage: string;
};

// ─── Input Type for Record Validation ────────────────────────────────────────

/**
 * The data shape passed into validateFlightRecord.
 * Uses primitive types only — no WatermelonDB dependency.
 */
export type FlightRecordInput = {
    dutyType: 'FLIGHT' | 'SIMULATOR';
    blockTimeMin: number;
    picMin: number;
    sicMin: number;
    dualMin: number;
    instructorMin: number;
    /** Night flight duration in INTEGER minutes. FLIGHT mode only; 0 for SIM. */
    nightFlightMin: number;
    /** Instrument flight time in INTEGER minutes. FLIGHT mode only; 0 for SIM. */
    instrumentMin: number;
    offUtcISO: string | null;
    onUtcISO: string | null;
    actlDate: string | null;
    schdDate: string | null;
    acftType: string | null;
    /** Optional pilot remarks. Stored as "{flightNo} | {remarks}" in export. */
    remarks: string | null;
};

// ─── 1. Full Record Validator ─────────────────────────────────────────────────

/**
 * Runs all pre-save compliance checks on a flight or simulator record.
 *
 * Checks performed (in order):
 *  1. Required fields: acftType, actlDate, schdDate, offUtcISO, onUtcISO.
 *  2. blockTimeMin must be > 0.
 *  3. PRD §4.1 red-line: PIC + SIC + DUAL + INSTRUCTOR ≤ BLOCK_TIME.
 *
 * All errors are collected and returned together so the UI can highlight
 * multiple fields at once.
 *
 * @returns ValidationResult. If valid=false, errors contains ≥1 item.
 *
 * @example
 * validateFlightRecord({
 *   dutyType: 'FLIGHT',
 *   blockTimeMin: 150,
 *   picMin: 80,
 *   sicMin: 80,  // ← 80+80 = 160 > 150
 *   dualMin: 0,
 *   instructorMin: 0,
 *   offUtcISO: '2024-03-01T08:00:00Z',
 *   onUtcISO: '2024-03-01T10:30:00Z',
 *   actlDate: '2024-03-01',
 *   schdDate: '2024-03-01',
 *   acftType: 'A320',
 * })
 * // → { valid: false, errors: [{ field: 'pic_min', code: 'ROLE_TIME_EXCEEDS_BLOCK', ... }] }
 */
export function validateFlightRecord(data: FlightRecordInput): ValidationResult {
    const errors: ValidationError[] = [];

    // ── Required fields ────────────────────────────────────────────────────────

    if (!data.acftType || data.acftType.trim() === '') {
        errors.push({
            field: 'acft_type',
            message: '机型不能为空。',
            code: 'REQUIRED_FIELD_MISSING',
        });
    }

    if (!data.actlDate || data.actlDate.trim() === '') {
        errors.push({
            field: 'actl_date',
            message: '实际日期不能为空。',
            code: 'REQUIRED_FIELD_MISSING',
        });
    }

    if (!data.schdDate || data.schdDate.trim() === '') {
        errors.push({
            field: 'schd_date',
            message: '计划日期不能为空。',
            code: 'REQUIRED_FIELD_MISSING',
        });
    }

    if (!data.offUtcISO) {
        errors.push({
            field: 'off_time_utc',
            message: '撤轮挡时刻 (OFF) 不能为空。',
            code: 'REQUIRED_FIELD_MISSING',
        });
    }

    if (!data.onUtcISO) {
        errors.push({
            field: 'on_time_utc',
            message: '挡轮挡时刻 (ON) 不能为空。',
            code: 'REQUIRED_FIELD_MISSING',
        });
    }

    // ── Block time must be positive ────────────────────────────────────────────

    if (data.blockTimeMin <= 0) {
        errors.push({
            field: 'block_time_min',
            message: '总时长 (Block Time) 必须大于 0，请检查 OFF/ON 时刻是否正确。',
            code: 'BLOCK_TIME_NOT_POSITIVE',
        });
    }

    // ── PRD §4.1 compliance red-line ──────────────────────────────────────────

    const roleTimeSum =
        data.picMin + data.sicMin + data.dualMin + data.instructorMin;

    if (roleTimeSum > data.blockTimeMin) {
        const excess = roleTimeSum - data.blockTimeMin;
        errors.push({
            field: 'pic_min',
            message:
                `合规检查失败：PIC + SIC + 带飞 + 教员 = ${roleTimeSum} 分钟，` +
                `超出总时长 ${data.blockTimeMin} 分钟（多 ${excess} 分钟）。` +
                `局方规定各细分时间之和不得超过总时长。`,
            code: 'ROLE_TIME_EXCEEDS_BLOCK',
        });
    }

    // ── Special time bounds (FLIGHT mode only) ────────────────────────────────
    // Night and instrument times may overlap with block time but cannot
    // logically exceed the total block time.

    if (data.dutyType === 'FLIGHT' && data.nightFlightMin > data.blockTimeMin) {
        errors.push({
            field: 'night_flight_min',
            message:
                `夜航时间 (${data.nightFlightMin} 分钟) 不能超过总时长 (${data.blockTimeMin} 分钟)。`,
            code: 'SPECIAL_TIME_EXCEEDS_BLOCK',
        });
    }

    if (data.dutyType === 'FLIGHT' && data.instrumentMin > data.blockTimeMin) {
        errors.push({
            field: 'instrument_min',
            message:
                `仪表时间 (${data.instrumentMin} 分钟) 不能超过总时长 (${data.blockTimeMin} 分钟)。`,
            code: 'SPECIAL_TIME_EXCEEDS_BLOCK',
        });
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

// ─── 2. 90-Day Experience Monitor ────────────────────────────────────────────

/**
 * Minimal shape of a record needed for 90-day experience calculation.
 * Callers should pre-filter to only FLIGHT records (duty_type = 'FLIGHT')
 * that are not soft-deleted (is_deleted = false) within the last 90 days.
 */
export type LandingRecord = {
    dayLdg: number;
    nightLdg: number;
};

/**
 * Computes the 90-day experience report from a collection of landing records.
 *
 * PRD §4.2 alert thresholds:
 *  - 🔴 RED  (red block): Day OR Night landings = 0
 *  - 🟡 YELLOW (warning): Day OR Night landings > 0 AND ≤ 3
 *  - 🟢 OK               : Day AND Night landings both > 3
 *
 * @param records - Array of landing records from the last 90 days.
 *                  Must be pre-filtered by the caller:
 *                  duty_type = 'FLIGHT', is_deleted = false, actl_date >= 90 days ago.
 * @returns ExperienceReport with totals and alert level.
 *
 * @example
 * // 2 day landings, 1 night landing → both ≤ 3 → yellow
 * validate90DayExperience([
 *   { dayLdg: 1, nightLdg: 1 },
 *   { dayLdg: 1, nightLdg: 0 },
 * ])
 * // → { dayLdg: 2, nightLdg: 1, alertLevel: 'yellow', alertMessage: '...' }
 *
 * // 0 night landings → red
 * validate90DayExperience([
 *   { dayLdg: 5, nightLdg: 0 },
 * ])
 * // → { dayLdg: 5, nightLdg: 0, alertLevel: 'red', alertMessage: '...' }
 */
export function validate90DayExperience(
    records: LandingRecord[]
): ExperienceReport {
    const dayLdg = records.reduce((sum, r) => sum + (r.dayLdg ?? 0), 0);
    const nightLdg = records.reduce((sum, r) => sum + (r.nightLdg ?? 0), 0);

    // RED: either day or night landings is zero
    if (dayLdg === 0 || nightLdg === 0) {
        const zeroType = dayLdg === 0 ? '昼间' : '夜间';
        return {
            dayLdg,
            nightLdg,
            alertLevel: 'red',
            alertMessage:
                `🔴 近90天${zeroType}落地次数为 0！` +
                `根据 CCAR-61 规定，您可能不具备当前机型的运行资格，请立即联系运行部门确认。`,
        };
    }

    // YELLOW: either day or night landings is ≤ 3 (but neither is 0)
    if (dayLdg <= 3 || nightLdg <= 3) {
        const lowType: string[] = [];
        if (dayLdg <= 3) lowType.push(`昼间 ${dayLdg} 次`);
        if (nightLdg <= 3) lowType.push(`夜间 ${nightLdg} 次`);
        return {
            dayLdg,
            nightLdg,
            alertLevel: 'yellow',
            alertMessage:
                `⚠️ 近90天落地次数偏少（${lowType.join('、')}），` +
                `请注意保持近期经历，避免丧失运行资格。`,
        };
    }

    // OK: both > 3
    return {
        dayLdg,
        nightLdg,
        alertLevel: 'ok',
        alertMessage: `✅ 近90天昼间 ${dayLdg} 次、夜间 ${nightLdg} 次，近期经历符合要求。`,
    };
}

// ─── 3. Helper: Compute 90-Day Window Boundary ────────────────────────────────

/**
 * Returns the ISO date string (YYYY-MM-DD) for exactly 90 days ago from today,
 * based on the device's LOCAL calendar date (PRD §4.2: "取设备当前时区的自然日零点").
 *
 * This is used by the WatermelonDB query layer to build:
 *   WHERE actl_date >= get90DayBoundaryDate()
 *
 * @param nowMs - Current timestamp in ms (defaults to Date.now()). Overridable for testing.
 * @returns YYYY-MM-DD string for 90 days ago (local date).
 *
 * @example
 * // If today is 2024-06-01:
 * get90DayBoundaryDate() // → "2024-03-03"
 */
export function get90DayBoundaryDate(nowMs: number = Date.now()): string {
    const d = new Date(nowMs);
    d.setDate(d.getDate() - 90);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
