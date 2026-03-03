/**
 * @file utils/__tests__/TimeCalculator.test.ts
 * @description Jest unit tests for the CAAC Digital Logbook time calculation engine.
 *
 * Test matrix covers all critical paths defined in PRD and KI testing_patterns.md:
 *  - parseRawInputToMinutes: padding, edge cases, error handling
 *  - minutesToHHMM:          formatting, zero-padding, cumulative hours > 24
 *  - hhmmToMinutes:          round-trip, edge cases
 *  - calcBlockMinutes:       normal, cross-midnight (the critical safety test)
 *  - localTimeToUtcISO:      UTC+8 (Beijing), UTC-5 (New York), zero offset
 *  - inferOffOn:             10-5 rule, cross-midnight
 *  - isRoleTimeSumValid:     at-limit (pass), over-limit (fail), zero case
 */

import {
    parseRawInputToMinutes,
    minutesToHHMM,
    hhmmToMinutes,
    calcBlockMinutes,
    localTimeToUtcISO,
    inferOffOn,
    isRoleTimeSumValid,
} from '../TimeCalculator';

// ─────────────────────────────────────────────────────────────────────────────
// 1. parseRawInputToMinutes
// ─────────────────────────────────────────────────────────────────────────────
describe('parseRawInputToMinutes', () => {
    describe('standard 4-digit input', () => {
        it('converts "0830" → 510', () => {
            expect(parseRawInputToMinutes('0830')).toBe(510);
        });

        it('converts "2359" → 1439 (maximum valid time)', () => {
            expect(parseRawInputToMinutes('2359')).toBe(1439);
        });

        it('converts "0000" → 0 (midnight)', () => {
            expect(parseRawInputToMinutes('0000')).toBe(0);
        });

        it('converts "1200" → 720 (noon)', () => {
            expect(parseRawInputToMinutes('1200')).toBe(720);
        });
    });

    describe('3-digit input (implicit leading zero)', () => {
        it('converts "830" → 510 (same as "0830")', () => {
            expect(parseRawInputToMinutes('830')).toBe(510);
        });

        it('converts "100" → 60 (1:00)', () => {
            expect(parseRawInputToMinutes('100')).toBe(60);
        });
    });

    describe('2-digit input (minutes only)', () => {
        it('converts "30" → 30 (00:30)', () => {
            expect(parseRawInputToMinutes('30')).toBe(30);
        });

        it('converts "05" → 5 (00:05)', () => {
            expect(parseRawInputToMinutes('05')).toBe(5);
        });
    });

    describe('edge cases', () => {
        it('converts "0" → 0', () => {
            expect(parseRawInputToMinutes('0')).toBe(0);
        });

        it('converts "" (empty string) → 0', () => {
            expect(parseRawInputToMinutes('')).toBe(0);
        });

        it('strips colons from pasted input ("08:30" → 510)', () => {
            // Pilots may paste from other sources with colons
            expect(parseRawInputToMinutes('08:30')).toBe(510);
        });
    });

    describe('invalid input throws', () => {
        it('throws for hours > 23 ("2400")', () => {
            expect(() => parseRawInputToMinutes('2400')).toThrow();
        });

        it('throws for minutes > 59 ("0860")', () => {
            expect(() => parseRawInputToMinutes('0860')).toThrow();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. minutesToHHMM
// ─────────────────────────────────────────────────────────────────────────────
describe('minutesToHHMM', () => {
    it('formats 150 → "2:30"', () => {
        expect(minutesToHHMM(150)).toBe('2:30');
    });

    it('formats 65 → "1:05" (zero-pads single-digit minutes)', () => {
        expect(minutesToHHMM(65)).toBe('1:05');
    });

    it('formats 0 → "0:00"', () => {
        expect(minutesToHHMM(0)).toBe('0:00');
    });

    it('formats 60 → "1:00"', () => {
        expect(minutesToHHMM(60)).toBe('1:00');
    });

    it('formats 1439 → "23:59" (maximum single-day)', () => {
        expect(minutesToHHMM(1439)).toBe('23:59');
    });

    it('formats 1500 → "25:00" (cumulative totals can exceed 24h)', () => {
        // This is important for the PDF footer "total to date" column
        expect(minutesToHHMM(1500)).toBe('25:00');
    });

    it('throws for negative input', () => {
        expect(() => minutesToHHMM(-1)).toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. hhmmToMinutes (round-trip with minutesToHHMM)
// ─────────────────────────────────────────────────────────────────────────────
describe('hhmmToMinutes', () => {
    it('parses "2:30" → 150', () => {
        expect(hhmmToMinutes('2:30')).toBe(150);
    });

    it('parses "1:05" → 65', () => {
        expect(hhmmToMinutes('1:05')).toBe(65);
    });

    it('parses "0:00" → 0', () => {
        expect(hhmmToMinutes('0:00')).toBe(0);
    });

    it('parses "25:00" → 1500 (cumulative totals)', () => {
        expect(hhmmToMinutes('25:00')).toBe(1500);
    });

    it('round-trips: minutesToHHMM(hhmmToMinutes("3:45")) === "3:45"', () => {
        expect(minutesToHHMM(hhmmToMinutes('3:45'))).toBe('3:45');
    });

    it('throws for invalid format "830"', () => {
        expect(() => hhmmToMinutes('830')).toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. calcBlockMinutes — THE critical cross-midnight safety test
// ─────────────────────────────────────────────────────────────────────────────
describe('calcBlockMinutes', () => {
    describe('same-day flights', () => {
        it('calculates 2h 30m same-day flight (08:00 → 10:30)', () => {
            expect(
                calcBlockMinutes(
                    '2024-03-01T08:00:00Z',
                    '2024-03-01T10:30:00Z'
                )
            ).toBe(150);
        });

        it('calculates exactly 1 minute (edge: consecutive minutes)', () => {
            expect(
                calcBlockMinutes(
                    '2024-03-01T08:00:00Z',
                    '2024-03-01T08:01:00Z'
                )
            ).toBe(1);
        });

        it('calculates 0 when OFF === ON (degenerate case)', () => {
            expect(
                calcBlockMinutes(
                    '2024-03-01T08:00:00Z',
                    '2024-03-01T08:00:00Z'
                )
            ).toBe(0);
        });
    });

    describe('cross-midnight flights (critical safety test)', () => {
        /**
         * Test case: DOH-PEK style red-eye departure
         * OFF = 23:00 UTC, ON = 01:30 UTC next day
         * Expected = 150 minutes (2h 30m), NOT -1290 minutes
         */
        it('🔴 handles cross-midnight: 23:00 → 01:30 next day = 150 min', () => {
            expect(
                calcBlockMinutes(
                    '2024-03-01T23:00:00Z',
                    '2024-03-02T01:30:00Z'
                )
            ).toBe(150);
        });

        it('handles just-after-midnight ON time: 23:58 → 00:03 = 5 min', () => {
            expect(
                calcBlockMinutes(
                    '2024-03-01T23:58:00Z',
                    '2024-03-02T00:03:00Z'
                )
            ).toBe(5);
        });

        it('handles long overnight sector: 20:00 → 06:00 = 600 min (10h)', () => {
            expect(
                calcBlockMinutes(
                    '2024-03-01T20:00:00Z',
                    '2024-03-02T06:00:00Z'
                )
            ).toBe(600);
        });
    });

    describe('invalid inputs', () => {
        it('throws for invalid off time', () => {
            expect(() => calcBlockMinutes('not-a-date', '2024-03-01T10:00:00Z')).toThrow();
        });

        it('throws for invalid on time', () => {
            expect(() => calcBlockMinutes('2024-03-01T08:00:00Z', 'not-a-date')).toThrow();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. localTimeToUtcISO
// ─────────────────────────────────────────────────────────────────────────────
describe('localTimeToUtcISO', () => {
    describe('UTC+8 (Beijing / PEK / SHA)', () => {
        it('converts 08:30 LT (UTC+8) → 00:30 UTC', () => {
            const result = localTimeToUtcISO('2024-03-01', '0830', 480);
            expect(result).toBe('2024-03-01T00:30:00.000Z');
        });

        it('converts 00:00 LT (UTC+8) → previous day 16:00 UTC', () => {
            const result = localTimeToUtcISO('2024-03-01', '0000', 480);
            expect(result).toBe('2024-02-29T16:00:00.000Z');
        });
    });

    describe('UTC-5 (New York / JFK)', () => {
        it('converts 08:30 LT (UTC-5) → 13:30 UTC', () => {
            const result = localTimeToUtcISO('2024-03-01', '0830', -300);
            expect(result).toBe('2024-03-01T13:30:00.000Z');
        });
    });

    describe('UTC+0 (London / LHR off-peak)', () => {
        it('converts 12:00 LT (UTC+0) → 12:00 UTC', () => {
            const result = localTimeToUtcISO('2024-03-01', '1200', 0);
            expect(result).toBe('2024-03-01T12:00:00.000Z');
        });
    });

    describe('invalid inputs', () => {
        it('throws for invalid date format', () => {
            expect(() => localTimeToUtcISO('01-03-2024', '0830', 480)).toThrow();
        });

        it('throws for invalid time input', () => {
            expect(() => localTimeToUtcISO('2024-03-01', '2500', 480)).toThrow();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. inferOffOn (10-5 Rule)
// ─────────────────────────────────────────────────────────────────────────────
describe('inferOffOn', () => {
    it('applies 10-5 rule: OFF = TO - 10m, ON = LDG + 5m', () => {
        const { offUtcISO, onUtcISO } = inferOffOn(
            '2024-03-01T08:10:00Z', // TO
            '2024-03-01T10:30:00Z'  // LDG
        );
        expect(offUtcISO).toBe('2024-03-01T08:00:00.000Z'); // TO - 10m
        expect(onUtcISO).toBe('2024-03-01T10:35:00.000Z');  // LDG + 5m
    });

    it('handles TO at exactly 00:05 UTC (OFF would be 23:55 previous day)', () => {
        const { offUtcISO } = inferOffOn(
            '2024-03-01T00:05:00Z', // TO
            '2024-03-01T02:00:00Z'  // LDG
        );
        // OFF = 00:05 - 10m = 23:55 previous day
        expect(offUtcISO).toBe('2024-02-29T23:55:00.000Z');
    });

    it('throws for invalid TO time', () => {
        expect(() => inferOffOn('bad-date', '2024-03-01T10:30:00Z')).toThrow();
    });

    it('throws for invalid LDG time', () => {
        expect(() => inferOffOn('2024-03-01T08:10:00Z', 'bad-date')).toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. isRoleTimeSumValid (PRD §4.1 compliance red-line)
// ─────────────────────────────────────────────────────────────────────────────
describe('isRoleTimeSumValid', () => {
    const base = { blockTimeMin: 150 };

    it('returns true when sum equals block time exactly (at the limit)', () => {
        expect(isRoleTimeSumValid({ ...base, picMin: 80, sicMin: 70, dualMin: 0, instructorMin: 0 })).toBe(true);
    });

    it('returns true when sum is less than block time', () => {
        expect(isRoleTimeSumValid({ ...base, picMin: 150, sicMin: 0, dualMin: 0, instructorMin: 0 })).toBe(true);
    });

    it('returns false when sum exceeds block time by 1', () => {
        expect(isRoleTimeSumValid({ ...base, picMin: 80, sicMin: 71, dualMin: 0, instructorMin: 0 })).toBe(false);
    });

    it('returns false in a realistic over-claim scenario (PIC+SIC+Dual > Block)', () => {
        expect(isRoleTimeSumValid({ ...base, picMin: 80, sicMin: 80, dualMin: 0, instructorMin: 0 })).toBe(false);
    });

    it('returns true for all-zero role times (e.g. unedited SIM record)', () => {
        expect(isRoleTimeSumValid({ ...base, picMin: 0, sicMin: 0, dualMin: 0, instructorMin: 0 })).toBe(true);
    });

    it('handles all four role types combined', () => {
        // PIC=40, SIC=40, Dual=35, Instructor=35 → sum=150 → exactly at limit → pass
        expect(isRoleTimeSumValid({ blockTimeMin: 150, picMin: 40, sicMin: 40, dualMin: 35, instructorMin: 35 })).toBe(true);
        // With +1 on instructor → fail
        expect(isRoleTimeSumValid({ blockTimeMin: 150, picMin: 40, sicMin: 40, dualMin: 35, instructorMin: 36 })).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. isNightHintTime (PRD V1.1 §3.2 — night-flight field highlight)
//
//    QA-mandated test matrix: partial inputs MUST return false to prevent
//    UI flicker. Only complete 4-digit inputs with hours ≥ 19 return true.
// ─────────────────────────────────────────────────────────────────────────────
import { isNightHintTime } from '../TimeCalculator';

describe('isNightHintTime', () => {

    describe('✅ QA-MANDATED: boundary at exactly 19:00', () => {
        it('isNightHintTime("1859") → false  (18:59, one minute before threshold)', () => {
            expect(isNightHintTime('1859')).toBe(false);
        });

        it('isNightHintTime("1900") → true   (exactly 19:00 — threshold)', () => {
            expect(isNightHintTime('1900')).toBe(true);
        });
    });

    describe('✅ QA-MANDATED: partial inputs must NOT trigger hint (anti-flicker)', () => {
        it('isNightHintTime("19") → false   (partial — user still typing minutes)', () => {
            expect(isNightHintTime('19')).toBe(false);
        });

        it('isNightHintTime("1") → false    (too short)', () => {
            expect(isNightHintTime('1')).toBe(false);
        });

        it('isNightHintTime("190") → false  (3 digits, partial)', () => {
            expect(isNightHintTime('190')).toBe(false);
        });

        it('isNightHintTime("") → false     (empty string)', () => {
            expect(isNightHintTime('')).toBe(false);
        });
    });

    describe('daytime inputs (< 19:00) → false', () => {
        it('"0000" → false (midnight start)', () => {
            expect(isNightHintTime('0000')).toBe(false);
        });

        it('"0830" → false (morning departure)', () => {
            expect(isNightHintTime('0830')).toBe(false);
        });

        it('"1800" → false (18:00, before threshold)', () => {
            expect(isNightHintTime('1800')).toBe(false);
        });
    });

    describe('night-time inputs (≥ 19:00) → true', () => {
        it('"2130" → true  (21:30, late evening)', () => {
            expect(isNightHintTime('2130')).toBe(true);
        });

        it('"2359" → true  (23:59, latest valid time)', () => {
            expect(isNightHintTime('2359')).toBe(true);
        });

        it('"19:00" (with colon, pasted value) → true', () => {
            // Non-digits stripped → "1900" → true
            expect(isNightHintTime('19:00')).toBe(true);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. localTimeToUtcISO — cross-midnight date rollback proof (QA-mandated)
//
//    PRD V1.1 §3.2 "跨零点绝对推算": when a local midnight input (00:05 UTC+8)
//    maps to the previous UTC day, the ISO string MUST carry the correct date.
// ─────────────────────────────────────────────────────────────────────────────
describe('localTimeToUtcISO — cross-midnight date rollback proof', () => {

    it('✅ QA-MANDATED: 2026-03-02 00:05 LT (UTC+8) → 2026-03-01T16:05:00.000Z', () => {
        // Scenario: Pilot records chock-off at 00:05 local on March 2, UTC+8.
        // UTC+8 → UTC 16:05 on March 1. The date must roll back to 2026-03-01.
        const result = localTimeToUtcISO('2026-03-02', '0005', 480);
        expect(result).toBe('2026-03-01T16:05:00.000Z');
    });

    it('local midnight (00:00 UTC+8) → previous day 16:00 UTC', () => {
        const result = localTimeToUtcISO('2026-03-02', '0000', 480);
        expect(result).toBe('2026-03-01T16:00:00.000Z');
    });

    it('local 00:05 UTC-5 → same-day 05:05 UTC (no rollback for west zones)', () => {
        // West of UTC: subtracting a negative offset ADDS hours — date stays same.
        const result = localTimeToUtcISO('2026-03-02', '0005', -300);
        expect(result).toBe('2026-03-02T05:05:00.000Z');
    });
});
