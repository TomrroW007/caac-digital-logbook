/**
 * @file utils/FlightMath.ts
 * @description Four-point time-axis orchestration engine for the CAAC Digital Logbook.
 *
 * Consumes primitives from TimeCalculator.ts and adds domain-level logic:
 *  1. Resolving any combination of the four time points (OFF/TO/LDG/ON) into a
 *     complete, validated set using the PRD-specified 10-5 inference rule.
 *  2. Time-order validation (OFF ≤ TO ≤ LDG ≤ ON) with cross-midnight awareness.
 *  3. Air time (wheels-up to wheels-down) calculation, separate from block time.
 *
 * PRD §3.2: "若填入了 TO 和 LDG 且 OFF/ON 为空，系统静默推算：
 *            OFF = TO - 10分钟，ON = LDG + 5分钟"
 */

import { calcBlockMinutes, inferOffOn } from './TimeCalculator';

// ─── Shared Types ──────────────────────────────────────────────────────────────

/**
 * The four time points of a FLIGHT leg (all UTC ISO-8601 strings or null).
 * In SIMULATOR mode, only offTimeUtc and onTimeUtc are used (as "From" / "To").
 */
export type FourTimePoints = {
    offUtcISO: string | null;   // Chock-off  (required if not inferrable)
    toUtcISO: string | null;   // Takeoff    (optional; enables inference)
    ldgUtcISO: string | null;   // Landing    (optional; enables inference)
    onUtcISO: string | null;   // Chock-on   (required if not inferrable)
};

/**
 * Result of resolving a FourTimePoints input into a complete, validated set.
 */
export type ResolvedTimePoints = {
    offUtcISO: string;        // Resolved chock-off (given or inferred)
    toUtcISO: string | null; // Takeoff (null in SIM mode or if not entered)
    ldgUtcISO: string | null; // Landing (null in SIM mode or if not entered)
    onUtcISO: string;        // Resolved chock-on (given or inferred)
    blockTimeMin: number;        // Integer minutes: ON - OFF (cross-midnight safe)
    flightTimeMin: number | null;// Air time: LDG - TO (null if TO/LDG absent)
    wasInferred: boolean;       // true if OFF or ON was auto-calculated
};

/** Result of a time-order validation check. */
export type TimeOrderResult = {
    valid: boolean;
    errorField?: 'to_time_utc' | 'ldg_time_utc' | 'on_time_utc';
    errorMessage?: string;
};

// ─── 1. Four-Point Resolver ───────────────────────────────────────────────────

/**
 * Main orchestrator for the four-point time axis.
 *
 * Resolution rules (in priority order):
 *  1. If ALL FOUR points are provided → use as-is, no inference.
 *  2. If TO + LDG are provided AND (OFF is null OR ON is null):
 *       - missing OFF = TO - 10 minutes
 *       - missing ON  = LDG + 5 minutes
 *  3. If the above cannot produce both OFF and ON → throws an error.
 *     (Caller must ensure minimum required fields are present.)
 *
 * After resolving OFF + ON:
 *  - Calculates blockTimeMin (cross-midnight safe).
 *  - Calculates flightTimeMin from TO + LDG if both are present.
 *
 * @throws Error if OFF and ON cannot be determined (insufficient input).
 *
 * @example
 * // Full entry — no inference
 * resolveFourTimePoints({
 *   offUtcISO: '2024-03-01T08:00:00Z',
 *   toUtcISO:  '2024-03-01T08:10:00Z',
 *   ldgUtcISO: '2024-03-01T10:30:00Z',
 *   onUtcISO:  '2024-03-01T10:45:00Z',
 * })
 * // → { blockTimeMin: 165, flightTimeMin: 140, wasInferred: false, ... }
 *
 * // Minimal entry (TO + LDG only) — inference triggered
 * resolveFourTimePoints({
 *   offUtcISO: null,
 *   toUtcISO:  '2024-03-01T08:10:00Z',
 *   ldgUtcISO: '2024-03-01T10:30:00Z',
 *   onUtcISO:  null,
 * })
 * // → { offUtcISO: '...08:00Z', onUtcISO: '...10:35Z', blockTimeMin: 155,
 * //     flightTimeMin: 140, wasInferred: true }
 */
export function resolveFourTimePoints(pts: FourTimePoints): ResolvedTimePoints {
    let offUtcISO = pts.offUtcISO;
    let onUtcISO = pts.onUtcISO;
    let wasInferred = false;

    // Attempt inference if OFF or ON is missing and TO + LDG are both available
    if ((offUtcISO === null || onUtcISO === null) &&
        pts.toUtcISO !== null && pts.ldgUtcISO !== null) {
        const inferred = inferOffOn(pts.toUtcISO, pts.ldgUtcISO);
        if (offUtcISO === null) {
            offUtcISO = inferred.offUtcISO;
            wasInferred = true;
        }
        if (onUtcISO === null) {
            onUtcISO = inferred.onUtcISO;
            wasInferred = true;
        }
    }

    // After inference attempt, OFF and ON must both be resolved
    if (offUtcISO === null) {
        throw new Error(
            'resolveFourTimePoints: cannot determine OFF time. ' +
            'Either provide off_time_utc directly, or provide both to_time_utc and ldg_time_utc for inference.'
        );
    }
    if (onUtcISO === null) {
        throw new Error(
            'resolveFourTimePoints: cannot determine ON time. ' +
            'Either provide on_time_utc directly, or provide both to_time_utc and ldg_time_utc for inference.'
        );
    }

    const blockTimeMin = calcBlockMinutes(offUtcISO, onUtcISO);

    // Air time: only if both TO and LDG are known
    let flightTimeMin: number | null = null;
    if (pts.toUtcISO !== null && pts.ldgUtcISO !== null) {
        flightTimeMin = calcBlockMinutes(pts.toUtcISO, pts.ldgUtcISO);
    }

    return {
        offUtcISO,
        toUtcISO: pts.toUtcISO,
        ldgUtcISO: pts.ldgUtcISO,
        onUtcISO,
        blockTimeMin,
        flightTimeMin,
        wasInferred,
    };
}

