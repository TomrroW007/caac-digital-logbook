/**
 * @file utils/TimeCalculator.ts
 * @description Pure-function time calculation engine for CAAC Digital Logbook.
 *
 * Design principles:
 *  - ZERO external dependencies — avoids dayjs/moment tree-shake risk in Expo.
 *  - ZERO side effects — every function is a deterministic pure function.
 *  - ZERO floating-point time arithmetic — all durations are INTEGER minutes.
 *  - Uses Date.UTC() for all timestamp construction to sidestep local-tz displacement.
 *
 * Key areas covered:
 *  1. Raw pilot input parsing  ("0830" → 510 minutes since midnight)
 *  2. Integer minutes ↔ HH:MM display format
 *  3. Block-time calculation with automatic cross-midnight compensation
 *  4. Local-time → UTC ISO conversion (offline timezone library bridge)
 *  5. OFF/ON time inference from TO/LDG (the "10-5 rule")
 */

// ─── 1. Raw Input Parsing ─────────────────────────────────────────────────────

/**
 * Converts pilot-friendly numeric keyboard input into absolute minutes since
 * midnight (0–1439).
 *
 * Padding rules (matches a 4-digit time display):
 *  - 4 digits  : "0830" → HH=08, MM=30 → 510
 *  - 3 digits  : "830"  → pad left → "0830" → HH=08, MM=30 → 510
 *  - 2 digits  : "30"   → treated as 00:30 → 30
 *  - 1 digit   : "5"    → treated as 00:05 → 5
 *  - "0" / ""  : → 0
 *
 * @param raw - A numeric string entered via the numeric keypad (e.g. "0830", "830").
 *              Non-numeric chars are stripped automatically.
 * @returns    Absolute minutes since midnight (0–1439).
 * @throws     Error if the result is not a valid HH:MM (hours 0–23, minutes 0–59).
 *
 * @example
 * parseRawInputToMinutes('0830') // → 510
 * parseRawInputToMinutes('830')  // → 510
 * parseRawInputToMinutes('30')   // → 30
 * parseRawInputToMinutes('2359') // → 1439
 */
export function parseRawInputToMinutes(raw: string): number {
    // Strip any non-digit characters (e.g. accidental colons from paste)
    const digits = raw.replace(/\D/g, '');

    if (digits === '' || digits === '0') return 0;

    // Left-pad to at least 4 digits so slicing is consistent
    const padded = digits.padStart(4, '0');

    // With 4 digits: HHMM
    const hh = parseInt(padded.slice(0, padded.length - 2), 10);
    const mm = parseInt(padded.slice(padded.length - 2), 10);

    if (mm > 59) {
        throw new Error(
            `parseRawInputToMinutes: invalid minutes "${mm}" parsed from "${raw}". ` +
            `Minutes must be 0–59.`
        );
    }
    if (hh > 23) {
        throw new Error(
            `parseRawInputToMinutes: invalid hours "${hh}" parsed from "${raw}". ` +
            `Hours must be 0–23.`
        );
    }

    return hh * 60 + mm;
}

// ─── 2. Minutes ↔ Display Format ─────────────────────────────────────────────

/**
 * Formats an integer number of minutes as an H:MM string for CCAR-61 display
 * and export. The hour component is NOT zero-padded (matches logbook convention:
 * "1:05", "10:30", "0:00").
 *
 * Note: This function also handles accumulated flight hours > 24h correctly
 * (e.g. 1500 minutes → "25:00"), which matters for cumulative totals on PDF exports.
 *
 * @param totalMinutes - Non-negative integer minutes.
 * @returns H:MM formatted string.
 *
 * @example
 * minutesToHHMM(150)  // → "2:30"
 * minutesToHHMM(65)   // → "1:05"
 * minutesToHHMM(0)    // → "0:00"
 * minutesToHHMM(1500) // → "25:00"  (cumulative total, valid)
 */
export function minutesToHHMM(totalMinutes: number): string {
    if (totalMinutes < 0) {
        throw new Error(
            `minutesToHHMM: received negative value ${totalMinutes}. Minutes must be ≥ 0.`
        );
    }

    const roundedMinutes = Math.round(totalMinutes); // guard against accidental floats
    const hours = Math.floor(roundedMinutes / 60);
    const mins = roundedMinutes % 60;

    // Pad minutes to 2 digits, leave hours without leading zero
    return `${hours}:${String(mins).padStart(2, '0')}`;
}

