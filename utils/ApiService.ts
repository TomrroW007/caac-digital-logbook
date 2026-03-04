/**
 * @file utils/ApiService.ts
 * @description Flight data fetch service with 3-second timeout and graceful degradation.
 *
 * Architecture:
 *   App → fetchFlightInfo(flightNo, date)
 *       → GET worker_url/api/flight?no={cleaned}&date={date}
 *       → 3s AbortController timeout
 *       → returns FlightInfo | null
 *
 * Returns null for ANY failure (timeout, network, bad data, NOT_FOUND).
 * Caller must NEVER show error dialogs — null means "silently give up".
 *
 * SME Red Line: Only returns DEP/ARR/ACFT/REG.
 * Time fields (OFF/TO/LDG/ON) are NEVER included.
 */

import Constants from 'expo-constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FlightInfo {
    depIcao: string;
    arrIcao: string;
    acftType: string;
    regNo: string;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const WORKER_URL: string =
    Constants.expoConfig?.extra?.workerUrl ?? '';

const FETCH_TIMEOUT_MS = 3000;

// ─── Flight number cleaning ─────────────────────────────────────────────────

/**
 * Normalise a pilot-entered flight number for API lookup.
 *
 * Rules:
 *  1. Strip all whitespace              "CA 1501"  → "CA1501"
 *  2. Force uppercase                   "ca1501"   → "CA1501"
 *  3. (ICAO 3-letter prefix handled by Worker — no client transform needed)
 */
export function cleanFlightNo(raw: string): string {
    return raw.replace(/\s+/g, '').toUpperCase();
}

// ─── Core fetch ──────────────────────────────────────────────────────────────

/**
 * Fetch flight info from the Cloudflare Worker proxy.
 *
 * @param flightNo - Raw pilot input (e.g. "CA1501", "CCA1501", "CA 1501")
 * @param date     - YYYY-MM-DD date string
 * @returns FlightInfo if found, null otherwise (timeout/network/not-found)
 *
 * Guarantees:
 *  - Resolves within 3 seconds (AbortController)
 *  - Never throws — always returns FlightInfo | null
 *  - Accepts an optional AbortSignal for component-unmount cleanup
 */
export async function fetchFlightInfo(
    flightNo: string,
    date: string,
    externalSignal?: AbortSignal,
): Promise<FlightInfo | null> {
    if (!WORKER_URL) return null;

    const cleaned = cleanFlightNo(flightNo);
    if (cleaned.length < 3) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    // If an external signal is provided (e.g. for unmount cleanup), listen to it
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort);

    try {
        const url = `${WORKER_URL}/api/flight?no=${encodeURIComponent(cleaned)}&date=${encodeURIComponent(date)}`;
        const res = await fetch(url, { signal: controller.signal });

        clearTimeout(timeoutId);

        if (!res.ok) return null;

        const data = await res.json();

        // Soft error from Worker
        if (data.error) return null;

        // Map Worker response fields to app-side camelCase
        return {
            depIcao: data.dep_icao ?? '',
            arrIcao: data.arr_icao ?? '',
            acftType: data.aircraft_icao ?? '',
            regNo: data.reg_number ?? '',
        };
    } catch {
        // AbortError (timeout), TypeError (network), or any other — silent null
        return null;
    } finally {
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener('abort', onExternalAbort);
    }
}
