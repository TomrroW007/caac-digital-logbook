/**
 * @file worker/worker.js
 * @description Cloudflare Worker — Flight data proxy with KV cache.
 *
 * Architecture:
 *   Client → GET /api/flight?no=CA1501&date=2026-03-04
 *            ↓
 *   KV hit? → return cached JSON (<50 ms)
 *            ↓ (miss)
 *   AirLabs v9 → parse → store KV (TTL 7d) → return JSON
 *            ↓ (fail)
 *   AviationStack → same flow
 *            ↓ (fail)
 *   return { error: "NOT_FOUND" }  (HTTP 200, soft error)
 *
 * Env bindings (wrangler.toml):
 *   FLIGHT_CACHE  — KV namespace
 *   AIRLABS_KEY   — secret
 *   AVIATIONSTACK_KEY — secret (optional fallback)
 */

// ─── CORS headers (allow any origin for the mobile app) ──────────────────────

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });

// ─── Upstream API adapters ───────────────────────────────────────────────────

/**
 * AirLabs v9 — Real-Time Flights endpoint.
 * Free tier: 1 000 req/month.
 * Returns array; we take the first match.
 */
async function tryAirLabs(flightIata, apiKey) {
    const url =
        `https://airlabs.co/api/v9/flights?flight_iata=${flightIata}&api_key=${apiKey}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;

    const { response } = await res.json();
    if (!Array.isArray(response) || response.length === 0) return null;

    const f = response[0];
    return {
        dep_icao: f.dep_icao ?? null,
        arr_icao: f.arr_icao ?? null,
        aircraft_icao: f.aircraft_icao ?? null,
        reg_number: f.reg_number ?? null,
    };
}

/**
 * AviationStack — Flights endpoint (fallback).
 * Free tier: 500 req/month (HTTP only on free plan).
 */
async function tryAviationStack(flightIata, apiKey) {
    if (!apiKey) return null;

    const url =
        `http://api.aviationstack.com/v1/flights?access_key=${apiKey}&flight_iata=${flightIata}&limit=1`;

    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;

    const { data } = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const f = data[0];
    return {
        dep_icao: f.departure?.icao ?? null,
        arr_icao: f.arrival?.icao ?? null,
        aircraft_icao: f.aircraft?.icao ?? null,
        reg_number: f.aircraft?.registration ?? null,
    };
}

// ─── Request handler ─────────────────────────────────────────────────────────

export default {
    async fetch(request, env) {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS });
        }

        const url = new URL(request.url);

        // Only handle /api/flight
        if (url.pathname !== '/api/flight') {
            return json({ error: 'NOT_FOUND' }, 200);
        }

        const flightNo = (url.searchParams.get('no') ?? '').trim().toUpperCase();
        const date = url.searchParams.get('date') ?? '';

        if (!flightNo || flightNo.length < 3) {
            return json({ error: 'INVALID_PARAMS' }, 200);
        }

        // ── Normalise: strip spaces, convert 3-letter ICAO prefix to IATA ────
        //    e.g. "CCA1501" → "CA1501" (ICAO airline designator → IATA)
        //    Simple heuristic: if starts with 3 alpha chars, try first 2.
        let flightIata = flightNo.replace(/\s+/g, '');
        if (/^[A-Z]{3}\d/.test(flightIata)) {
            // 3-letter ICAO airline code prefix — try 2-letter IATA instead
            flightIata = flightIata.slice(0, 2) + flightIata.slice(3);
        }

        // ── 1. Check KV cache ────────────────────────────────────────────────
        const cacheKey = `${flightIata}_${date}`;
        const cached = await env.FLIGHT_CACHE.get(cacheKey, 'json');
        if (cached) {
            return json(cached);
        }

        // ── 2. Waterfall: AirLabs → AviationStack ────────────────────────────
        let result = null;

        try {
            result = await tryAirLabs(flightIata, env.AIRLABS_KEY);
        } catch { /* timeout or network — fall through */ }

        if (!result) {
            try {
                result = await tryAviationStack(flightIata, env.AVIATIONSTACK_KEY);
            } catch { /* fall through */ }
        }

        if (!result) {
            return json({ error: 'NOT_FOUND' });
        }

        // ── 3. Write to KV with 7-day TTL ────────────────────────────────────
        await env.FLIGHT_CACHE.put(cacheKey, JSON.stringify(result), {
            expirationTtl: 604800, // 7 days in seconds
        });

        return json(result);
    },
};