/**
 * Parses an H:MM or HH:MM string back to integer minutes.
 * The inverse of minutesToHHMM.
 *
 * @param hhmm - Time string in "H:MM" or "HH:MM" format.
 * @returns    Total integer minutes.
 *
 * @example
 * hhmmToMinutes('2:30')  // → 150
 * hhmmToMinutes('1:05')  // → 65
 * hhmmToMinutes('25:00') // → 1500
 */
export function hhmmToMinutes(hhmm: string): number {
    const parts = hhmm.split(':');
    if (parts.length !== 2) {
        throw new Error(
            `hhmmToMinutes: expected "H:MM" format but received "${hhmm}".`
        );
    }
    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);

    if (isNaN(hours) || isNaN(mins) || mins > 59) {
        throw new Error(`hhmmToMinutes: invalid time string "${hhmm}".`);
    }

    return hours * 60 + mins;
}

// ─── 3. Block-Time Calculation ────────────────────────────────────────────────

/**
 * Calculates the integer block-time duration in minutes between chock-off and
 * chock-on (or SIM "From" and "To") using UTC ISO-8601 strings.
 *
 * ⚠️ Cross-midnight safety: If the raw difference is negative (i.e. ON < OFF
 * in minutes-since-midnight), this function automatically adds 1440 minutes
 * (+24 hours). This matches the PRD requirement: "若后一节点数值小于前一节点，
 * 系统自动按 +24 小时跨日计算".
 *
 * Uses Date.parse() on full ISO strings, so timezone offsets in the strings
 * are respected correctly.
 *
 * @param offUtcISO - Chock-off time as UTC ISO-8601 string (e.g. "2024-03-01T22:00:00Z").
 * @param onUtcISO  - Chock-on time as UTC ISO-8601 string (e.g. "2024-03-02T01:30:00Z").
 * @returns  Block-time in integer minutes (always positive).
 *
 * @example
 * // Normal same-day flight: 2h 30m
 * calcBlockMinutes('2024-03-01T08:00:00Z', '2024-03-01T10:30:00Z') // → 150
 *
 * // Cross-midnight flight: 23:00 → 01:30 = 2h 30m
 * calcBlockMinutes('2024-03-01T23:00:00Z', '2024-03-02T01:30:00Z') // → 150
 */
export function calcBlockMinutes(
    offUtcISO: string,
    onUtcISO: string
): number {
    const offMs = Date.parse(offUtcISO);
    const onMs = Date.parse(onUtcISO);

    if (isNaN(offMs)) {
        throw new Error(
            `calcBlockMinutes: invalid offUtcISO "${offUtcISO}". Must be a valid ISO-8601 string.`
        );
    }
    if (isNaN(onMs)) {
        throw new Error(
            `calcBlockMinutes: invalid onUtcISO "${onUtcISO}". Must be a valid ISO-8601 string.`
        );
    }

    let diffMs = onMs - offMs;

    // Cross-midnight compensation: if ON is "earlier" than OFF in clock time,
    // the actual gap spans midnight → add 24 hours in milliseconds.
    if (diffMs < 0) {
        diffMs += 24 * 60 * 60 * 1000; // +1440 minutes in ms
    }

    // Convert ms → minutes, truncate to integer (no fractional minutes)
    return Math.floor(diffMs / (60 * 1000));
}

// ─── 4. Local Time → UTC ISO Conversion ──────────────────────────────────────

/**
 * Converts a local date string and raw pilot time input to a UTC ISO-8601 string.
 *
 * This function is the bridge between the offline timezone dictionary (ICAO → UTC
 * offset in minutes) and the UTC-stored database. It deliberately uses Date.UTC()
 * internally to avoid any local machine timezone contamination.
 *
 * @param date            - Local calendar date as "YYYY-MM-DD" string.
 * @param rawTime         - Pilot keyboard input (e.g. "0830", "830"). Parsed by
 *                          parseRawInputToMinutes internally.
 * @param tzOffsetMinutes - Airport's UTC offset in signed integer minutes.
 *                          Positive = East (UTC+8 Beijing → +480),
 *                          Negative = West (UTC-5 New York → -300).
 * @returns UTC ISO-8601 string (always ends with "Z").
 *
 * @example
 * // Beijing (UTC+8): 08:30 local → 00:30 UTC
 * localTimeToUtcISO('2024-03-01', '0830', 480)
 * // → "2024-03-01T00:30:00.000Z"
 *
 * // New York (UTC-5): 08:30 local → 13:30 UTC
 * localTimeToUtcISO('2024-03-01', '0830', -300)
 * // → "2024-03-01T13:30:00.000Z"
 */
