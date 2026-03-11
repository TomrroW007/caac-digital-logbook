/**
 * @file utils/__tests__/ComplianceValidator.test.ts
 * @description Unit tests for the structured compliance validation engine.
 *
 * V1.1 changes tested:
 *  - 90-day alert logic now uses combined totals (dayTo+nightTo, dayLdg+nightLdg).
 *  - Pure daytime pilot (nightTo=0, nightLdg=0) must show GREEN (SME-mandated).
 *  - get90DayBoundaryDate uses Beijing Time (UTC+8), not device locale.
 */

import {
    validateFlightRecord,
    validate90DayExperience,
    get90DayBoundaryDate,
    type FlightRecordInput,
    type ExperienceRecord,
} from '../ComplianceValidator';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const validBase: FlightRecordInput = {
    dutyType: 'FLIGHT',
    blockTimeMin: 150,
    picMin: 80,
    sicMin: 70,
    dualMin: 0,
    instructorMin: 0,
    nightFlightMin: 0,
    instrumentMin: 0,
    offUtcISO: '2024-03-01T08:00:00Z',
    onUtcISO: '2024-03-01T10:30:00Z',
    actlDate: '2024-03-01',
    schdDate: '2024-03-01',
    acftType: 'A320',
    depIcao: 'ZBAA',
    arrIcao: 'ZSSD',
    regNo: 'B-1234',
    remarks: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. validateFlightRecord
// ─────────────────────────────────────────────────────────────────────────────
describe('validateFlightRecord', () => {

    describe('valid records', () => {
        it('passes a fully valid record', () => {
            const result = validateFlightRecord(validBase);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('passes when role sum exactly equals block time (edge: at limit)', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 150, sicMin: 0 });
            expect(result.valid).toBe(true);
        });

        it('passes a valid SIM record', () => {
            const result = validateFlightRecord({
                ...validBase,
                dutyType: 'SIMULATOR',
                picMin: 0,
                sicMin: 0,
                dualMin: 150,
                simCat: 'FFS D',
                simNo: '12-34',
                trainingType: 'Recurrent',
            });
            expect(result.valid).toBe(true);
        });
    });

    describe('PRD §4.1 role-time compliance red-line', () => {
        it('fails when PIC + SIC exceeds block time', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 80, sicMin: 80 });
            // 80 + 80 = 160 > 150
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.code === 'ROLE_TIME_EXCEEDS_BLOCK')).toBe(true);
        });

        it('fails when all four role times together exceed block', () => {
            const result = validateFlightRecord({
                ...validBase,
                picMin: 40, sicMin: 40, dualMin: 40, instructorMin: 40,
                // sum = 160 > 150
            });
            expect(result.valid).toBe(false);
            expect(result.errors[0].code).toBe('ROLE_TIME_EXCEEDS_BLOCK');
        });

        it('includes excess minutes in the error message', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 100, sicMin: 60 });
            const err = result.errors.find(e => e.code === 'ROLE_TIME_EXCEEDS_BLOCK');
            expect(err?.message).toContain('10 分钟'); // 160 - 150 = 10
        });
    });

    describe('required field checks', () => {
        it('fails when acftType is empty', () => {
            const result = validateFlightRecord({ ...validBase, acftType: '' });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.field === 'acft_type')).toBe(true);
        });

        it('fails when acftType is null', () => {
            const result = validateFlightRecord({ ...validBase, acftType: null });
            expect(result.valid).toBe(false);
        });

        it('fails when actlDate is null', () => {
            const result = validateFlightRecord({ ...validBase, actlDate: null });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.field === 'actl_date')).toBe(true);
        });

        it('fails when offUtcISO is null', () => {
            const result = validateFlightRecord({ ...validBase, offUtcISO: null });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.field === 'off_time_utc')).toBe(true);
        });

        it('fails when onUtcISO is null', () => {
            const result = validateFlightRecord({ ...validBase, onUtcISO: null });
            expect(result.valid).toBe(false);
        });

        it('collects multiple errors at once', () => {
            const result = validateFlightRecord({
                ...validBase,
                acftType: null,
                actlDate: null,
                offUtcISO: null,
            });
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThanOrEqual(3);
        });

        it('fails when FLIGHT missing depIcao', () => {
            const result = validateFlightRecord({ ...validBase, depIcao: '' });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.field === 'dep_icao')).toBe(true);
        });

        it('fails when FLIGHT missing arrIcao', () => {
            const result = validateFlightRecord({ ...validBase, arrIcao: '' });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.field === 'arr_icao')).toBe(true);
        });

        it('fails when FLIGHT missing regNo', () => {
            const result = validateFlightRecord({ ...validBase, regNo: '' });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.field === 'reg_no')).toBe(true);
        });

        it('fails when FLIGHT has zero experience time', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 0, sicMin: 0 });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.code === 'EXPERIENCE_TIME_ZERO')).toBe(true);
        });

        it('fails when SIM missing simCat, simNo, trainingType', () => {
            const result = validateFlightRecord({
                ...validBase,
                dutyType: 'SIMULATOR',
                picMin: 0, sicMin: 0, dualMin: 150, // fix experience time
                simCat: '', simNo: '', trainingType: ''
            });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.field === 'sim_cat')).toBe(true);
            expect(result.errors.some(e => e.field === 'sim_no')).toBe(true);
            expect(result.errors.some(e => e.field === 'training_type')).toBe(true);
        });
    });

    describe('block time check', () => {
        it('fails when blockTimeMin is 0', () => {
            const result = validateFlightRecord({ ...validBase, blockTimeMin: 0, picMin: 0, sicMin: 0 });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.code === 'BLOCK_TIME_NOT_POSITIVE')).toBe(true);
        });

        it('fails when blockTimeMin is negative', () => {
            const result = validateFlightRecord({ ...validBase, blockTimeMin: -10, picMin: 0, sicMin: 0 });
            expect(result.valid).toBe(false);
        });
    });

    describe('special time bounds (FLIGHT mode only)', () => {
        it('passes when nightFlightMin equals blockTimeMin (at limit)', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 150, sicMin: 0, nightFlightMin: 150 });
            expect(result.valid).toBe(true);
        });

        it('fails when nightFlightMin exceeds blockTimeMin', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 150, sicMin: 0, nightFlightMin: 200 });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.code === 'SPECIAL_TIME_EXCEEDS_BLOCK' && e.field === 'night_flight_min')).toBe(true);
        });

        it('passes when instrumentMin equals blockTimeMin (at limit)', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 150, sicMin: 0, instrumentMin: 150 });
            expect(result.valid).toBe(true);
        });

        it('fails when instrumentMin exceeds blockTimeMin', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 150, sicMin: 0, instrumentMin: 151 });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.code === 'SPECIAL_TIME_EXCEEDS_BLOCK' && e.field === 'instrument_min')).toBe(true);
        });

        it('does NOT apply special time bounds to SIMULATOR records', () => {
            // SIM records can have large nightFlightMin/instrumentMin values without failing
            const result = validateFlightRecord({
                ...validBase,
                dutyType: 'SIMULATOR',
                picMin: 0,
                sicMin: 0,
                nightFlightMin: 9999,
                instrumentMin: 9999,
            });
            // Should only fail if role sum exceeds block — not for special times on SIM
            expect(result.errors.some(e => e.code === 'SPECIAL_TIME_EXCEEDS_BLOCK')).toBe(false);
        });

        it('collects both special time errors alongside role-sum errors', () => {
            const result = validateFlightRecord({
                ...validBase,
                picMin: 80,
                sicMin: 80,       // role sum = 160 > 150 → ROLE_TIME_EXCEEDS_BLOCK
                nightFlightMin: 200, // > 150 → SPECIAL_TIME_EXCEEDS_BLOCK (night)
                instrumentMin: 200,  // > 150 → SPECIAL_TIME_EXCEEDS_BLOCK (instrument)
            });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.code === 'ROLE_TIME_EXCEEDS_BLOCK')).toBe(true);
            expect(result.errors.some(e => e.code === 'SPECIAL_TIME_EXCEEDS_BLOCK')).toBe(true);
        });
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. validate90DayExperience — PRD V1.1 §4.2 alert thresholds (COMBINED totals)
//
//    SME correction: thresholds apply to totalTo = dayTo+nightTo and
//    totalLdg = dayLdg+nightLdg, NOT to per-category counts.
// ──────────────────────────────────────────────────────────────────────────────
describe('validate90DayExperience', () => {

    describe('🟢 OK — totalTo ≥ 4 AND totalLdg ≥ 4', () => {
        it('4+4 total landings and 4+4 total takeoffs → ok', () => {
            const records: ExperienceRecord[] = [
                { dayTo: 2, nightTo: 2, dayLdg: 2, nightLdg: 2 },
                { dayTo: 2, nightTo: 2, dayLdg: 2, nightLdg: 2 },
            ];
            const report = validate90DayExperience(records);
            expect(report.alertLevel).toBe('ok');
            expect(report.totalTo).toBe(8);
            expect(report.totalLdg).toBe(8);
        });

        it('✅ SME-MANDATED: pure daytime pilot (nightTo=0, nightLdg=0) → ok (MUST NOT be red!)', () => {
            // A pilot who only flies daytime routes has 0 night T/Os and 0 night LDGs.
            // CCAR-121 near-recency only requires TOTAL counts, not night-specific.
            // If this returned 'red', it would be a wrongful operational block.
            const records: ExperienceRecord[] = [
                { dayTo: 5, nightTo: 0, dayLdg: 5, nightLdg: 0 },
            ];
            const report = validate90DayExperience(records);
            expect(report.alertLevel).toBe('ok'); // ❌ MUST NOT be 'red'
            expect(report.totalTo).toBe(5);
            expect(report.totalLdg).toBe(5);
        });

        it('5 day T/O + 4 night T/O, 5 day LDG + 4 night LDG → ok', () => {
            const records: ExperienceRecord[] = [
                { dayTo: 5, nightTo: 4, dayLdg: 5, nightLdg: 4 },
            ];
            expect(validate90DayExperience(records).alertLevel).toBe('ok');
        });

        it('mixed night/day across records → ok when combined totals ≥ 4', () => {
            // dayTo=4, nightTo=1 → totalTo=5; dayLdg=3, nightLdg=2 → totalLdg=5
            const records: ExperienceRecord[] = [
                { dayTo: 4, nightTo: 1, dayLdg: 3, nightLdg: 2 },
            ];
            expect(validate90DayExperience(records).alertLevel).toBe('ok');
        });
    });

    describe('🟡 YELLOW — totalTo ≤ 3 OR totalLdg ≤ 3 (but neither is 0)', () => {
        it('totalTo=3, totalLdg=5 → yellow (T/O at limit)', () => {
            // dayTo=1, nightTo=2 → totalTo=3 (at limit); dayLdg=5 → totalLdg=5
            const records: ExperienceRecord[] = [
                { dayTo: 1, nightTo: 2, dayLdg: 5, nightLdg: 0 },
            ];
            const report = validate90DayExperience(records);
            expect(report.alertLevel).toBe('yellow');
            expect(report.totalTo).toBe(3);
        });

        it('totalTo=5, totalLdg=3 → yellow (LDG at limit)', () => {
            // dayTo=5, dayLdg=1, nightLdg=2 → totalLdg=3
            const records: ExperienceRecord[] = [
                { dayTo: 5, nightTo: 0, dayLdg: 1, nightLdg: 2 },
            ];
            const report = validate90DayExperience(records);
            expect(report.alertLevel).toBe('yellow');
            expect(report.totalLdg).toBe(3);
        });

        it('totalTo=1, totalLdg=1 → yellow (both low but not zero)', () => {
            const records: ExperienceRecord[] = [
                { dayTo: 1, nightTo: 0, dayLdg: 1, nightLdg: 0 },
            ];
            expect(validate90DayExperience(records).alertLevel).toBe('yellow');
        });

        it('exactly 3 total T/O and 3 total LDG → yellow (at the limit)', () => {
            const records: ExperienceRecord[] = [
                { dayTo: 3, nightTo: 0, dayLdg: 3, nightLdg: 0 },
            ];
            expect(validate90DayExperience(records).alertLevel).toBe('yellow');
        });

        it('4 total T/O + 1 total LDG → yellow (LDG is low)', () => {
            expect(validate90DayExperience([{ dayTo: 4, nightTo: 0, dayLdg: 1, nightLdg: 0 }]).alertLevel).toBe('yellow');
        });

        it('1 total T/O + 5 total LDG → yellow (T/O is low)', () => {
            expect(validate90DayExperience([{ dayTo: 0, nightTo: 1, dayLdg: 5, nightLdg: 0 }]).alertLevel).toBe('yellow');
        });
    });

    describe('🔴 RED — totalTo === 0 OR totalLdg === 0', () => {
        it('zero total takeoffs → red (even with many landings)', () => {
            const report = validate90DayExperience([{ dayTo: 0, nightTo: 0, dayLdg: 5, nightLdg: 3 }]);
            expect(report.alertLevel).toBe('red');
            expect(report.totalTo).toBe(0);
        });

        it('zero total landings → red (even with many takeoffs)', () => {
            const report = validate90DayExperience([{ dayTo: 5, nightTo: 3, dayLdg: 0, nightLdg: 0 }]);
            expect(report.alertLevel).toBe('red');
            expect(report.totalLdg).toBe(0);
        });

        it('empty record array (no flights at all) → red', () => {
            const report = validate90DayExperience([]);
            expect(report.alertLevel).toBe('red');
            expect(report.totalTo).toBe(0);
            expect(report.totalLdg).toBe(0);
        });

        it('all zeros → red', () => {
            expect(validate90DayExperience([{ dayTo: 0, nightTo: 0, dayLdg: 0, nightLdg: 0 }]).alertLevel).toBe('red');
        });
    });

    describe('summing across multiple records', () => {
        it('correctly sums all four fields across 5 records', () => {
            const records: ExperienceRecord[] = [
                { dayTo: 1, nightTo: 0, dayLdg: 1, nightLdg: 0 },
                { dayTo: 1, nightTo: 1, dayLdg: 1, nightLdg: 1 },
                { dayTo: 0, nightTo: 1, dayLdg: 0, nightLdg: 1 },
                { dayTo: 1, nightTo: 0, dayLdg: 1, nightLdg: 0 },
                { dayTo: 1, nightTo: 2, dayLdg: 1, nightLdg: 2 },
            ];
            const report = validate90DayExperience(records);
            expect(report.dayTo).toBe(4);
            expect(report.nightTo).toBe(4);
            expect(report.totalTo).toBe(8);
            expect(report.dayLdg).toBe(4);
            expect(report.nightLdg).toBe(4);
            expect(report.totalLdg).toBe(8);
            expect(report.alertLevel).toBe('ok');
        });
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. get90DayBoundaryDate — Beijing Time (UTC+8) baseline
// ──────────────────────────────────────────────────────────────────────────────
describe('get90DayBoundaryDate', () => {
    it('returns a date 90 days in the past in YYYY-MM-DD format', () => {
        // Reference: 2024-06-01 00:00:00 UTC+8 = 2024-05-31 16:00:00 UTC
        const refMs = Date.UTC(2024, 4, 31, 16, 0, 0); // 2024-06-01T00:00:00+08:00
        const boundary = get90DayBoundaryDate(refMs);
        expect(boundary).toBe('2024-03-03'); // 90 days before 2024-06-01 in Beijing
    });

    it('returns a string matching YYYY-MM-DD pattern', () => {
        const boundary = get90DayBoundaryDate(Date.now());
        expect(boundary).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('is always exactly 90 calendar days before today in Beijing Time', () => {
        const nowMs = Date.now();
        // Compute expected boundary using Beijing midnight directly
        const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
        const beijingNow = new Date(nowMs + BEIJING_OFFSET_MS);
        const expectedDate = new Date(beijingNow);
        expectedDate.setUTCDate(expectedDate.getUTCDate() - 90);
        const expected = [
            expectedDate.getUTCFullYear(),
            String(expectedDate.getUTCMonth() + 1).padStart(2, '0'),
            String(expectedDate.getUTCDate()).padStart(2, '0'),
        ].join('-');
        expect(get90DayBoundaryDate(nowMs)).toBe(expected);
    });

    it('🌏 Beijing-time cross-midnight test: UTC 16:30 = Beijing 00:30 next day', () => {
        // Scenario: Pilot landing in Los Angeles. Device time is UTC-8.
        // nowMs = 2024-03-01T16:30:00Z
        //       = 2024-03-02T00:30:00+08:00 (Beijing — it’s already March 2 there)
        //
        // Expected: boundary = 90 days before 2024-03-02 in Beijing = 2023-12-03
        // If device-local (UTC) were used: 90 days before 2024-03-01 = 2023-12-01 (WRONG)
        const nowMs = Date.parse('2024-03-01T16:30:00Z');
        const boundary = get90DayBoundaryDate(nowMs);
        expect(boundary).toBe('2023-12-03'); // 90 days before 2024-03-02 (Beijing)
        expect(boundary).not.toBe('2023-12-01'); // NOT 90 days before 2024-03-01 (UTC)
    });
});