// ─── 2. Time-Order Validator ──────────────────────────────────────────────────

/**
 * Validates that the four time points are in the correct chronological order:
 *   OFF ≤ TO ≤ LDG ≤ ON
 *
 * Cross-midnight logic: a flight may cross midnight (e.g. 23:00 OFF → 01:30 ON).
 * The validator allows ON to appear "earlier" than OFF in CLOCK time only when
 * the difference suggests a natural overnight flight (ON < OFF by ≤ 720 minutes,
 * i.e. up to 12 hours of "apparent backward" time).
 *
 * For the intermediate points (TO, LDG): they must fall between OFF and ON in UTC
 * epoch ms.
 *
 * Null time points are skipped — only non-null points are validated.
 *
 * @returns TimeOrderResult with valid=true, or valid=false with the first
 *          offending field and a user-readable error message.
 *
 * @example
 * // Valid normal-day flight
 * validateTimeOrder({
 *   offUtcISO: '2024-03-01T08:00:00Z',
 *   toUtcISO:  '2024-03-01T08:10:00Z',
 *   ldgUtcISO: '2024-03-01T10:30:00Z',
 *   onUtcISO:  '2024-03-01T10:45:00Z',
 * })
 * // → { valid: true }
 *
 * // Invalid: TO is after LDG
 * validateTimeOrder({
 *   offUtcISO: '2024-03-01T08:00:00Z',
 *   toUtcISO:  '2024-03-01T10:35:00Z',
 *   ldgUtcISO: '2024-03-01T10:30:00Z',  // ← before TO
 *   onUtcISO:  '2024-03-01T10:45:00Z',
 * })
 * // → { valid: false, errorField: 'ldg_time_utc', errorMessage: '...' }
 */
export function validateTimeOrder(pts: FourTimePoints): TimeOrderResult {
    const offMs = pts.offUtcISO ? Date.parse(pts.offUtcISO) : null;
    const toMs = pts.toUtcISO ? Date.parse(pts.toUtcISO) : null;
    const ldgMs = pts.ldgUtcISO ? Date.parse(pts.ldgUtcISO) : null;
    const onMs = pts.onUtcISO ? Date.parse(pts.onUtcISO) : null;

    // Design note on cross-midnight:
    // The OFF→ON span CAN cross midnight (e.g., 23:00 OFF → 01:30 next-day ON).
    // calcBlockMinutes handles this by adding 24h when ON < OFF in epoch ms.
    //
    // However, the ADJACENT ordering constraints (TO ≥ OFF, LDG ≥ TO, ON ≥ LDG)
    // use FULL UTC ISO strings with proper next-day dates when crossing midnight,
    // so raw epoch ms comparison is correct here.
    // We do NOT apply cross-midnight wrapping to adjacent-point checks — if a pilot
    // truly has a cross-midnight flight, they must enter the correct next-day date
    // in the ISO timestamps, ensuring epoch ms is monotonically increasing.

    // TO must be >= OFF in raw epoch ms
    if (offMs !== null && toMs !== null) {
        if (toMs < offMs) {
            return {
                valid: false,
                errorField: 'to_time_utc',
                errorMessage: '起飞时刻 (TO) 不能早于撤轮挡时刻 (OFF)。',
            };
        }
    }

    // LDG must be >= TO (if TO is present), or >= OFF
    if (ldgMs !== null) {
        const referenceMs = toMs ?? offMs;
        if (referenceMs !== null && ldgMs < referenceMs) {
            return {
                valid: false,
                errorField: 'ldg_time_utc',
                errorMessage: '落地时刻 (LDG) 不能早于起飞时刻 (TO)。',
            };
        }
    }

    // ON must be >= LDG (if LDG present) or >= OFF
    if (onMs !== null) {
        const referenceMs = ldgMs ?? offMs;
        if (referenceMs !== null && onMs < referenceMs) {
            return {
                valid: false,
                errorField: 'on_time_utc',
                errorMessage: '挡轮挡时刻 (ON) 不能早于落地时刻 (LDG)。',
            };
        }
    }

    return { valid: true };
}

// ─── 3. Air Time Calculation ──────────────────────────────────────────────────

/**
 * Calculates the air time in integer minutes (wheels-up to wheels-down).
 * This is the flight time excluding taxi operations.
 *
 * Cross-midnight safe (delegates to calcBlockMinutes).
 * Returns null if either TO or LDG is not available.
 *
 * @param toUtcISO  - Takeoff time as UTC ISO-8601 string (or null).
 * @param ldgUtcISO - Landing time as UTC ISO-8601 string (or null).
 * @returns Air time in integer minutes, or null if inputs are incomplete.
 *
 * @example
 * calcFlightTimeMin('2024-03-01T08:10:00Z', '2024-03-01T10:30:00Z') // → 140
 * calcFlightTimeMin(null, '2024-03-01T10:30:00Z')                   // → null
 */
export function calcFlightTimeMin(
    toUtcISO: string | null,
    ldgUtcISO: string | null
): number | null {
    if (toUtcISO === null || ldgUtcISO === null) return null;
    return calcBlockMinutes(toUtcISO, ldgUtcISO);
}
