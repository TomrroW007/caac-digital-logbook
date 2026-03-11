/**
 * @file components/shared/SmartDatePicker.tsx
 * @description 智能日期选择器：快捷筹码（今天/昨天）+ 隐藏日历。
 *
 * - Native (iOS/Android)：TouchableOpacity 唤起 DateTimePicker 弹窗
 * - Web (PWA)：降级为 HTML5 原生 <input type="date">，零依赖、零包膨胀
 * - 合规保障：所有日期字符串均通过本地时区拼接，杜绝 toISOString() 时区偏移
 * - 防呆：maximumDate 锁定今天，不允许记录未来飞行
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

interface Props {
    /** 当前值，格式严格为 "YYYY-MM-DD" */
    value: string;
    onChange: (dateStr: string) => void;
    /** 是否显示错误高亮边框 */
    hasError?: boolean;
}

// ─── 合规核心函数：本地时区 YYYY-MM-DD，绝不使用 toISOString() ──────────────
const localDateStr = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

// ─── 将 YYYY-MM-DD 字符串解析为本地时间 Date（避免 UTC 偏移导致日期错一天）──
const parseLocalDate = (dateStr: string): Date => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
};

export const SmartDatePicker: React.FC<Props> = ({ value, onChange, hasError }) => {
    const [showNativePicker, setShowNativePicker] = useState(false);

    const todayDate = new Date();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);

    const todayStr = localDateStr(todayDate);
    const yesterdayStr = localDateStr(yesterdayDate);

    const isToday = value === todayStr;
    const isYesterday = value === yesterdayStr;
    const isOther = !isToday && !isYesterday;

    // 原生端日历回调
    const handleNativeChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
        // iOS：用户确认前保持弹窗；Android/dismissed：立即关闭
        if (event.type === 'set' && selectedDate) {
            onChange(localDateStr(selectedDate));
        }
        setShowNativePicker(false);
    };

    // 当前 Date 对象（供 DateTimePicker value 使用）
    const currentDate = value ? parseLocalDate(value) : todayDate;

    return (
        <View style={[styles.container, hasError && styles.containerError]}>
            {/* 快捷筹码：今天 */}
            <TouchableOpacity
                style={[styles.chip, isToday && styles.activeChip]}
                onPress={() => onChange(todayStr)}
                activeOpacity={0.75}
                testID="date-chip-today"
            >
                <Text style={[styles.chipText, isToday && styles.activeText]}>Today</Text>
            </TouchableOpacity>

            {/* 快捷筹码：昨天 */}
            <TouchableOpacity
                style={[styles.chip, isYesterday && styles.activeChip]}
                onPress={() => onChange(yesterdayStr)}
                activeOpacity={0.75}
                testID="date-chip-yesterday"
            >
                <Text style={[styles.chipText, isYesterday && styles.activeText]}>Yesterday</Text>
            </TouchableOpacity>

            {/* 更多日期：Web / Native 双轨渲染 */}
            {Platform.OS === 'web' ? (
                // ── Web PWA：HTML5 原生 input，零依赖 ──
                <input
                    type="date"
                    value={value}
                    max={todayStr}
                    onChange={(e) => onChange(e.target.value)}
                    style={{
                        ...webInputBase,
                        backgroundColor: isOther ? '#007AFF' : '#E5E5EA',
                        color: isOther ? '#FFF' : '#555',
                    }}
                    data-testid="date-input-web"
                />
            ) : (
                // ── Native：唤起系统 DateTimePicker ──
                <TouchableOpacity
                    style={[styles.chip, isOther && styles.activeChip]}
                    onPress={() => setShowNativePicker(true)}
                    activeOpacity={0.75}
                    testID="date-chip-other"
                >
                    <Text style={[styles.chipText, isOther && styles.activeText]}>
                        📅 {isOther ? value : 'Other'}
                    </Text>
                </TouchableOpacity>
            )}

            {/* Native 系统日历弹窗 */}
            {showNativePicker && Platform.OS !== 'web' && (
                <DateTimePicker
                    value={currentDate}
                    mode="date"
                    display="default"
                    maximumDate={todayDate}
                    onChange={handleNativeChange}
                />
            )}
        </View>
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 4,
    },
    containerError: {
        // 与 TextInput 错误态保持一致的视觉提示
        borderRadius: 8,
        padding: 4,
        borderWidth: 1,
        borderColor: '#FF3B30',
    },
    chip: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        backgroundColor: '#E5E5EA',
        justifyContent: 'center',
        alignItems: 'center',
    },
    activeChip: {
        backgroundColor: '#007AFF',
    },
    chipText: {
        fontSize: 14,
        color: '#555',
        fontWeight: '500',
    },
    activeText: {
        color: '#FFF',
        fontWeight: 'bold',
    },
});

// Web input 专属内联样式（StyleSheet 不支持 Web CSS 属性）
const webInputBase: React.CSSProperties = {
    paddingTop: '8px',
    paddingBottom: '8px',
    paddingLeft: '14px',
    paddingRight: '14px',
    borderRadius: '20px',
    border: 'none',
    outline: 'none',
    fontSize: '14px',
    fontWeight: '500',
    fontFamily: 'inherit',
    cursor: 'pointer',
};
