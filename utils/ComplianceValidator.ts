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
 * 90-day takeoff & landing experience report.
 *
 * PRD V1.1 §4.2 (CCAR-121.435 — SME corrected):
 *   Alert thresholds operate on COMBINED totals (day+night) — NOT per-category.
 *   A pure daytime pilot with 10 day T/Os and 10 day landings is GREEN.
 *
 *   totalTo  = day_to + night_to ≥ 4 → green
 *   totalLdg = day_ldg + night_ldg ≥ 4 → green
 */
export type ExperienceReport = {
    /** Total daytime takeoffs in the last 90 days. */
    dayTo: number;
    /** Total nighttime takeoffs in the last 90 days. */
    nightTo: number;
    /** Total combined takeoffs (day + night) in the last 90 days. */
    totalTo: number;
    /** Total daytime landings in the last 90 days. */
    dayLdg: number;
    /** Total nighttime landings in the last 90 days. */
    nightLdg: number;
    /** Total combined landings (day + night) in the last 90 days. */
    totalLdg: number;
    /** Computed alert level based on PRD V1.1 thresholds. */
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
    /** PIC Under Supervision (機长受监视) time. Optional; 0 for pre-v4 records. */
    picUsMin?: number;
    /** Student-PIC (见习機长) time. Optional; 0 for pre-v4 records. */
    spicMin?: number;
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
    depIcao?: string | null;
    arrIcao?: string | null;
    regNo?: string | null;
    simCat?: string | null;
    simNo?: string | null;
    trainingType?: string | null;
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
            message: '撤轮档时刻 (OFF) 不能为空。',
            code: 'REQUIRED_FIELD_MISSING',
        });
    }

    if (!data.onUtcISO) {
        errors.push({
            field: 'on_time_utc',
            message: '挡轮档时刻 (ON) 不能为空。',
            code: 'REQUIRED_FIELD_MISSING',
        });
    }

    if (data.dutyType === 'FLIGHT') {
        if (!data.depIcao || data.depIcao.trim() === '') {
            errors.push({
                field: 'dep_icao',
                message: '起飞机场不能为空。',
                code: 'REQUIRED_FIELD_MISSING',
            });
        }
        if (!data.arrIcao || data.arrIcao.trim() === '') {
            errors.push({
                field: 'arr_icao',
                message: '降落机场不能为空。',
                code: 'REQUIRED_FIELD_MISSING',
            });
        }
        if (!data.regNo || data.regNo.trim() === '') {
            errors.push({
                field: 'reg_no',
                message: '航空器代号不能为空。',
                code: 'REQUIRED_FIELD_MISSING',
            });
        }
    }

    if (data.dutyType === 'SIMULATOR') {
        if (!data.simCat || data.simCat.trim() === '') {
            errors.push({
                field: 'sim_cat',
                message: '模拟机等级不能为空。',
                code: 'REQUIRED_FIELD_MISSING',
            });
        }
        if (!data.simNo || data.simNo.trim() === '') {
            errors.push({
                field: 'sim_no',
                message: '模拟机编号不能为空。',
                code: 'REQUIRED_FIELD_MISSING',
            });
        }
        if (!data.trainingType || data.trainingType.trim() === '') {
            errors.push({
                field: 'training_type',
                message: '训练类型不能为空。',
                code: 'REQUIRED_FIELD_MISSING',
            });
        }
    }

    // ── Block time must be positive ────────────────────────────────────────────

    if (data.blockTimeMin <= 0) {
        errors.push({
            field: 'block_time_min',
            message: '飞行时间 (Block Time) 必须大于 0，请检查 OFF/ON 时刻是否正确。',
            code: 'BLOCK_TIME_NOT_POSITIVE',
        });
    }

    // ── PRD §4.1 compliance red-line ──────────────────────────────────────────

    const roleTimeSum =
        data.picMin +
        (data.picUsMin ?? 0) +
        (data.spicMin ?? 0) +
        data.sicMin +
        data.dualMin +
        data.instructorMin;

    if (roleTimeSum > data.blockTimeMin) {
        const excess = roleTimeSum - data.blockTimeMin;
        errors.push({
            field: 'pic_min',
            message:
                `合规检查失败：PIC + PIC U/S + SPIC + SIC + 带飞 + 教员 = ${roleTimeSum} 分钟，` +
                `超出飞行时间 ${data.blockTimeMin} 分钟（多 ${excess} 分钟）。` +
                `依据 CCAR-61 合规要求，各项经历时间之和不得超过飞行时间 (Block Time)。`,
            code: 'ROLE_TIME_EXCEEDS_BLOCK',
        });
    }

    if (data.dutyType === 'FLIGHT' && roleTimeSum <= 0 && data.blockTimeMin > 0) {
        errors.push({
            field: 'pic_min',
            message: '真实飞行记录必须至少分配 1 分钟的经历时间 (PIC, SIC, etc) 给某一个角色。',
            code: 'EXPERIENCE_TIME_ZERO',
        });
    }

    // ── Special time bounds (FLIGHT mode only) ────────────────────────────────
    // Night and instrument times may overlap with block time but cannot
    // logically exceed the total block time.

    if (data.dutyType === 'FLIGHT' && data.nightFlightMin > data.blockTimeMin) {
        errors.push({
            field: 'night_flight_min',
            message:
                `夜航时间 (${data.nightFlightMin} 分钟) 不能超过飞行时间 (${data.blockTimeMin} 分钟)。`,
            code: 'SPECIAL_TIME_EXCEEDS_BLOCK',
        });
    }

    if (data.dutyType === 'FLIGHT' && data.instrumentMin > data.blockTimeMin) {
        errors.push({
            field: 'instrument_min',
            message:
                `仪表时间 (${data.instrumentMin} 分钟) 不能超过飞行时间 (${data.blockTimeMin} 分钟)。`,
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
 *
 * Callers should pre-filter to FLIGHT records (duty_type = 'FLIGHT')
 * that are not soft-deleted (is_deleted = false) within the last 90 days.
 *
 * Use LogbookRecord.safeDayTo / safeNightTo when building these from model objects
 * to ensure null-coalescing on pre-v3 migrated rows.
 */
export type ExperienceRecord = {
    /** Daytime takeoff count for this flight. */
    dayTo: number;
    /** Nighttime takeoff count for this flight. */
    nightTo: number;
    /** Daytime landing count for this flight. */
    dayLdg: number;
    /** Nighttime landing count for this flight. */
    nightLdg: number;
};

/**
 * @deprecated Use ExperienceRecord instead.
 * Kept for backward compatibility with callers passing only landing data.
 */
export type LandingRecord = Pick<ExperienceRecord, 'dayLdg' | 'nightLdg'>;

/**
 * Computes the 90-day experience report from a collection of flight records.
 *
 * PRD V1.1 §4.2 alert thresholds — CORRECTED by CAAC SME:
 *   Operates on COMBINED totals (day+night), NOT per-category.
 *   Rationale: CCAR-121 only requires total T/O and landing counts, not night-specific.
 *   A pure daytime pilot with 10 day T/Os + 10 day landings MUST show GREEN.
 *
 *   - 🔴 RED    (blocking): totalTo === 0 OR totalLdg === 0
 *   - 🟡 YELLOW (warning):  totalTo ≤ 3 OR totalLdg ≤ 3 (but neither is 0)
 *   - 🟢 OK              :  totalTo ≥ 4 AND totalLdg ≥ 4
 *
 * @param records - Array of records from the last 90 days.
 *                  Must be pre-filtered: duty_type='FLIGHT', is_deleted=false,
 *                  actl_date >= get90DayBoundaryDate().
 * @returns ExperienceReport with per-category sub-totals, combined totals, and alert level.
 *
 * @example
 * // Pure daytime pilot: 5 day T/Os, 0 night T/Os, 5 day LDGs, 0 night LDGs
 * // totalTo=5, totalLdg=5 → GREEN (correct per CCAR-121)
 * validate90DayExperience([{ dayTo: 5, nightTo: 0, dayLdg: 5, nightLdg: 0 }])
 * // → { totalTo: 5, totalLdg: 5, alertLevel: 'ok', ... }
 *
 * @example
 * // No takeoffs at all
 * validate90DayExperience([{ dayTo: 0, nightTo: 0, dayLdg: 5, nightLdg: 3 }])
 * // → { totalTo: 0, totalLdg: 8, alertLevel: 'red', ... }
 */
export function validate90DayExperience(
    records: ExperienceRecord[]
): ExperienceReport {
    const dayTo = records.reduce((sum, r) => sum + (r.dayTo ?? 0), 0);
    const nightTo = records.reduce((sum, r) => sum + (r.nightTo ?? 0), 0);
    const dayLdg = records.reduce((sum, r) => sum + (r.dayLdg ?? 0), 0);
    const nightLdg = records.reduce((sum, r) => sum + (r.nightLdg ?? 0), 0);

    const totalTo = dayTo + nightTo;
    const totalLdg = dayLdg + nightLdg;

    // 🔴 RED: either combined total is zero
    if (totalTo === 0 || totalLdg === 0) {
        return {
            dayTo, nightTo, totalTo,
            dayLdg, nightLdg, totalLdg,
            alertLevel: 'red',
            alertMessage:
                '近 90 天记录中起飞或着陆次数为零，可能不满足近期飞行经历要求。' +
                '请依据所在公司运行手册或飞行标准部门要求核实，并安排相应训练。',
        };
    }

    // 🟡 YELLOW: either combined total ≤ 3 (but neither is 0)
    if (totalTo <= 3 || totalLdg <= 3) {
        const lowItems: string[] = [];
        if (totalTo <= 3) lowItems.push(`起飞 ${totalTo} 次`);
        if (totalLdg <= 3) lowItems.push(`着陆 ${totalLdg} 次`);
        return {
            dayTo, nightTo, totalTo,
            dayLdg, nightLdg, totalLdg,
            alertLevel: 'yellow',
            alertMessage:
                `近 90 天${lowItems.join('、')}，低于 CCAR-61.55 规定最低次数，近期飞行经历即将失效。` +
                '请依据所在公司运行手册或飞行标准部门要求核实。',
        };
    }

    // 🟢 OK: both totals ≥ 4
    return {
        dayTo, nightTo, totalTo,
        dayLdg, nightLdg, totalLdg,
        alertLevel: 'ok',
        alertMessage: `近 90 天起飞 ${totalTo} 次、着陆 ${totalLdg} 次，近期飞行经历符合要求。`,
    };
}

// ─── 3. Helper: Compute 90-Day Window Boundary ────────────────────────────────

/**
 * Returns the ISO date string (YYYY-MM-DD) for exactly 90 days ago from today,
 * **pinned to Beijing Time (UTC+8)** as required by PRD V1.1 §4.2.
 *
 * Rationale: Pilots on international routes may have their device clock auto-switch
 * timezone. Using device-local time would cause the 90-day boundary to shift by
 * up to 12+ hours, causing spurious yellow/red card oscillations at the threshold.
 * Beijing Time is the CAAC standard reference for near-recency audits.
 *
 * @param nowMs - Current timestamp in ms (defaults to Date.now()). Overridable for testing.
 * @returns YYYY-MM-DD string for 90 days ago in Beijing Time (UTC+8).
 *
 * @example
 * // Pilot lands in Los Angeles, device switches to US/Pacific (UTC-8).
 * // If nowMs = 2024-03-01T16:30:00Z (Beijing: 2024-03-02T00:30:00+08):
 * get90DayBoundaryDate(Date.parse('2024-03-01T16:30:00Z'))
 * // → "2023-12-03"  (90 days before 2024-03-02 in Beijing time)
 * // NOT "2023-12-02" (which would result from using UTC midnight)
 */
export function get90DayBoundaryDate(nowMs: number = Date.now()): string {
    // Shift the timestamp to "Beijing virtual UTC" by adding UTC+8 offset.
    // Then use UTC methods, which now reflect Beijing calendar date.
    const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8
    const beijingNow = new Date(nowMs + BEIJING_OFFSET_MS);
    beijingNow.setUTCDate(beijingNow.getUTCDate() - 90);
    const year = beijingNow.getUTCFullYear();
    const month = String(beijingNow.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingNow.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
