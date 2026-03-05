/**
 * @file worker/worker.js
 * @description Cloudflare Worker — AviationStack 代理 + KV 缓存层
 *
 * 架构：
 *   App (HTTPS) → GET /api/flight?no=CA1501&date=2026-03-04
 *               ↓
 *   KV 命中？→ 返回缓存 JSON（< 50 ms，X-Cache: HIT）
 *               ↓（未命中）
 *   AviationStack（http://，由 Worker 在云端发起）
 *               ↓ 解析 → 写入 KV（TTL 30 天）→ 返回 JSON（X-Cache: MISS）
 *               ↓（查无此航班）
 *   返回 { error: "NOT_FOUND" }（HTTP 200，软报错，App 优雅降级）
 *
 * 关键设计说明：
 *   1. HTTP 洗白：AviationStack 免费版仅支持 http://，直连会被 iOS/Android 封杀。
 *      Worker 在云端以 http:// 请求 AviationStack，App 侧始终使用 https:// 访问
 *      Worker，彻底规避 App Transport Security / Cleartext Traffic 限制。
 *   2. 历史查询：使用 flight_date 参数，支持查询已落地的历史航班，完全贴合
 *      飞行员下机后补填 Logbook 的真实场景。
 *   3. 极激进缓存：TTL 30 天（2 592 000 秒），保卫 500 次/月免费额度。
 *      国内定期航班机型/航线在一个航季内基本固定，命中率极高。
 *
 * Env bindings (wrangler.toml / Cloudflare Dashboard):
 *   FLIGHT_CACHE          — KV namespace
 *   AVIATIONSTACK_API_KEY — secret（wrangler secret put AVIATIONSTACK_API_KEY）
 */

// ─── CORS 头（允许 App 任意来源跨域请求）────────────────────────────────────

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

const json = (data, extra = {}) =>
    new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...CORS, ...extra },
    });

// ─── 请求处理入口 ────────────────────────────────────────────────────────────

export default {
    async fetch(request, env) {
        // CORS 预检
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS });
        }

        const url = new URL(request.url);

        if (url.pathname !== '/api/flight') {
            return json({ error: 'NOT_FOUND' });
        }

        const flightNo  = (url.searchParams.get('no')   ?? '').trim().toUpperCase();
        const flightDate = (url.searchParams.get('date') ?? '').trim();

        // 基础参数校验：航班号 + YYYY-MM-DD 日期均必填
        if (!flightNo || flightNo.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(flightDate)) {
            return json({ error: 'INVALID_PARAMS' });
        }

        // ── 识别用户输入：ICAO（3 字母，如 CCA1501）或 IATA（2 字母，如 CA1501）──
        //    直接使用 AviationStack 原生支持的 flight_icao / flight_iata 参数，
        //    彻底避免自行 slice 拼接导致的 CCA→CC 致命错误。
        const cleanedNo = flightNo.replace(/\s+/g, '');
        const isIcao    = /^[A-Z]{3}\d/.test(cleanedNo);
        const paramKey  = isIcao ? 'flight_icao' : 'flight_iata';

        // ── 1. KV 缓存拦截（极速路径）───────────────────────────────────────
        const cacheKey = `${cleanedNo}_${flightDate}`;
        const cached = await env.FLIGHT_CACHE.get(cacheKey, 'json');
        if (cached) {
            return json(cached, { 'X-Cache': 'HIT' });
        }

        // ── 2. 请求 AviationStack（含历史查询 flight_date 参数）─────────────
        const apiKey = env.AVIATIONSTACK_API_KEY;
        if (!apiKey) {
            return json({ error: 'API_NOT_CONFIGURED' });
        }

        const apiUrl =
            `http://api.aviationstack.com/v1/flights` +
            `?access_key=${apiKey}` +
            `&${paramKey}=${encodeURIComponent(cleanedNo)}` +
            `&flight_date=${flightDate}` +
            `&limit=1`;

        try {
            const res = await fetch(apiUrl, { signal: AbortSignal.timeout(6000) });
            if (!res.ok) {
                return json({ error: 'API_ERROR' });
            }

            const payload = await res.json();

            if (!payload?.data || payload.data.length === 0) {
                return json({ error: 'NOT_FOUND' });
            }

            const f = payload.data[0];
            const result = {
                dep_icao:     f.departure?.icao         ?? null,
                arr_icao:     f.arrival?.icao            ?? null,
                aircraft_icao: f.aircraft?.icao ?? f.aircraft?.iata ?? null,
                reg_number:   f.aircraft?.registration  ?? null,
            };

            // ── 3. 写入 KV，TTL 30 天，保卫 500 次/月免费额度 ────────────────
            await env.FLIGHT_CACHE.put(cacheKey, JSON.stringify(result), {
                expirationTtl: 2592000, // 30 天（秒）
            });

            return json(result, { 'X-Cache': 'MISS' });

        } catch {
            // 超时或网络异常 — 软报错，App 优雅降级
            return json({ error: 'API_ERROR' });
        }
    },
};
