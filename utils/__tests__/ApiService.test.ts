/**
 * @file utils/__tests__/ApiService.test.ts
 * @description Unit tests for the flight data fetch service.
 *
 * Tests cover:
 *  - Successful fetch → FlightInfo returned
 *  - 3-second timeout → null
 *  - Network error → null
 *  - HTTP non-200 → null
 *  - Worker soft error ({"error":"NOT_FOUND"}) → null
 *  - cleanFlightNo normalisation
 *  - Short/empty flight number → null (no fetch)
 *  - External AbortSignal support
 */

import { cleanFlightNo, fetchFlightInfo } from '../ApiService';

// ─── Mock expo-constants ─────────────────────────────────────────────────────

jest.mock('expo-constants', () => ({
    __esModule: true,
    default: {
        expoConfig: {
            extra: {
                workerUrl: 'https://test-worker.example.com',
            },
        },
    },
}));

// ─── Mock global fetch ───────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
    mockFetch.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// cleanFlightNo
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanFlightNo', () => {
    it('strips whitespace and uppercases', () => {
        expect(cleanFlightNo('ca 1501')).toBe('CA1501');
    });

    it('handles multiple spaces', () => {
        expect(cleanFlightNo(' ca  1501 ')).toBe('CA1501');
    });

    it('already clean input passes through', () => {
        expect(cleanFlightNo('CA1501')).toBe('CA1501');
    });

    it('handles empty string', () => {
        expect(cleanFlightNo('')).toBe('');
    });

    it('handles ICAO 3-letter prefix', () => {
        // Cleaning only strips spaces & uppercases; ICAO→IATA done by Worker
        expect(cleanFlightNo('cca1501')).toBe('CCA1501');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchFlightInfo
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchFlightInfo', () => {

    it('returns FlightInfo on successful response', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                dep_icao: 'ZBAA',
                arr_icao: 'ZSSS',
                aircraft_icao: 'A320',
                reg_number: 'B-6120',
            }),
        });

        const result = await fetchFlightInfo('CA1501', '2026-03-04');
        expect(result).toEqual({
            depIcao: 'ZBAA',
            arrIcao: 'ZSSS',
            acftType: 'A320',
            regNo: 'B-6120',
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch.mock.calls[0][0]).toContain('no=CA1501');
        expect(mockFetch.mock.calls[0][0]).toContain('date=2026-03-04');
    });

    it('returns null on Worker soft error (NOT_FOUND)', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ error: 'NOT_FOUND' }),
        });

        expect(await fetchFlightInfo('CA9999', '2026-03-04')).toBeNull();
    });

    it('returns null on HTTP non-200', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 500 });
        expect(await fetchFlightInfo('CA1501', '2026-03-04')).toBeNull();
    });

    it('returns null on network error', async () => {
        mockFetch.mockRejectedValue(new TypeError('Network request failed'));
        expect(await fetchFlightInfo('CA1501', '2026-03-04')).toBeNull();
    });

    it('returns null on fetch abort (timeout simulation)', async () => {
        mockFetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
        expect(await fetchFlightInfo('CA1501', '2026-03-04')).toBeNull();
    });

    it('returns null when flight number is too short', async () => {
        const result = await fetchFlightInfo('CA', '2026-03-04');
        expect(result).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when flight number is empty', async () => {
        expect(await fetchFlightInfo('', '2026-03-04')).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('cleans flight number before fetching', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                dep_icao: 'ZBAA',
                arr_icao: 'ZSSS',
                aircraft_icao: 'A320',
                reg_number: 'B-6120',
            }),
        });

        await fetchFlightInfo('ca 1501', '2026-03-04');
        expect(mockFetch.mock.calls[0][0]).toContain('no=CA1501');
    });

    it('handles null fields from Worker gracefully', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                dep_icao: 'ZBAA',
                arr_icao: null,
                aircraft_icao: null,
                reg_number: null,
            }),
        });

        const result = await fetchFlightInfo('CA1501', '2026-03-04');
        expect(result).toEqual({
            depIcao: 'ZBAA',
            arrIcao: '',
            acftType: '',
            regNo: '',
        });
    });

    it('respects external AbortSignal', async () => {
        const externalController = new AbortController();
        // Abort before fetch starts
        externalController.abort();

        mockFetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

        const result = await fetchFlightInfo('CA1501', '2026-03-04', externalController.signal);
        expect(result).toBeNull();
    });
});
