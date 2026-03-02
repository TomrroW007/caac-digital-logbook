/**
 * @file utils/__tests__/TimeUtils.test.ts
 * @description Unit tests for the UI-facing time display formatting utilities.
 */

import {
    formatRawInputForDisplay,
    extractDigitsFromDisplay,
    maskPartialInput,
    rawInputToDisplayTime,
    displayTimeToRaw,
    formatDuration,
    formatDate,
} from '../TimeUtils';

// ─────────────────────────────────────────────────────────────────────────────
// 1. formatRawInputForDisplay — live keystroke masking
// ─────────────────────────────────────────────────────────────────────────────
describe('formatRawInputForDisplay', () => {
    it('returns "" for empty input', () => {
        expect(formatRawInputForDisplay('')).toBe('');
    });

    it('returns "0" for single digit', () => {
        expect(formatRawInputForDisplay('0')).toBe('0');
    });

    it('returns "08" for 2 digits (no colon yet)', () => {
        expect(formatRawInputForDisplay('08')).toBe('08');
    });

    it('inserts colon after 2nd digit for 3-digit input: "083" -> "08:3"', () => {
        expect(formatRawInputForDisplay('083')).toBe('08:3');
    });

    it('returns full HH:MM for 4 digits: "0830" -> "08:30"', () => {
        expect(formatRawInputForDisplay('0830')).toBe('08:30');
    });

    it('strips colons from pasted input: "08:30" -> "08:30"', () => {
        expect(formatRawInputForDisplay('08:30')).toBe('08:30');
    });

    it('truncates input beyond 4 digits: "08301" -> "08:30"', () => {
        expect(formatRawInputForDisplay('08301')).toBe('08:30');
    });

    it('strips non-digit chars from paste - "8h30m" strips to "830" (3 digits) -> "83:0" (live mask, no padding)', () => {
        // Note: "8h30m" -> digits "830" -> 3 chars -> "83:0" (live partial mask)
        // Padding to "08:30" only happens in rawInputToDisplayTime (confirmed entry), not live masking.
        expect(formatRawInputForDisplay('8h30m')).toBe('83:0');
    });

    it('"2359" -> "23:59" (max valid time)', () => {
        expect(formatRawInputForDisplay('2359')).toBe('23:59');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. extractDigitsFromDisplay — backspace helper
// ─────────────────────────────────────────────────────────────────────────────
describe('extractDigitsFromDisplay', () => {
    it('"08:30" -> "0830"', () => {
        expect(extractDigitsFromDisplay('08:30')).toBe('0830');
    });

    it('"08:3" -> "083"', () => {
        expect(extractDigitsFromDisplay('08:3')).toBe('083');
    });

    it('"08" -> "08"', () => {
        expect(extractDigitsFromDisplay('08')).toBe('08');
    });

    it('"" -> ""', () => {
        expect(extractDigitsFromDisplay('')).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. maskPartialInput
// ─────────────────────────────────────────────────────────────────────────────
describe('maskPartialInput', () => {
    it('empty -> not complete', () => {
        expect(maskPartialInput('')).toEqual({ display: '', isComplete: false });
    });

    it('3 digits -> not complete', () => {
        expect(maskPartialInput('083')).toEqual({ display: '08:3', isComplete: false });
    });

    it('4 digits -> complete', () => {
        expect(maskPartialInput('0830')).toEqual({ display: '08:30', isComplete: true });
    });

    it('2 digits -> not complete', () => {
        expect(maskPartialInput('08')).toEqual({ display: '08', isComplete: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. rawInputToDisplayTime — confirmed entry
// ─────────────────────────────────────────────────────────────────────────────
describe('rawInputToDisplayTime', () => {
    it('"0830" -> "08:30"', () => {
        expect(rawInputToDisplayTime('0830')).toBe('08:30');
    });

    it('"830" -> "08:30" (padded)', () => {
        expect(rawInputToDisplayTime('830')).toBe('08:30');
    });

    it('"2359" -> "23:59"', () => {
        expect(rawInputToDisplayTime('2359')).toBe('23:59');
    });

    it('"0" -> "00:00"', () => {
        expect(rawInputToDisplayTime('0')).toBe('00:00');
    });

    it('throws for hours > 23', () => {
        expect(() => rawInputToDisplayTime('2400')).toThrow();
    });

    it('throws for minutes > 59', () => {
        expect(() => rawInputToDisplayTime('0860')).toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. displayTimeToRaw — edit mode pre-population
// ─────────────────────────────────────────────────────────────────────────────
describe('displayTimeToRaw', () => {
    it('"08:30" -> "0830"', () => {
        expect(displayTimeToRaw('08:30')).toBe('0830');
    });

    it('"23:59" -> "2359"', () => {
        expect(displayTimeToRaw('23:59')).toBe('2359');
    });

    it('"00:00" -> "0000"', () => {
        expect(displayTimeToRaw('00:00')).toBe('0000');
    });

    it('throws for invalid format "830"', () => {
        expect(() => displayTimeToRaw('830')).toThrow();
    });

    it('round-trips: displayTimeToRaw(rawInputToDisplayTime("0830")) === "0830"', () => {
        expect(displayTimeToRaw(rawInputToDisplayTime('0830'))).toBe('0830');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. formatDuration
// ─────────────────────────────────────────────────────────────────────────────
describe('formatDuration', () => {
    it('90 -> "1:30"', () => {
        expect(formatDuration(90)).toBe('1:30');
    });

    it('0 -> "0:00"', () => {
        expect(formatDuration(0)).toBe('0:00');
    });

    it('1500 -> "25:00" (cumulative over 24h)', () => {
        expect(formatDuration(1500)).toBe('25:00');
    });

    it('throws for negative', () => {
        expect(() => formatDuration(-1)).toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. formatDate
// ─────────────────────────────────────────────────────────────────────────────
describe('formatDate', () => {
    it('"2024-03-01" passes through unchanged', () => {
        expect(formatDate('2024-03-01')).toBe('2024-03-01');
    });

    it('throws for non-ISO format "01/03/2024"', () => {
        expect(() => formatDate('01/03/2024')).toThrow();
    });
});
