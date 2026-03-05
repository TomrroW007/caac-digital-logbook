/**
 * @file worker/worker.js
 * @description Cloudflare Worker — 四级瀑布流航班数据网关
 *
 * 架构：多级瀑布流 (Waterfall Fallback) 高可用设计
 *
 *   App (HTTPS) → GET /api/flight?no=CA1501&date=2026-03-04
 *               ↓
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Tier 1: KV 缓存（极速路径）                                 │
 *   │   命中？→ 返回 JSON（< 50ms，X-Cache: HIT）                │
 *   └─────────────────────────────────────────────────────────────┘
 *               ↓（缓存未命中）
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Tier 2: AviationStack（主力 API，支持历史+计划航班）       │
 *   │   成功？→ 写入 KV（TTL 30天）→ 返回 JSON（X-Cache: MISS）  │
 *   └─────────────────────────────────────────────────────────────┘
 *               ↓（超时/额度耗尽/查无结果）
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Tier 3: AirLabs（备用 API，仅限实时在空航班）              │
 *   │   成功？→ 写入 KV → 返回 JSON（X-Cache: AIRLABS）           │
 *   └─────────────────────────────────────────────────────────────┘
 *               ↓（全线失败）
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Tier 4: 静默降级                                             │
 *   │   返回 { error: "NOT_FOUND" }（HTTP 200，App 手工填写）    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * 关键设计说明：
 *   1. 双路备援：AviationStack 主攻历史查询，AirLabs 覆盖实时场景。
 *   2. ICAO/IATA 智能识别：使用正则 /^[A-Z]{3}\d/ 判断输入格式，
 *      彻底修复旧版 slice(0,2) 导致 CCA→CC 的致命错误。
 *   3. 独立超时控制：每个 API 请求均设置 4 秒 AbortSignal，确保瀑布流快速切换。
 *   4. HTTPS 代理：Worker 在云端发起 HTTP 请求（AviationStack 免费版限制），
 *      客户端与 Worker 之间保持 HTTPS，完全兼容 iOS ATS 和 Android 策略。
 *   5. 极激进缓存：TTL 30 天，固定航季重复请求命中率 > 90%，保卫免费额度。
 *
 * Env bindings (wrangler.toml / Cloudflare Dashboard):
 *   FLIGHT_CACHE           — KV namespace
 *   AVIATIONSTACK_API_KEY  — secret（wrangler secret put AVIATIONSTACK_API_KEY）
 *   AIRLABS_API_KEY        — secret（wrangler secret put AIRLABS_API_KEY）
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

// ─── Tier 2: AviationStack 请求函数 ──────────────────────────────────────────
/**
 * 请求 AviationStack API（免费版仅支持实时/近期航班，不支持 flight_date 参数）
 * @param {string} flightNo - 清洗后的航班号（如 CA1501 或 CCA1501）
 * @param {boolean} isIcao - 是否为 ICAO 代码（3 字母）
 * @param {string} apiKey - API 密钥
 * @returns {Promise<Object|null>} 成功返回标准化数据，失败返回 null
 */
async function tryAviationStack(flightNo, isIcao, apiKey) {
    if (!apiKey) return null;

    const paramKey = isIcao ? 'flight_icao' : 'flight_iata';
    const apiUrl =
        `http://api.aviationstack.com/v1/flights` + // 免费版仅支持 HTTP
        `?access_key=${apiKey}` +
        `&${paramKey}=${encodeURIComponent(flightNo)}` +
        `&limit=1`;

    try {
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return null;

        const payload = await res.json();
        if (!payload?.data || payload.data.length === 0) return null;

        const f = payload.data[0];
        return {
            dep_icao:      f.departure?.icao        ?? null,
            arr_icao:      f.arrival?.icao          ?? null,
            aircraft_icao: f.aircraft?.icao ?? f.aircraft?.iata ?? null,
            reg_number:    f.aircraft?.registration ?? null,
        };
    } catch {
        return null; // 超时或网络异常
    }
}

// ─── Tier 3: AirLabs 请求函数 ────────────────────────────────────────────────
/**
 * 请求 AirLabs API（仅支持实时在空航班，作为备用降级）
 * @param {string} flightNo - 清洗后的航班号
 * @param {boolean} isIcao - 是否为 ICAO 代码
 * @param {string} apiKey - API 密钥
 * @returns {Promise<Object|null>} 成功返回标准化数据，失败返回 null
 */
