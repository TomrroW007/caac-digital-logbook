/**
 * @file components/shared/OptionPicker.tsx
 * @description Horizontally scrollable single-select chip bar.
 *
 * Used for aviation-domain enum fields (approach type, simulator category,
 * training type) where free-text input creates unconstrained dirty data.
 *
 * Design: renders a ScrollView of rounded chips.
 * Selected chip is highlighted with the primary blue; unselected chips are
 * card-coloured with a grey border. An empty selection ("—") is the first chip.
 */

import React from 'react';
import {
    ScrollView,
    TouchableOpacity,
    Text,
    StyleSheet,
    View,
} from 'react-native';

export interface OptionPickerOption {
    label: string;
    value: string;
}

interface Props {
    /** Current selected value. Pass null / '' for no selection. */
    value: string;
    /** Called with the newly selected value, or '' when deselected. */
    onChange: (value: string) => void;
    /** Selectable options. A "—" (clear) chip is prepended automatically. */
    options: OptionPickerOption[];
    /** Field label displayed above the picker row. */
    label: string;
    testID?: string;
}

const COLORS = {
    primary: '#3B82F6',
    card: '#1F2937',
    border: '#374151',
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    selectedText: '#FFFFFF',
    background: '#111827',
};

export const OptionPicker: React.FC<Props> = ({
    value,
    onChange,
    options,
    label,
    testID,
}) => {
    const handleSelect = (chipValue: string) => {
        // Tapping the already-selected chip deselects it (toggle)
        onChange(chipValue === value ? '' : chipValue);
    };

    return (
        <View style={styles.container} testID={testID}>
            <Text style={styles.label}>{label}</Text>
            <View
                style={styles.row}
            >
                {/* Clear chip */}
                <TouchableOpacity
                    style={[styles.chip, !value && styles.chipSelected]}
                    onPress={() => onChange('')}
                    testID={testID ? `${testID}-clear` : undefined}
                >
                    <Text style={[styles.chipText, !value && styles.chipTextSelected]}>
                        —
                    </Text>
                </TouchableOpacity>

                {options.map(opt => {
                    const isSelected = opt.value === value;
                    return (
                        <TouchableOpacity
                            key={opt.value}
                            style={[styles.chip, isSelected && styles.chipSelected]}
                            onPress={() => handleSelect(opt.value)}
                            testID={testID ? `${testID}-opt-${opt.value}` : undefined}
                        >
                            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                                {opt.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 8 },
    label: {
        color: COLORS.textSecondary,
        fontSize: 11,
        marginBottom: 6,
        fontWeight: '500',
    },
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        paddingBottom: 4,
    },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.card,
    },
    chipSelected: {
        backgroundColor: COLORS.primary,
        borderColor: COLORS.primary,
    },
    chipText: {
        color: COLORS.textSecondary,
        fontSize: 12,
        fontWeight: '500',
    },
    chipTextSelected: {
        color: COLORS.selectedText,
        fontWeight: '700',
    },
});

export default OptionPicker;
