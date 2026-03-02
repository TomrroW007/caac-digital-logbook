/**
 * @file utils/TimeUtils.ts
 * @description UI-facing time display formatting for the CAAC Digital Logbook.
 *
 * While TimeCalculator.ts handles the math (minutes ↔ ISO strings),
 * this module handles the *display layer* — turning the pilot's raw
 * numeric keyboard input into the formatted string shown in the text field
 * in real-time as they type.
 *
 * Design: Pure functions, zero dependencies (not even on TimeCalculator.ts).
 * All functions operate on raw digit strings and return display strings only.
 *
 * PRD §3.2: "所有时间输入框唤起纯数字键盘（如输入 0830 自动格式化为 08:30）"
 */

// ─── 1. Live Masking (called on every keystroke) ──────────────────────────────

/**
 * Formats a raw digit string AS THE PILOT TYPES into a masked display string.
 * Designed to be called on every `onChangeText` event from the numeric keyboard.
 *
 * Masking rules:
 *  - 0 digits : ""         → ""
 *  - 1 digit  : "0"        → "0"
 *  - 2 digits : "08"       → "08"
 *  - 3 digits : "083"      → "08:3"    ← colon inserted after position 2
 *  - 4 digits : "0830"     → "08:30"   ← complete, validated
 *
 * Non-digit characters are stripped before processing (safe for paste events).
 *
 * @param raw - Raw string from keyboard (may contain any characters).
 * @returns  Display string for the text input field.
 *
 * @example
 * formatRawInputForDisplay('')     // → ""
 * formatRawInputForDisplay('0')    // → "0"
 * formatRawInputForDisplay('08')   // → "08"
 * formatRawInputForDisplay('083')  // → "08:3"
 * formatRawInputForDisplay('0830') // → "08:30"
 * formatRawInputForDisplay('08:30') // → "08:30"  (paste from clipboard)
 */
export function formatRawInputForDisplay(raw: string): string {
    // Strip non-digits, keep only up to 4 digits
    const digits = raw.replace(/\D/g, '').slice(0, 4);

    if (digits.length <= 2) {
        return digits; // "0", "08" — no colon yet
    }

    // 3 or 4 digits: insert colon after position 2
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/**
 * Returns the raw digit string from a possibly-formatted display value.
 * Used when the user taps the backspace key — we need to remove the last digit,
 * not the colon character.
 *
 * @param display - Formatted display string (e.g. "08:3" or "08:30").
 * @returns Raw digit string (e.g. "083" or "0830").
 *
 * @example
 * extractDigitsFromDisplay('08:30') // → "0830"
 * extractDigitsFromDisplay('08:3')  // → "083"
 * extractDigitsFromDisplay('08')    // → "08"
 */
export function extractDigitsFromDisplay(display: string): string {
    return display.replace(/\D/g, '').slice(0, 4);
}

// ─── 2. Partial Input State (for enabling/disabling the save button) ──────────

/**
 * Analyses a raw input string and returns its display state plus a completeness flag.
 * The UI uses `isComplete` to decide whether the time field is fully entered
 * (required before the record can be saved).
 *
 * @param raw - Raw digit string from keyboard input.
 * @returns  Object with `display` string and `isComplete` boolean.
 *
 * @example
 * maskPartialInput('083')   // → { display: '08:3',  isComplete: false }
 * maskPartialInput('0830')  // → { display: '08:30', isComplete: true  }
 * maskPartialInput('')      // → { display: '',      isComplete: false }
 */
export function maskPartialInput(raw: string): {
    display: string;
    isComplete: boolean;
} {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    const display = formatRawInputForDisplay(digits);
    const isComplete = digits.length === 4;
    return { display, isComplete };
}

// ─── 3. Confirmed Entry Formatting ───────────────────────────────────────────

/**
 * Converts a confirmed (complete) raw input to the canonical "HH:MM" display
 * format used in read-only labels and list views.
 *
 * Different from `formatRawInputForDisplay` in that:
 *  - It always pads to 4 digits (partial inputs become complete)
 *  - It always returns the full "HH:MM" format with zero-padded hours
 *
 * @param raw - Raw pilot input (1-4 digits, e.g. "830" or "0830").
 * @returns  "HH:MM" string for display (e.g. "08:30").
 * @throws   Error if the resulting time would be invalid (hours > 23 or mins > 59).
 *
 * @example
 * rawInputToDisplayTime('0830') // → "08:30"
 * rawInputToDisplayTime('830')  // → "08:30"  (padded)
 * rawInputToDisplayTime('2359') // → "23:59"
 * rawInputToDisplayTime('0')    // → "00:00"
 */
export function rawInputToDisplayTime(raw: string): string {
    const digits = raw.replace(/\D/g, '').padStart(4, '0').slice(-4);
    const hh = digits.slice(0, 2);
    const mm = digits.slice(2);

    const hours = parseInt(hh, 10);
    const mins = parseInt(mm, 10);

    if (hours > 23) {
        throw new Error(
            `rawInputToDisplayTime: invalid hours "${hours}" in input "${raw}".`
        );
    }
    if (mins > 59) {
        throw new Error(
            `rawInputToDisplayTime: invalid minutes "${mins}" in input "${raw}".`
        );
    }

    return `${hh}:${mm}`;
}

/**
 * Converts a "HH:MM" display string back to a raw 4-digit string.
 * Used when entering edit mode to pre-populate the numeric input field.
 *
 * @param display - Time string in "HH:MM" format (e.g. "08:30").
 * @returns Raw 4-digit string (e.g. "0830").
 * @throws  Error if the format is not "HH:MM".
 *
 * @example
 * displayTimeToRaw('08:30') // → "0830"
 * displayTimeToRaw('23:59') // → "2359"
 */
export function displayTimeToRaw(display: string): string {
    const parts = display.split(':');
    if (parts.length !== 2 || parts[0].length !== 2 || parts[1].length !== 2) {
        throw new Error(
            `displayTimeToRaw: expected "HH:MM" format but received "${display}".`
        );
    }
    return `${parts[0]}${parts[1]}`;
}

// ─── 4. Duration Display (Logbook column values) ──────────────────────────────

/**
 * Formats an integer duration in minutes as a logbook-column display string.
 * Alias for the convention used in export and summary displays.
 *
 * Uses H:MM format (no leading zero on hours) per CCAR-61 logbook convention.
 * Handles accumulated totals > 24 hours.
 *
 * @param durationMinutes - Non-negative integer minutes.
 * @returns "H:MM" format string, e.g. "2:30", "0:00", "25:00".
 *
 * @example
 * formatDuration(90)   // → "1:30"
 * formatDuration(0)    // → "0:00"
 * formatDuration(1500) // → "25:00"
 */
export function formatDuration(durationMinutes: number): string {
    if (durationMinutes < 0) {
        throw new Error(`formatDuration: negative value ${durationMinutes} is invalid.`);
    }
    const rounded = Math.round(durationMinutes);
    const hours = Math.floor(rounded / 60);
    const mins = rounded % 60;
    return `${hours}:${String(mins).padStart(2, '0')}`;
}

/**
 * Formats a date string (YYYY-MM-DD) for display to the pilot.
 * Currently returns the ISO format as-is; can be extended for locale formatting.
 *
 * @param isoDate - ISO date string "YYYY-MM-DD".
 * @returns Display date string.
 *
 * @example
 * formatDate('2024-03-01') // → "2024-03-01"
 */
export function formatDate(isoDate: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        throw new Error(`formatDate: invalid ISO date "${isoDate}".`);
    }
    return isoDate;
}
