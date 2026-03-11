/**
 * @file utils/__tests__/FlightMath.test.ts
 * @description Unit tests for the four-point time-axis orchestration engine.
 */

import {
    resolveFourTimePoints,
    validateTimeOrder,
    calcFlightTimeMin,
    type FourTimePoints,
} from '../FlightMath';

// Helpers
const OFF = '2024-03-01T08:00:00Z';
const TO = '2024-03-01T08:10:00Z';
const LDG = '2024-03-01T10:30:00Z';
const ON = '2024-03-01T10:45:00Z';

// ─────────────────────────────────────────────────────────────────────────────
// 1. resolveFourTimePoints
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveFourTimePoints', () => {

    describe('all four points given (no inference)', () => {
        it('calculates correct blockTimeMin', () => {
            const result = resolveFourTimePoints({ offUtcISO: OFF, toUtcISO: TO, ldgUtcISO: LDG, onUtcISO: ON });
            // ON - OFF = 10:45 - 08:00 = 165 min
            expect(result.blockTimeMin).toBe(165);
        });

        it('calculates correct flightTimeMin', () => {
            const result = resolveFourTimePoints({ offUtcISO: OFF, toUtcISO: TO, ldgUtcISO: LDG, onUtcISO: ON });
            // LDG - TO = 10:30 - 08:10 = 140 min
            expect(result.flightTimeMin).toBe(140);
        });

        it('wasInferred is false when all four provided', () => {
            const result = resolveFourTimePoints({ offUtcISO: OFF, toUtcISO: TO, ldgUtcISO: LDG, onUtcISO: ON });
            expect(result.wasInferred).toBe(false);
        });

        it('passes through OFF and ON unchanged', () => {
            const result = resolveFourTimePoints({ offUtcISO: OFF, toUtcISO: TO, ldgUtcISO: LDG, onUtcISO: ON });
            expect(result.offUtcISO).toBe(OFF);
            expect(result.onUtcISO).toBe(ON);
        });
    });

    describe('TO + LDG only → inference triggered', () => {
        const minimalInput: FourTimePoints = {
            offUtcISO: null,
            toUtcISO: TO,
            ldgUtcISO: LDG,
            onUtcISO: null,
        };

        it('infers OFF = TO - 10 minutes', () => {
            const result = resolveFourTimePoints(minimalInput);
            // TO = 08:10, OFF should be 08:00
            expect(result.offUtcISO).toBe('2024-03-01T08:00:00.000Z');
        });

        it('infers ON = LDG + 5 minutes', () => {
            const result = resolveFourTimePoints(minimalInput);
            // LDG = 10:30, ON should be 10:35
            expect(result.onUtcISO).toBe('2024-03-01T10:35:00.000Z');
        });

        it('wasInferred is true', () => {
            const result = resolveFourTimePoints(minimalInput);
            expect(result.wasInferred).toBe(true);
        });

        it('blockTimeMin = inferred ON - inferred OFF = 155 min', () => {
            // OFF = 08:00, ON = 10:35 → 155 min
            const result = resolveFourTimePoints(minimalInput);
            expect(result.blockTimeMin).toBe(155);
        });
    });

    describe('partial inference: OFF given, ON missing', () => {
        it('infers only ON, keeps given OFF, wasInferred=true', () => {
            const result = resolveFourTimePoints({
                offUtcISO: OFF,
                toUtcISO: TO,
                ldgUtcISO: LDG,
                onUtcISO: null,
            });
            expect(result.offUtcISO).toBe(OFF);
            expect(result.onUtcISO).toBe('2024-03-01T10:35:00.000Z');
            expect(result.wasInferred).toBe(true);
        });
    });

    describe('SIM mode (no TO/LDG)', () => {
        it('works with only OFF and ON (SIM from/to)', () => {
            const result = resolveFourTimePoints({
                offUtcISO: OFF,
                toUtcISO: null,
                ldgUtcISO: null,
                onUtcISO: ON,
            });
            expect(result.blockTimeMin).toBe(165);
            expect(result.flightTimeMin).toBeNull();
            expect(result.wasInferred).toBe(false);
        });
    });

    describe('cross-midnight flight', () => {
        it('23:00 OFF → 01:30 ON next day = 150 min block', () => {
            const result = resolveFourTimePoints({
                offUtcISO: '2024-03-01T23:00:00Z',
                toUtcISO: null,
                ldgUtcISO: null,
                onUtcISO: '2024-03-02T01:30:00Z',
            });
            expect(result.blockTimeMin).toBe(150);
        });
    });

    describe('error cases', () => {
        it('throws when OFF is null and TO/LDG also null', () => {
            expect(() => resolveFourTimePoints({
                offUtcISO: null, toUtcISO: null, ldgUtcISO: null, onUtcISO: ON,
            })).toThrow();
        });

        it('throws when ON is null and TO/LDG also null', () => {
            expect(() => resolveFourTimePoints({
                offUtcISO: OFF, toUtcISO: null, ldgUtcISO: null, onUtcISO: null,
            })).toThrow();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. validateTimeOrder
// ─────────────────────────────────────────────────────────────────────────────
describe('validateTimeOrder', () => {
    it('returns valid=true for correct order (all four given)', () => {
        const result = validateTimeOrder({ offUtcISO: OFF, toUtcISO: TO, ldgUtcISO: LDG, onUtcISO: ON });
        expect(result.valid).toBe(true);
    });

    it('returns valid=true with nulls (skips null points)', () => {
        const result = validateTimeOrder({ offUtcISO: OFF, toUtcISO: null, ldgUtcISO: null, onUtcISO: ON });
        expect(result.valid).toBe(true);
    });

    it('returns valid=false when TO is before OFF', () => {
        const result = validateTimeOrder({
            offUtcISO: '2024-03-01T08:10:00Z', // OFF later than TO
            toUtcISO: '2024-03-01T08:00:00Z', // TO earlier
            ldgUtcISO: LDG,
            onUtcISO: ON,
        });
        expect(result.valid).toBe(false);
        expect(result.errorField).toBe('to_time_utc');
    });

    it('returns valid=false when LDG is before TO', () => {
        const result = validateTimeOrder({
            offUtcISO: OFF,
            toUtcISO: '2024-03-01T10:35:00Z', // TO after LDG
            ldgUtcISO: '2024-03-01T10:30:00Z', // LDG before TO
            onUtcISO: ON,
        });
        expect(result.valid).toBe(false);
        expect(result.errorField).toBe('ldg_time_utc');
    });

    it('returns valid=false when ON is before LDG', () => {
        const result = validateTimeOrder({
            offUtcISO: OFF,
            toUtcISO: TO,
            ldgUtcISO: '2024-03-01T10:50:00Z',  // LDG after ON
            onUtcISO: '2024-03-01T10:45:00Z',  // ON before LDG
        });
        expect(result.valid).toBe(false);
        expect(result.errorField).toBe('on_time_utc');
    });

    it('is valid for cross-midnight ON (23:00 OFF, 01:30 ON)', () => {
        const result = validateTimeOrder({
            offUtcISO: '2024-03-01T23:00:00Z',
            toUtcISO: null,
            ldgUtcISO: null,
            onUtcISO: '2024-03-02T01:30:00Z',
        });
        expect(result.valid).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. calcFlightTimeMin
// ─────────────────────────────────────────────────────────────────────────────
describe('calcFlightTimeMin', () => {
    it('08:10 → 10:30 = 140 min air time', () => {
        expect(calcFlightTimeMin(TO, LDG)).toBe(140);
    });

    it('returns null when TO is null', () => {
        expect(calcFlightTimeMin(null, LDG)).toBeNull();
    });

    it('returns null when LDG is null', () => {
        expect(calcFlightTimeMin(TO, null)).toBeNull();
    });

    it('handles cross-midnight air time correctly', () => {
        // Takeoff 23:50Z, landing 01:05Z next day = 75 min
        expect(calcFlightTimeMin(
            '2024-03-01T23:50:00Z',
            '2024-03-02T01:05:00Z'
        )).toBe(75);
    });
});
