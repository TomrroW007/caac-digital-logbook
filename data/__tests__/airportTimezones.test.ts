/**
 * @file data/__tests__/airportTimezones.test.ts
 * @description Unit tests for the offline ICAO timezone dictionary.
 *
 * Coverage:
 *  - lookupAirportOffset: known airports, unknown fallback, case-insensitive
 *  - isDstObservingRegion: ICAO-prefix exclusion logic (PRD V1.1 §2.3)
 *    Mandated test matrix from QA: Japan/Korea (R-prefix) = false, USA (K) = true.
 */

import {
    lookupAirportOffset,
    isDstObservingRegion,
} from '../airportTimezones';

// ─────────────────────────────────────────────────────────────────────────────
// 1. lookupAirportOffset
// ─────────────────────────────────────────────────────────────────────────────
describe('lookupAirportOffset', () => {

    describe('known Chinese mainland airports (UTC+8 = 480)', () => {
        it('ZBAA (Beijing Capital) → 480', () => {
            expect(lookupAirportOffset('ZBAA')).toBe(480);
        });

        it('ZSSS (Shanghai Hongqiao) → 480', () => {
            expect(lookupAirportOffset('ZSSS')).toBe(480);
        });

        it('ZGGG (Guangzhou Baiyun) → 480', () => {
            expect(lookupAirportOffset('ZGGG')).toBe(480);
        });
    });

    describe('known international airports', () => {
        it('RJTT (Tokyo Haneda) → 540 (UTC+9)', () => {
            expect(lookupAirportOffset('RJTT')).toBe(540);
        });

        it('KJFK (New York JFK) → -300 (UTC-5 EST)', () => {
            expect(lookupAirportOffset('KJFK')).toBe(-300);
        });

        it('KLAX (Los Angeles) → -480 (UTC-8 PST)', () => {
            expect(lookupAirportOffset('KLAX')).toBe(-480);
        });

        it('EGLL (London Heathrow) → 0 (UTC+0 GMT)', () => {
            expect(lookupAirportOffset('EGLL')).toBe(0);
        });

        it('OMDB (Dubai) → 240 (UTC+4)', () => {
            expect(lookupAirportOffset('OMDB')).toBe(240);
        });

        it('VIDP (Delhi) → 330 (UTC+5:30)', () => {
            expect(lookupAirportOffset('VIDP')).toBe(330);
        });

        it('VNKT (Kathmandu) → 345 (UTC+5:45)', () => {
            expect(lookupAirportOffset('VNKT')).toBe(345);
        });
    });

    describe('case insensitivity', () => {
        it('lowercase "zbaa" returns same as "ZBAA"', () => {
            expect(lookupAirportOffset('zbaa')).toBe(480);
        });

        it('mixed-case "ZbAa" returns same as "ZBAA"', () => {
            expect(lookupAirportOffset('ZbAa')).toBe(480);
        });
    });

    describe('unknown airports (fallback)', () => {
        it('unknown ICAO returns default fallback of 480 (Beijing)', () => {
            expect(lookupAirportOffset('ZZZZ')).toBe(480);
        });

        it('unknown ICAO returns custom fallback when provided', () => {
            expect(lookupAirportOffset('ZZZZ', -300)).toBe(-300);
        });

        it('wrong-length code returns fallback', () => {
            expect(lookupAirportOffset('ZBA')).toBe(480);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. isDstObservingRegion — PRD V1.1 §2.3 DST override prompt logic
//
//    Uses exclusion approach: Z/V/R/W/O prefixes → false (no prompt).
//    All other prefixes → true (show DST override prompt).
// ─────────────────────────────────────────────────────────────────────────────
describe('isDstObservingRegion', () => {

    describe('🚫 Non-DST regions (Z/V/R/W/O) — should return FALSE', () => {
        it('ZBAA (Z-prefix, China Mainland) → false', () => {
            expect(isDstObservingRegion('ZBAA')).toBe(false);
        });

        it('ZSSS (Z-prefix, Shanghai) → false', () => {
            expect(isDstObservingRegion('ZSSS')).toBe(false);
        });

        it('VHHH (V-prefix, Hong Kong) → false', () => {
            expect(isDstObservingRegion('VHHH')).toBe(false);
        });

        it('VTBS (V-prefix, Bangkok) → false', () => {
            expect(isDstObservingRegion('VTBS')).toBe(false);
        });

        it('✅ QA-MANDATED: RJTT (R-prefix, Tokyo) → false — West Pacific, no DST', () => {
            // Critical: R-prefix (Japan, Korea, Taiwan) does NOT observe DST.
            // Wrongly returning true here would flood Japan/Korea crews with unwanted prompts.
            expect(isDstObservingRegion('RJTT')).toBe(false);
        });

        it('RKSI (R-prefix, Seoul Incheon) → false', () => {
            expect(isDstObservingRegion('RKSI')).toBe(false);
        });

        it('RCTP (R-prefix, Taiwan Taoyuan) → false', () => {
            expect(isDstObservingRegion('RCTP')).toBe(false);
        });

        it('WSSS (W-prefix, Singapore Changi) → false', () => {
            expect(isDstObservingRegion('WSSS')).toBe(false);
        });

        it('WMKK (W-prefix, Kuala Lumpur) → false', () => {
            expect(isDstObservingRegion('WMKK')).toBe(false);
        });

        it('OMDB (O-prefix, Dubai) → false', () => {
            expect(isDstObservingRegion('OMDB')).toBe(false);
        });

        it('OTHH (O-prefix, Doha Hamad) → false', () => {
            expect(isDstObservingRegion('OTHH')).toBe(false);
        });
    });

    describe('⚠️ DST-observing regions — should return TRUE (show override prompt)', () => {
        it('✅ QA-MANDATED: KJFK (K-prefix, New York JFK) → true — USA observes EDT in summer', () => {
            expect(isDstObservingRegion('KJFK')).toBe(true);
        });

        it('KLAX (K-prefix, Los Angeles) → true', () => {
            expect(isDstObservingRegion('KLAX')).toBe(true);
        });

        it('CYVR (C-prefix, Vancouver) → true — Canada observes PDT in summer', () => {
            expect(isDstObservingRegion('CYVR')).toBe(true);
        });

        it('EGLL (E-prefix, London Heathrow) → true — observes BST (UTC+1) in summer', () => {
            expect(isDstObservingRegion('EGLL')).toBe(true);
        });

        it('EDDF (E-prefix, Frankfurt) → true — observes CEST (UTC+2) in summer', () => {
            expect(isDstObservingRegion('EDDF')).toBe(true);
        });

        it('LFPG (L-prefix, Paris CDG) → true — observes CEST', () => {
            expect(isDstObservingRegion('LFPG')).toBe(true);
        });

        it('LLBG (L-prefix, Tel Aviv) → true — Israel (LL) observes IST/IDT', () => {
            // L-prefix covers Southern Europe & Mediterranean including Israel.
            expect(isDstObservingRegion('LLBG')).toBe(true);
        });

        it('YSSY (Y-prefix, Sydney) → true — Australia observes AEDT in summer', () => {
            expect(isDstObservingRegion('YSSY')).toBe(true);
        });

        it('NZAA (N-prefix, Auckland) → true — New Zealand observes NZDT', () => {
            expect(isDstObservingRegion('NZAA')).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('lowercase icao is case-insensitive (kjfk → true)', () => {
            expect(isDstObservingRegion('kjfk')).toBe(true);
        });

        it('lowercase icao non-DST (zbaa → false)', () => {
            expect(isDstObservingRegion('zbaa')).toBe(false);
        });

        it('empty string → false (no region inferred)', () => {
            expect(isDstObservingRegion('')).toBe(false);
        });
    });
});