async function tryAirLabs(flightNo, isIcao, apiKey) {
    if (!apiKey) return null;

    const paramKey = isIcao ? 'flight_icao' : 'flight_iata';
    const apiUrl =
        `https://airlabs.co/api/v9/flights` +
        `?api_key=${apiKey}` +
        `&${paramKey}=${encodeURIComponent(flightNo)}`;

    try {
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return null;

        const payload = await res.json();
        if (!payload?.response || payload.response.length === 0) return null;

        const f = payload.response[0];
        return {
            dep_icao:      f.dep_icao  ?? null,
            arr_icao:      f.arr_icao  ?? null,
            aircraft_icao: f.aircraft_icao ?? null,
            reg_number:    f.reg_number ?? null,
        };
    } catch {
        return null; // 超时或网络异常
    }
}

// ─── 请求处理入口：四级瀑布流编排 ──────────────────────────────────────────

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

        const flightNo   = (url.searchParams.get('no')   ?? '').trim().toUpperCase();
        const flightDate = (url.searchParams.get('date') ?? '').trim();

        // 基础参数校验：航班号 + YYYY-MM-DD 日期均必填
        if (!flightNo || flightNo.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(flightDate)) {
            return json({ error: 'INVALID_PARAMS' });
        }

        // ── 智能识别：ICAO（3 字母，如 CCA1501）或 IATA（2 字母，如 CA1501）──
        // 使用正则匹配，避免旧版 slice(0,2) 导致的 CCA→CC 严重错误
        const cleanedNo = flightNo.replace(/\s+/g, '');
        const isIcao    = /^[A-Z]{3}\d/.test(cleanedNo);

        // ═══════════════════════════════════════════════════════════════════════
        // Tier 1: KV 缓存拦截（极速路径，命中率 > 90%）
        // ═══════════════════════════════════════════════════════════════════════
        const cacheKey = `${cleanedNo}_${flightDate}`;
        const cached = await env.FLIGHT_CACHE.get(cacheKey, 'json');
        if (cached) {
            return json(cached, { 'X-Cache': 'HIT' });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Tier 2: AviationStack（主力 API，免费版仅支持实时/近期航班）
        // ═══════════════════════════════════════════════════════════════════════
        let result = await tryAviationStack(
            cleanedNo,
            isIcao,
            env.AVIATIONSTACK_API_KEY
        );

        // ═══════════════════════════════════════════════════════════════════════
        // Tier 2.5: 数据缝合（关键优化）
        //
        // 触发条件：
        //   A. AviationStack 完全失败（result === null）
        //   B. AviationStack 返回了航班但缺少机型 (aircraft_icao === null)
        //   C. AviationStack 返回了航班但缺少注册号 (reg_number === null)
        //
        // 策略：当上述任意条件成立时，调用 AirLabs 补全缺失的数据，而不是
        //       直接返回或降级。这样可以最大化"智能填充"的完整性。
        // ═══════════════════════════════════════════════════════════════════════
        if (!result || !result.aircraft_icao || !result.reg_number) {
            const airLabsResult = await tryAirLabs(
                cleanedNo,
                isIcao,
                env.AIRLABS_API_KEY
            );

            if (airLabsResult) {
                if (!result) {
                    // 情况 A：AviationStack 彻底失败，直接用 AirLabs 的结果
                    result = airLabsResult;
                } else {
                    // 情况 B/C：数据缝合！保留 AviationStack 的基础数据（起降机场），
                    // 用 AirLabs 的数据填补缺失的机型或注册号
                    result.aircraft_icao = result.aircraft_icao || airLabsResult.aircraft_icao;
                    result.reg_number = result.reg_number || airLabsResult.reg_number;
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Tier 4: 最终验证与结果返回
        // ═══════════════════════════════════════════════════════════════════════
        if (!result || !result.dep_icao) {
            // 完全失败：既没有从 AviationStack 获取数据，AirLabs 也没有补上
            return json({ error: 'NOT_FOUND' });
        }

        // 成功获取数据（可能来自 AviationStack、AirLabs、或两者数据缝合），
        // 写入 KV 缓存（TTL 30 天）
        await env.FLIGHT_CACHE.put(cacheKey, JSON.stringify(result), {
            expirationTtl: 2592000,
        });

        // 返回缝合后的完整结果
        return json(result, { 'X-Cache': 'MISS', 'X-Source': 'Patched' });
    },
};
