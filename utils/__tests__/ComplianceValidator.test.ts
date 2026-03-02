/**
 * @file utils/__tests__/ComplianceValidator.test.ts
 * @description Unit tests for the structured compliance validation engine.
 */

import {
    validateFlightRecord,
    validate90DayExperience,
    get90DayBoundaryDate,
    type FlightRecordInput,
    type LandingRecord,
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
            const result = validateFlightRecord({ ...validBase, picMin: 0, sicMin: 0, nightFlightMin: 150 });
            expect(result.valid).toBe(true);
        });

        it('fails when nightFlightMin exceeds blockTimeMin', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 0, sicMin: 0, nightFlightMin: 200 });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.code === 'SPECIAL_TIME_EXCEEDS_BLOCK' && e.field === 'night_flight_min')).toBe(true);
        });

        it('passes when instrumentMin equals blockTimeMin (at limit)', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 0, sicMin: 0, instrumentMin: 150 });
            expect(result.valid).toBe(true);
        });

        it('fails when instrumentMin exceeds blockTimeMin', () => {
            const result = validateFlightRecord({ ...validBase, picMin: 0, sicMin: 0, instrumentMin: 151 });
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. validate90DayExperience — PRD §4.2 alert thresholds
// ─────────────────────────────────────────────────────────────────────────────
describe('validate90DayExperience', () => {

    describe('🟢 OK — both day and night > 3', () => {
        it('4+4 landings → ok', () => {
            const records: LandingRecord[] = [
                { dayLdg: 2, nightLdg: 2 },
                { dayLdg: 2, nightLdg: 2 },
            ];
            const report = validate90DayExperience(records);
            expect(report.alertLevel).toBe('ok');
            expect(report.dayLdg).toBe(4);
            expect(report.nightLdg).toBe(4);
        });

        it('5 day + 4 night → ok', () => {
            const records: LandingRecord[] = [
                { dayLdg: 5, nightLdg: 4 },
            ];
            expect(validate90DayExperience(records).alertLevel).toBe('ok');
        });
    });

    describe('🟡 YELLOW — day or night > 0 but ≤ 3', () => {
        it('2 day + 1 night → yellow', () => {
            const records: LandingRecord[] = [
                { dayLdg: 1, nightLdg: 1 },
                { dayLdg: 1, nightLdg: 0 },
            ];
            const report = validate90DayExperience(records);
            expect(report.alertLevel).toBe('yellow');
        });

        it('exactly 3 day + 3 night → yellow (at the limit)', () => {
            const records: LandingRecord[] = [
                { dayLdg: 3, nightLdg: 3 },
            ];
            expect(validate90DayExperience(records).alertLevel).toBe('yellow');
        });

        it('4 day + 1 night → yellow (night is low)', () => {
            expect(validate90DayExperience([{ dayLdg: 4, nightLdg: 1 }]).alertLevel).toBe('yellow');
        });

        it('1 day + 5 night → yellow (day is low)', () => {
            expect(validate90DayExperience([{ dayLdg: 1, nightLdg: 5 }]).alertLevel).toBe('yellow');
        });
    });

    describe('🔴 RED — day OR night = 0', () => {
        it('0 day landings → red', () => {
            const report = validate90DayExperience([{ dayLdg: 0, nightLdg: 5 }]);
            expect(report.alertLevel).toBe('red');
            expect(report.dayLdg).toBe(0);
        });

        it('0 night landings → red', () => {
            const report = validate90DayExperience([{ dayLdg: 5, nightLdg: 0 }]);
            expect(report.alertLevel).toBe('red');
            expect(report.nightLdg).toBe(0);
        });

        it('empty record array (no flights at all) → red', () => {
            const report = validate90DayExperience([]);
            expect(report.alertLevel).toBe('red');
            expect(report.dayLdg).toBe(0);
            expect(report.nightLdg).toBe(0);
        });

        it('0+0 landings → red', () => {
            expect(validate90DayExperience([{ dayLdg: 0, nightLdg: 0 }]).alertLevel).toBe('red');
        });
    });

    describe('summing across multiple records', () => {
        it('correctly sums dayLdg and nightLdg across 5 records', () => {
            const records: LandingRecord[] = [
                { dayLdg: 1, nightLdg: 0 },
                { dayLdg: 1, nightLdg: 1 },
                { dayLdg: 0, nightLdg: 1 },
                { dayLdg: 1, nightLdg: 0 },
                { dayLdg: 1, nightLdg: 2 },
            ];
            const report = validate90DayExperience(records);
            expect(report.dayLdg).toBe(4);
            expect(report.nightLdg).toBe(4);
            expect(report.alertLevel).toBe('ok');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. get90DayBoundaryDate
// ─────────────────────────────────────────────────────────────────────────────
describe('get90DayBoundaryDate', () => {
    it('returns a date 90 days in the past in YYYY-MM-DD format', () => {
        // Use a fixed reference date: 2024-06-01T00:00:00Z
        const refMs = Date.UTC(2024, 5, 1); // June 1, 2024
        const boundary = get90DayBoundaryDate(refMs);
        expect(boundary).toBe('2024-03-03'); // 90 days before June 1
    });

    it('returns a string matching YYYY-MM-DD pattern', () => {
        const boundary = get90DayBoundaryDate(Date.now());
        expect(boundary).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('is always exactly 90 calendar days before now', () => {
        const nowMs = Date.now();
        const boundary = get90DayBoundaryDate(nowMs);
        const boundaryMs = new Date(boundary + 'T00:00:00').getTime();
        const nowDate = new Date(nowMs);
        nowDate.setHours(0, 0, 0, 0);
        const diffDays = Math.round((nowDate.getTime() - boundaryMs) / (86400 * 1000));
        expect(diffDays).toBe(90);
    });
});
