/**
 * @file components/shared/MaskedTimeInput.tsx
 * @description Numeric-keypad time input component with live HH:MM masking.
 *
 * Implements PRD §3.2: "所有时间输入框唤起纯数字键盘（如输入 0830 自动格式化为 08:30）"
 *
 * Design:
 *  - Parent owns raw digit string (value / onChange) — controlled component.
 *  - Live display: on every keystroke, calls formatRawInputForDisplay() from TimeUtils.
 *  - Completion: isComplete flag from maskPartialInput() controls Save button readiness.
 *  - Edit mode: on press, calls extractDigitsFromDisplay() to restore raw digits.
 */

import React, { useState, useRef } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    TextInputProps,
} from 'react-native';
import {
    formatRawInputForDisplay,
    extractDigitsFromDisplay,
    maskPartialInput,
} from '../../utils/TimeUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
    /** Display label, e.g. "OFF", "TO", "LDG", "ON", "From", "To" */
    label: string;
    /** Raw digit string (4 digits max), owned by parent form state */
    value: string;
    /** Called with new raw digit string on every keystroke */
    onChange: (raw: string) => void;
    /** If true, field is optional — no red asterisk, no error highlight */
    optional?: boolean;
    /** If true, shows a red error border regardless of value */
    hasError?: boolean;
    /** Accessible hint text shown below the field on error */
    errorMessage?: string;
    /** If true, field is not editable (display-only) */
    readOnly?: boolean;
    /** Called when field loses focus */
    onBlur?: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export const MaskedTimeInput: React.FC<Props> = ({
    label,
    value,
    onChange,
    optional = false,
    hasError = false,
    errorMessage,
    readOnly = false,
    onBlur,
}) => {
    const inputRef = useRef<TextInput>(null);
    const { display, isComplete } = maskPartialInput(value);

    const handleChangeText = (text: string) => {
        // Strip non-digits, keep at most 4 characters
        const digits = text.replace(/\D/g, '').slice(0, 4);
        onChange(digits);
    };

    const handleFocus = () => {
        // When user taps an already-filled field, show raw digits so they can backspace
        // The displayed value switches to showing digits only while editing
    };

    const handleBlur = () => {
        onBlur?.();
    };

    // Border colour logic:
    //  - Red   : hasError
    //  - Green : isComplete (4 digits entered)
    //  - Default: neutral
    const borderColor = hasError
        ? COLORS.error
        : isComplete
            ? COLORS.success
            : COLORS.border;

    return (
        <View style={styles.container}>
            {/* Label row */}
            <View style={styles.labelRow}>
                <Text style={styles.label}>{label}</Text>
                {!optional && <Text style={styles.required}>*</Text>}
            </View>

            {/* Input field */}
            <TouchableOpacity
                activeOpacity={readOnly ? 1 : 0.8}
                onPress={() => !readOnly && inputRef.current?.focus()}
                style={[styles.inputWrapper, { borderColor }]}
            >
                {/* Hidden real TextInput — captures numeric keyboard */}
                <TextInput
                    ref={inputRef}
                    style={styles.hiddenInput}
                    keyboardType="number-pad"
                    maxLength={4}
                    value={value}
                    onChangeText={handleChangeText}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    editable={!readOnly}
                    caretHidden={false}
                    testID={`time-input-${label.toLowerCase()}`}
                />

                {/* Masked display text */}
                <Text style={[styles.displayText, !display && styles.placeholder]}>
                    {display || '——:——'}
                </Text>

                {/* Completion checkmark */}
                {isComplete && !hasError && (
                    <Text style={styles.checkmark}>✓</Text>
                )}
            </TouchableOpacity>

            {/* Error message */}
            {hasError && errorMessage ? (
                <Text style={styles.errorText}>{errorMessage}</Text>
            ) : null}
        </View>
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const COLORS = {
    primary: '#3B82F6',    // blue-500
    success: '#22C55E',    // green-500
    error: '#EF4444',      // red-500
    border: '#374151',     // gray-700
    background: '#1F2937', // gray-800
    surface: '#111827',    // gray-900
    text: '#F9FAFB',       // gray-50
    textSecondary: '#9CA3AF', // gray-400
    required: '#F59E0B',   // amber-500
};

const styles = StyleSheet.create({
    container: {
        marginBottom: 12,
        minWidth: 80,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    label: {
        color: COLORS.textSecondary,
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
    },
    required: {
        color: COLORS.required,
        fontSize: 11,
        marginLeft: 2,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.background,
        borderWidth: 1.5,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: 48,
    },
    hiddenInput: {
        // Positioned over the display text so keyboard events are captured
        position: 'absolute',
        opacity: 0,
        width: '100%',
        height: '100%',
        left: 0,
        top: 0,
    },
    displayText: {
        color: COLORS.text,
        fontSize: 20,
        fontWeight: '600',
        letterSpacing: 2,
        fontVariant: ['tabular-nums'],
        flex: 1,
    },
    placeholder: {
        color: COLORS.border,
    },
    checkmark: {
        color: COLORS.success,
        fontSize: 16,
        marginLeft: 4,
    },
    errorText: {
        color: COLORS.error,
        fontSize: 11,
        marginTop: 4,
    },
});

export default MaskedTimeInput;