export function localTimeToUtcISO(
    date: string,
    rawTime: string,
    tzOffsetMinutes: number
): string {
    // Parse the date components to avoid any Date() constructor ambiguity
    const dateParts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateParts) {
        throw new Error(
            `localTimeToUtcISO: invalid date format "${date}". Expected "YYYY-MM-DD".`
        );
    }
    const year = parseInt(dateParts[1], 10);
    const month = parseInt(dateParts[2], 10) - 1; // Date.UTC months are 0-indexed
    const day = parseInt(dateParts[3], 10);

    // Convert raw pilot input to minutes since midnight (local time)
    const localMinutesSinceMidnight = parseRawInputToMinutes(rawTime);
    const localHours = Math.floor(localMinutesSinceMidnight / 60);
    const localMins = localMinutesSinceMidnight % 60;

    // Build the local timestamp in UTC epoch milliseconds, then subtract the offset
    // to get the actual UTC epoch.
    //
    // Derivation:
    //   UTC_epoch = local_epoch - offset_ms
    //   local_epoch = Date.UTC(year, month, day, localHours, localMins)
    //   offset_ms  = tzOffsetMinutes * 60_000
    const localEpochMs = Date.UTC(year, month, day, localHours, localMins, 0, 0);
    const utcEpochMs = localEpochMs - tzOffsetMinutes * 60 * 1000;

    return new Date(utcEpochMs).toISOString();
}

// ─── 5. OFF/ON Inference (10-5 Rule) ─────────────────────────────────────────

/**
 * Infers the chock-off and chock-on times from takeoff and landing times when
 * the pilot has only entered the flight-phase timestamps.
 *
 * Business rule (PRD §3.2):
 *   OFF = TO - 10 minutes  (taxi-out assumed)
 *   ON  = LDG + 5 minutes  (taxi-in assumed)
 *
 * To be called only when BOTH to and ldg are present AND at least one of
 * off/on is missing.
 *
 * @param toUtcISO  - Takeoff time as UTC ISO-8601 string.
 * @param ldgUtcISO - Landing time as UTC ISO-8601 string.
 * @returns Object containing the inferred offUtcISO and onUtcISO strings.
 *
 * @example
 * inferOffOn('2024-03-01T08:10:00Z', '2024-03-01T10:30:00Z')
 * // → {
 * //     offUtcISO: '2024-03-01T08:00:00.000Z',   // TO - 10m
 * //     onUtcISO:  '2024-03-01T10:35:00.000Z',   // LDG + 5m
 * //   }
 */
export function inferOffOn(
    toUtcISO: string,
    ldgUtcISO: string
): { offUtcISO: string; onUtcISO: string } {
    const toMs = Date.parse(toUtcISO);
    const ldgMs = Date.parse(ldgUtcISO);

    if (isNaN(toMs)) {
        throw new Error(
            `inferOffOn: invalid toUtcISO "${toUtcISO}". Must be a valid ISO-8601 string.`
        );
    }
    if (isNaN(ldgMs)) {
        throw new Error(
            `inferOffOn: invalid ldgUtcISO "${ldgUtcISO}". Must be a valid ISO-8601 string.`
        );
    }

    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    const offMs = toMs - TEN_MINUTES_MS;
    const onMs = ldgMs + FIVE_MINUTES_MS;

    return {
        offUtcISO: new Date(offMs).toISOString(),
        onUtcISO: new Date(onMs).toISOString(),
    };
}

// ─── 6. Input Validation Helper ───────────────────────────────────────────────

/**
 * Validates the compliance rule: the sum of role-specific flight times must not
 * exceed the block time. Implemented here as a pure helper so it can be unit-tested
 * independently of the WatermelonDB model.
 *
 * PRD §4.1 red-line formula:
 *   PIC + SIC + DUAL + INSTRUCTOR <= BLOCK_TIME
 *
 * @returns  true if the record is compliant, false if it should be blocked.
 *
 * @example
 * isRoleTimeSumValid({ blockTimeMin: 150, picMin: 80, sicMin: 70, dualMin: 0, instructorMin: 0 })
 * // → true  (80 + 70 = 150, exactly at limit)
 *
 * isRoleTimeSumValid({ blockTimeMin: 150, picMin: 80, sicMin: 80, dualMin: 0, instructorMin: 0 })
 * // → false (160 > 150)
 */
export function isRoleTimeSumValid(params: {
    blockTimeMin: number;
    picMin: number;
    sicMin: number;
    dualMin: number;
    instructorMin: number;
}): boolean {
    const { blockTimeMin, picMin, sicMin, dualMin, instructorMin } = params;
    return picMin + sicMin + dualMin + instructorMin <= blockTimeMin;
}
