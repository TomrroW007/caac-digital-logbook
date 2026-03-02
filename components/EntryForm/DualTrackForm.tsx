/**
 * @file components/EntryForm/DualTrackForm.tsx
 * @description Dual-track entry form: FLIGHT / SIMULATOR toggle with dynamic field rendering.
 *
 * Implements PRD §3.1: top-level DUTY selector that auto-purges dirty data on switch.
 * Implements PRD §3.2: FLIGHT mode — four-point time axis, 10-5 auto-fill, compliance guard.
 * Implements PRD §3.3: SIMULATOR mode — SIM-specific fields, From/To time controls.
 * Implements PRD §4.1: blocks save when role-time sum > block time.
 */

import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    ScrollView,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Alert,
} from 'react-native';

import MaskedTimeInput from '../shared/MaskedTimeInput';
import { OptionPicker } from '../shared/OptionPicker';
import { resolveFourTimePoints } from '../../utils/FlightMath';
import { validateFlightRecord, type FlightRecordInput } from '../../utils/ComplianceValidator';
import { lookupAirportOffset } from '../../data/airportTimezones';
import { localTimeToUtcISO } from '../../utils/TimeCalculator';
import { minutesToHHMM } from '../../utils/TimeCalculator';
import type { LogbookRecord } from '../../model/LogbookRecord';

// ─── Types ────────────────────────────────────────────────────────────────────

type DutyType = 'FLIGHT' | 'SIMULATOR';

type FlightFields = {
    flightNo: string;
    depIcao: string;
    arrIcao: string;
    offRaw: string;   // raw digit string for OFF
    toRaw: string;    // raw digit string for TO
    ldgRaw: string;   // raw digit string for LDG
    onRaw: string;    // raw digit string for ON
    picRaw: string;   // role time in raw digits (minutes)
    sicRaw: string;
    dualRaw: string;
    instructorRaw: string;
    pilotRole: 'PF' | 'PM' | '';
    approachType: string;
    dayLdg: number;
    nightLdg: number;
    nightFlightRaw: string;
    instrumentRaw: string;
};

type SimFields = {
    simNo: string;
    simCat: string;
    trainingAgency: string;
    trainingType: string;
    fromRaw: string;  // SIM start time
    toRaw: string;    // SIM end time
};

type SharedFields = {
    schdDate: string;
    actlDate: string;
    acftType: string;
    regNo: string;
    remarks: string;
};

// ─── Domain Enum Constants ────────────────────────────────────────────────────

const APPROACH_TYPE_OPTIONS = [
    { label: 'ILS CAT I',    value: 'ILS CAT I' },
    { label: 'ILS CAT II',   value: 'ILS CAT II' },
    { label: 'ILS CAT III',  value: 'ILS CAT III' },
    { label: 'RNP AR',       value: 'RNP AR' },
    { label: 'RNAV (GNSS)',  value: 'RNAV (GNSS)' },
    { label: 'VOR',          value: 'VOR' },
    { label: 'NDB',          value: 'NDB' },
    { label: '目视 Visual',   value: 'Visual' },
];

const SIM_CAT_OPTIONS = [
    { label: 'FNPT I',       value: 'FNPT I' },
    { label: 'FNPT II',      value: 'FNPT II' },
    { label: 'FFS Level B',  value: 'FFS Level B' },
    { label: 'FFS Level C',  value: 'FFS Level C' },
    { label: 'FFS Level D',  value: 'FFS Level D' },
];

const TRAINING_TYPE_OPTIONS = [
    { label: 'OPC',          value: 'OPC' },
    { label: 'LPC',          value: 'LPC' },
    { label: 'PC',           value: 'PC' },
    { label: 'IR',           value: 'IR' },
    { label: 'Base Training',value: 'Base Training' },
    { label: 'Line Training',value: 'Line Training' },
    { label: 'Type Rating',  value: 'Type Rating' },
];

// ─── Initial States ───────────────────────────────────────────────────────────

const EMPTY_FLIGHT: FlightFields = {
    flightNo: '', depIcao: '', arrIcao: '',
    offRaw: '', toRaw: '', ldgRaw: '', onRaw: '',
    picRaw: '', sicRaw: '', dualRaw: '', instructorRaw: '',
    pilotRole: '', approachType: '',
    dayLdg: 0, nightLdg: 0,
    nightFlightRaw: '', instrumentRaw: '',
};

const EMPTY_SIM: SimFields = {
    simNo: '', simCat: '', trainingAgency: '', trainingType: '',
    fromRaw: '', toRaw: '',
};

const today = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FormSavePayload extends FlightRecordInput {
    dutyType: DutyType;
    flightNo: string | null;
    depIcao: string | null;
    arrIcao: string | null;
    regNo: string | null;
    toUtcISO: string | null;
    ldgUtcISO: string | null;
    approachType: string | null;
    pilotRole: 'PF' | 'PM' | null;
    dayLdg: number;
    nightLdg: number;
    simNo: string | null;
    simCat: string | null;
    trainingAgency: string | null;
    trainingType: string | null;
}

type Props = {
    /** Called after successful save — typically pops navigation */
    onSave: (data: FormSavePayload) => void;
    /** Called when user taps Cancel */
    onCancel: () => void;
    /** 'FLIGHT' or 'SIMULATOR' for initial duty toggle state */
    initialDutyType?: DutyType;
    /** Provide when editing an existing record — values are used to pre-fill the form */
    existingRecord?: LogbookRecord;
};

// ─── Component ────────────────────────────────────────────────────────────────

export const DualTrackForm: React.FC<Props> = ({
    onSave,
    onCancel,
    initialDutyType = 'FLIGHT',
    existingRecord,
}) => {
    // ── State — initialised from existingRecord when editing ────────────────────

    const [dutyType, setDutyType] = useState<DutyType>(existingRecord?.dutyType ?? initialDutyType);
    const [shared, setShared] = useState<SharedFields>({
        schdDate: existingRecord?.schdDate ?? today(),
        actlDate: existingRecord?.actlDate ?? today(),
        acftType: existingRecord?.acftType ?? '',
        regNo: existingRecord?.regNo ?? '',
        remarks: existingRecord?.remarks ?? '',
    });
    const [flight, setFlight] = useState<FlightFields>(existingRecord?.isFlight
        ? {
            flightNo: existingRecord.flightNo ?? '',
            depIcao: existingRecord.depIcao ?? '',
            arrIcao: existingRecord.arrIcao ?? '',
            offRaw: '', toRaw: '', ldgRaw: '', onRaw: '',
            picRaw: existingRecord.picMin > 0 ? String(existingRecord.picMin) : '',
            sicRaw: existingRecord.sicMin > 0 ? String(existingRecord.sicMin) : '',
            dualRaw: existingRecord.dualMin > 0 ? String(existingRecord.dualMin) : '',
            instructorRaw: existingRecord.instructorMin > 0 ? String(existingRecord.instructorMin) : '',
            pilotRole: existingRecord.pilotRole ?? '',
            approachType: existingRecord.approachType ?? '',
            dayLdg: existingRecord.dayLdg,
            nightLdg: existingRecord.nightLdg,
            nightFlightRaw: existingRecord.nightFlightMin > 0 ? String(existingRecord.nightFlightMin) : '',
            instrumentRaw: existingRecord.instrumentMin > 0 ? String(existingRecord.instrumentMin) : '',
        }
        : EMPTY_FLIGHT
    );
    const [sim, setSim] = useState<SimFields>(existingRecord?.isSimulator
        ? {
            simNo: existingRecord.simNo ?? '',
            simCat: existingRecord.simCat ?? '',
            trainingAgency: existingRecord.trainingAgency ?? '',
            trainingType: existingRecord.trainingType ?? '',
            fromRaw: '',
            toRaw: '',
        }
        : EMPTY_SIM
    );

    // Computed block time for display
    const [blockTimeMin, setBlockTimeMin] = useState<number | null>(
        existingRecord?.blockTimeMin ?? null
    );
    // Field-level validation errors
    const [errors, setErrors] = useState<Record<string, string>>({});
    // Whether save was attempted (enables error display)
    const [submitted, setSubmitted] = useState(false);

    // ── Duty Type Toggle ─────────────────────────────────────────────────────

    const handleDutyTypeChange = (next: DutyType) => {
        if (next === dutyType) return;
        // PRD §3.1: purge mode-specific data on toggle
        if (next === 'SIMULATOR') {
            setFlight(EMPTY_FLIGHT);
            setBlockTimeMin(null);
        } else {
            setSim(EMPTY_SIM);
            setBlockTimeMin(null);
        }
        setErrors({});
        setSubmitted(false);
        setDutyType(next);
    };

    // ── Four-Point Time Auto-Fill ─────────────────────────────────────────────

    /**
     * Called when any time field loses focus.
     * Attempts to resolve OFF/ON from TO+LDG if missing.
     */
    const handleTimeAxisBlur = useCallback(() => {
        const aDate = shared.actlDate || today();

        // Build UTC ISO strings from raw digit inputs + airport offsets
        const depOffset = lookupAirportOffset(flight.depIcao);
        const arrOffset = lookupAirportOffset(flight.arrIcao);

        const toUtcISO = flight.toRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.toRaw, depOffset)
            : null;
        const ldgUtcISO = flight.ldgRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.ldgRaw, arrOffset)
            : null;
        const offUtcISO = flight.offRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.offRaw, depOffset)
            : null;
        const onUtcISO = flight.onRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.onRaw, arrOffset)
            : null;

        // Need at least OFF+ON (direct) or TO+LDG (for inference)
        const canResolve =
            (offUtcISO && onUtcISO) ||
            (toUtcISO && ldgUtcISO);

        if (!canResolve) return;

        try {
            const resolved = resolveFourTimePoints({
                offUtcISO, toUtcISO, ldgUtcISO, onUtcISO,
            });
            setBlockTimeMin(resolved.blockTimeMin);
        } catch {
            // Not enough data yet to resolve — silent
        }
    }, [flight, shared.actlDate]);

    // ── SIM Time Auto-Fill ────────────────────────────────────────────────────

    const handleSimTimeBlur = useCallback(() => {
        const aDate = shared.actlDate || today();
        const offset = 480; // SIM times in local tz; default UTC+8

        if (sim.fromRaw.length === 4 && sim.toRaw.length === 4) {
            try {
                const fromUtc = localTimeToUtcISO(aDate, sim.fromRaw, offset);
                const toUtc = localTimeToUtcISO(aDate, sim.toRaw, offset);
                const resolved = resolveFourTimePoints({
                    offUtcISO: fromUtc, toUtcISO: null,
                    ldgUtcISO: null, onUtcISO: toUtc,
                });
                setBlockTimeMin(resolved.blockTimeMin);
            } catch {
                // silent
            }
        }
    }, [sim, shared.actlDate]);

    // ── Save ──────────────────────────────────────────────────────────────────

    const handleSave = () => {
        setSubmitted(true);

        const aDate = shared.actlDate || today();
        const depOffset = lookupAirportOffset(flight.depIcao);
        const arrOffset = lookupAirportOffset(flight.arrIcao);

        // Build UTC strings
        const offUtcISO = flight.offRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.offRaw, depOffset) : null;
        const onUtcISO = flight.onRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.onRaw, arrOffset) : null;
        const fromUtcISO = sim.fromRaw.length === 4
            ? localTimeToUtcISO(aDate, sim.fromRaw, 480) : null;
        const toSimUtcISO = sim.toRaw.length === 4
            ? localTimeToUtcISO(aDate, sim.toRaw, 480) : null;

        const parseMins = (raw: string): number =>
            raw ? parseInt(raw, 10) : 0;

        const recordInput: FlightRecordInput = {
            dutyType,
            blockTimeMin: blockTimeMin ?? 0,
            picMin: parseMins(flight.picRaw),
            sicMin: parseMins(flight.sicRaw),
            dualMin: parseMins(flight.dualRaw),
            instructorMin: parseMins(flight.instructorRaw),
            nightFlightMin: dutyType === 'FLIGHT' ? parseMins(flight.nightFlightRaw) : 0,
            instrumentMin: dutyType === 'FLIGHT' ? parseMins(flight.instrumentRaw) : 0,
            offUtcISO: dutyType === 'FLIGHT' ? offUtcISO : fromUtcISO,
            onUtcISO: dutyType === 'FLIGHT' ? onUtcISO : toSimUtcISO,
            actlDate: shared.actlDate,
            schdDate: shared.schdDate,
            acftType: shared.acftType || null,
            remarks: shared.remarks || null,
        };

        const result = validateFlightRecord(recordInput);

        if (!result.valid) {
            // Build error map by field name
            const errMap: Record<string, string> = {};
            result.errors.forEach(e => {
                errMap[e.field] = e.message;
            });
            setErrors(errMap);

            Alert.alert(
                '保存失败',
                `共发现 ${result.errors.length} 个问题，请检查标红字段。`,
                [{ text: '确认', style: 'default' }]
            );
            return;
        }

        setErrors({});

        const toUtcISO = flight.toRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.toRaw, depOffset) : null;
        const ldgUtcISO = flight.ldgRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.ldgRaw, arrOffset) : null;

        const fullPayload: FormSavePayload = {
            ...recordInput,
            dutyType,
            flightNo: dutyType === 'FLIGHT' ? (flight.flightNo || null) : null,
            depIcao: dutyType === 'FLIGHT' ? (flight.depIcao || null) : null,
            arrIcao: dutyType === 'FLIGHT' ? (flight.arrIcao || null) : null,
            regNo: shared.regNo || null,
            toUtcISO: dutyType === 'FLIGHT' ? toUtcISO : null,
            ldgUtcISO: dutyType === 'FLIGHT' ? ldgUtcISO : null,
            approachType: dutyType === 'FLIGHT' ? (flight.approachType || null) : null,
            pilotRole: dutyType === 'FLIGHT' ? (flight.pilotRole || null) : null,
            dayLdg: dutyType === 'FLIGHT' ? flight.dayLdg : 0,
            nightLdg: dutyType === 'FLIGHT' ? flight.nightLdg : 0,
            simNo: dutyType === 'SIMULATOR' ? (sim.simNo || null) : null,
            simCat: dutyType === 'SIMULATOR' ? (sim.simCat || null) : null,
            trainingAgency: dutyType === 'SIMULATOR' ? (sim.trainingAgency || null) : null,
            trainingType: dutyType === 'SIMULATOR' ? (sim.trainingType || null) : null,
        };

        onSave(fullPayload);
    };

    // ── Render helpers ───────────────────────────────────────────────────────

    const updateFlight = (patch: Partial<FlightFields>) =>
        setFlight(prev => ({ ...prev, ...patch }));

    const updateSim = (patch: Partial<SimFields>) =>
        setSim(prev => ({ ...prev, ...patch }));

    const updateShared = (patch: Partial<SharedFields>) =>
        setShared(prev => ({ ...prev, ...patch }));

    const fieldError = (key: string) =>
        submitted && errors[key] ? errors[key] : undefined;

    // ── Remarks section (shared across both duty tracks) ─────────────────────

    const renderRemarksSection = () => (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>备注 Remarks</Text>
            <TextInput
                style={[styles.textInput, { height: 72, textAlignVertical: 'top' }]}
                value={shared.remarks}
                onChangeText={v => updateShared({ remarks: v })}
                placeholder="飞行备注（可选）"
                placeholderTextColor={COLORS.placeholder}
                multiline
                numberOfLines={3}
                testID="input-remarks"
            />
        </View>
    );

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

            {/* ── Duty Type Toggle ─────────────────────────────────────────── */}
            <View style={styles.toggleRow}>
                {(['FLIGHT', 'SIMULATOR'] as DutyType[]).map(dt => (
                    <TouchableOpacity
                        key={dt}
                        style={[styles.toggleBtn, dutyType === dt && styles.toggleBtnActive]}
                        onPress={() => handleDutyTypeChange(dt)}
                        testID={`duty-toggle-${dt.toLowerCase()}`}
                    >
                        <Text style={[styles.toggleText, dutyType === dt && styles.toggleTextActive]}>
                            {dt === 'FLIGHT' ? '✈ FLIGHT' : '🖥 SIMULATOR'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* ── Shared Fields ────────────────────────────────────────────── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>基本信息</Text>

                <View style={styles.row}>
                    <View style={styles.flexField}>
                        <Text style={styles.inputLabel}>计划日期 Schd Date</Text>
                        <TextInput
                            style={[styles.textInput, fieldError('schd_date') && styles.inputError]}
                            value={shared.schdDate}
                            onChangeText={v => updateShared({ schdDate: v })}
                            placeholder="YYYY-MM-DD"
                            placeholderTextColor={COLORS.placeholder}
                            testID="input-schd-date"
                        />
                    </View>
                    <View style={styles.gap} />
                    <View style={styles.flexField}>
                        <Text style={styles.inputLabel}>实际日期 Actl Date *</Text>
                        <TextInput
                            style={[styles.textInput, fieldError('actl_date') && styles.inputError]}
                            value={shared.actlDate}
                            onChangeText={v => updateShared({ actlDate: v })}
                            placeholder="YYYY-MM-DD"
                            placeholderTextColor={COLORS.placeholder}
                            testID="input-actl-date"
                        />
                    </View>
                </View>

                <View style={styles.row}>
                    <View style={styles.flexField}>
                        <Text style={styles.inputLabel}>机型 A/C Type *</Text>
                        <TextInput
                            style={[styles.textInput, fieldError('acft_type') && styles.inputError]}
                            value={shared.acftType}
                            onChangeText={v => updateShared({ acftType: v.toUpperCase() })}
                            placeholder="A320"
                            placeholderTextColor={COLORS.placeholder}
                            autoCapitalize="characters"
                            testID="input-acft-type"
                        />
                    </View>
                    <View style={styles.gap} />
                    <View style={styles.flexField}>
                        <Text style={styles.inputLabel}>注册号 Reg No.</Text>
                        <TextInput
                            style={styles.textInput}
                            value={shared.regNo}
                            onChangeText={v => updateShared({ regNo: v.toUpperCase() })}
                            placeholder="B-6120"
                            placeholderTextColor={COLORS.placeholder}
                            autoCapitalize="characters"
                            testID="input-reg-no"
                        />
                    </View>
                </View>
            </View>

            {/* ── FLIGHT Mode Fields ───────────────────────────────────────── */}
            {dutyType === 'FLIGHT' && (
                <>
                    {/* Route */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>航段 Route</Text>
                        <View style={styles.row}>
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>起飞机场 DEP</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={flight.depIcao}
                                    onChangeText={v => updateFlight({ depIcao: v.toUpperCase() })}
                                    placeholder="ZBAA"
                                    placeholderTextColor={COLORS.placeholder}
                                    maxLength={4}
                                    autoCapitalize="characters"
                                    testID="input-dep-icao"
                                />
                            </View>
                            <Text style={styles.arrow}>→</Text>
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>降落机场 ARR</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={flight.arrIcao}
                                    onChangeText={v => updateFlight({ arrIcao: v.toUpperCase() })}
                                    placeholder="ZSSS"
                                    placeholderTextColor={COLORS.placeholder}
                                    maxLength={4}
                                    autoCapitalize="characters"
                                    testID="input-arr-icao"
                                />
                            </View>
                            <View style={styles.gap} />
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>航班号 Flt No.</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={flight.flightNo}
                                    onChangeText={v => updateFlight({ flightNo: v.toUpperCase() })}
                                    placeholder="CA1501"
                                    placeholderTextColor={COLORS.placeholder}
                                    autoCapitalize="characters"
                                    testID="input-flight-no"
                                />
                            </View>
                        </View>
                    </View>

                    {/* Four-Point Time Axis */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>时间轴 Time Axis (LT)</Text>
                        <Text style={styles.sectionHint}>
                            填写 TO + LDG 后，OFF/ON 将自动推算 (±10/5分钟)
                        </Text>

                        <View style={styles.timeAxisRow}>
                            <MaskedTimeInput
                                label="OFF"
                                value={flight.offRaw}
                                onChange={v => updateFlight({ offRaw: v })}
                                onBlur={handleTimeAxisBlur}
                                hasError={!!fieldError('off_time_utc')}
                            />
                            <MaskedTimeInput
                                label="TO"
                                value={flight.toRaw}
                                onChange={v => updateFlight({ toRaw: v })}
                                onBlur={handleTimeAxisBlur}
                                optional
                            />
                            <MaskedTimeInput
                                label="LDG"
                                value={flight.ldgRaw}
                                onChange={v => updateFlight({ ldgRaw: v })}
                                onBlur={handleTimeAxisBlur}
                                optional
                            />
                            <MaskedTimeInput
                                label="ON"
                                value={flight.onRaw}
                                onChange={v => updateFlight({ onRaw: v })}
                                onBlur={handleTimeAxisBlur}
                                hasError={!!fieldError('on_time_utc')}
                            />
                        </View>

                        {/* Block Time (auto-calculated, read-only) */}
                        {blockTimeMin !== null && (
                            <View style={styles.blockTimeRow}>
                                <Text style={styles.blockTimeLabel}>总时长 Block:</Text>
                                <Text style={styles.blockTimeValue}>
                                    {minutesToHHMM(blockTimeMin)}
                                </Text>
                                {fieldError('block_time_min') && (
                                    <Text style={styles.inlineError}>
                                        {fieldError('block_time_min')}
                                    </Text>
                                )}
                            </View>
                        )}
                    </View>

                    {/* Role Times */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>经历时间 Role Times</Text>
                        <Text style={styles.sectionHint}>
                            PIC + SIC + 带飞 + 教员 ≤ 总时长（局方合规红线）
                        </Text>

                        <View style={styles.row}>
                            <View style={styles.roleTimeField}>
                                <Text style={styles.inputLabel}>机长 PIC (分)</Text>
                                <TextInput
                                    style={[styles.textInput, fieldError('pic_min') && styles.inputError]}
                                    value={flight.picRaw}
                                    onChangeText={v => updateFlight({ picRaw: v.replace(/\D/g, '') })}
                                    keyboardType="number-pad"
                                    placeholder="0"
                                    placeholderTextColor={COLORS.placeholder}
                                    testID="input-pic"
                                />
                            </View>
                            <View style={styles.roleTimeField}>
                                <Text style={styles.inputLabel}>副驾 SIC (分)</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={flight.sicRaw}
                                    onChangeText={v => updateFlight({ sicRaw: v.replace(/\D/g, '') })}
                                    keyboardType="number-pad"
                                    placeholder="0"
                                    placeholderTextColor={COLORS.placeholder}
                                    testID="input-sic"
                                />
                            </View>
                            <View style={styles.roleTimeField}>
                                <Text style={styles.inputLabel}>带飞 Dual (分)</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={flight.dualRaw}
                                    onChangeText={v => updateFlight({ dualRaw: v.replace(/\D/g, '') })}
                                    keyboardType="number-pad"
                                    placeholder="0"
                                    placeholderTextColor={COLORS.placeholder}
                                    testID="input-dual"
                                />
                            </View>
                            <View style={styles.roleTimeField}>
                                <Text style={styles.inputLabel}>教员 Instr (分)</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={flight.instructorRaw}
                                    onChangeText={v => updateFlight({ instructorRaw: v.replace(/\D/g, '') })}
                                    keyboardType="number-pad"
                                    placeholder="0"
                                    placeholderTextColor={COLORS.placeholder}
                                    testID="input-instructor"
                                />
                            </View>
                        </View>

                        {/* Compliance error banner */}
                        {submitted && errors['pic_min'] && (
                            <View style={styles.errorBanner}>
                                <Text style={styles.errorBannerText}>
                                    ⛔ {errors['pic_min']}
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Role & Approach */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>输入角色与进运进类型</Text>
                        <OptionPicker
                            label="居位角色 Pilot Role"
                            value={flight.pilotRole}
                            onChange={v => updateFlight({ pilotRole: v as 'PF' | 'PM' | '' })}
                            options={[
                                { label: 'PF (操作)', value: 'PF' },
                                { label: 'PM (监控)', value: 'PM' },
                            ]}
                            testID="picker-pilot-role"
                        />
                        <OptionPicker
                            label="进运进类型 Approach Type"
                            value={flight.approachType}
                            onChange={v => updateFlight({ approachType: v })}
                            options={APPROACH_TYPE_OPTIONS}
                            testID="picker-approach-type"
                        />
                    </View>

                    {/* Landings */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>起降次数 Landings</Text>
                        <View style={styles.row}>
                            <LandingCounter
                                label="昼间 Day Ldg"
                                value={flight.dayLdg}
                                onChange={v => updateFlight({ dayLdg: v })}
                                testIDBase="day-ldg"
                            />
                            <View style={styles.gap} />
                            <LandingCounter
                                label="夜间 Night Ldg"
                                value={flight.nightLdg}
                                onChange={v => updateFlight({ nightLdg: v })}
                                testIDBase="night-ldg"
                            />
                        </View>
                    </View>

                    {/* Special Times */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>特殊时间 Special Times</Text>
                        <Text style={styles.sectionHint}>夜航和仓乱时间与 Block Time 可重叠，不入局方合规公式计算</Text>
                        <View style={styles.row}>
                            <View style={styles.roleTimeField}>
                                <Text style={styles.inputLabel}>夜航 Night (分)</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={flight.nightFlightRaw}
                                    onChangeText={v => updateFlight({ nightFlightRaw: v.replace(/\D/g, '') })}
                                    keyboardType="number-pad"
                                    placeholder="0"
                                    placeholderTextColor={COLORS.placeholder}
                                    testID="input-night-flight"
                                />
                            </View>
                            <View style={styles.roleTimeField}>
                                <Text style={styles.inputLabel}>仓乱 Instrument (分)</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={flight.instrumentRaw}
                                    onChangeText={v => updateFlight({ instrumentRaw: v.replace(/\D/g, '') })}
                                    keyboardType="number-pad"
                                    placeholder="0"
                                    placeholderTextColor={COLORS.placeholder}
                                    testID="input-instrument"
                                />
                            </View>
                        </View>
                    </View>

                    {renderRemarksSection()}
                </>
            )}

            {/* ── SIMULATOR Mode Fields ────────────────────────────────────── */}
            {dutyType === 'SIMULATOR' && (
                <>
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>模拟机信息</Text>

                        <View style={styles.row}>
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>SIM 编号</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={sim.simNo}
                                    onChangeText={v => updateSim({ simNo: v })}
                                    placeholder="SIM-01"
                                    placeholderTextColor={COLORS.placeholder}
                                    testID="input-sim-no"
                                />
                            </View>
                            <View style={styles.gap} />
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>SIM 等级 CAT</Text>
                                <OptionPicker
                                    label=""
                                    value={sim.simCat}
                                    onChange={v => updateSim({ simCat: v })}
                                    options={SIM_CAT_OPTIONS}
                                    testID="picker-sim-cat"
                                />
                            </View>
                        </View>

                        <View style={styles.row}>
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>训练机构</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={sim.trainingAgency}
                                    onChangeText={v => updateSim({ trainingAgency: v })}
                                    placeholder="CAFUC"
                                    placeholderTextColor={COLORS.placeholder}
                                    testID="input-training-agency"
                                />
                            </View>
                            <View style={styles.gap} />
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>训练类型</Text>
                                <OptionPicker
                                    label=""
                                    value={sim.trainingType}
                                    onChange={v => updateSim({ trainingType: v })}
                                    options={TRAINING_TYPE_OPTIONS}
                                    testID="picker-training-type"
                                />
                            </View>
                        </View>

                        {/* SIM From / To */}
                        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>训练时段</Text>
                        <View style={styles.timeAxisRow}>
                            <MaskedTimeInput
                                label="From"
                                value={sim.fromRaw}
                                onChange={v => updateSim({ fromRaw: v })}
                                onBlur={handleSimTimeBlur}
                                hasError={!!fieldError('off_time_utc')}
                            />
                            <View style={styles.simArrow}>
                                <Text style={styles.arrow}>→</Text>
                            </View>
                            <MaskedTimeInput
                                label="To"
                                value={sim.toRaw}
                                onChange={v => updateSim({ toRaw: v })}
                                onBlur={handleSimTimeBlur}
                                hasError={!!fieldError('on_time_utc')}
                            />
                        </View>

                        {blockTimeMin !== null && (
                            <View style={styles.blockTimeRow}>
                                <Text style={styles.blockTimeLabel}>Duty Time:</Text>
                                <Text style={styles.blockTimeValue}>
                                    {minutesToHHMM(blockTimeMin)}
                                </Text>
                            </View>
                        )}
                    </View>

                    {renderRemarksSection()}
                </>
            )}

            {/* ── Action Buttons ───────────────────────────────────────────── */}
            <View style={styles.actions}>
                <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={onCancel}
                    testID="btn-cancel"
                >
                    <Text style={styles.cancelText}>取消</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={handleSave}
                    testID="btn-save"
                >
                    <Text style={styles.saveText}>保存记录 →</Text>
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
};

// ─── Landing Counter Sub-Component ───────────────────────────────────────────

const LandingCounter: React.FC<{
    label: string;
    value: number;
    onChange: (v: number) => void;
    testIDBase: string;
}> = ({ label, value, onChange, testIDBase }) => (
    <View style={styles.counterContainer}>
        <Text style={styles.inputLabel}>{label}</Text>
        <View style={styles.counterRow}>
            <TouchableOpacity
                style={styles.counterBtn}
                onPress={() => onChange(Math.max(0, value - 1))}
                testID={`${testIDBase}-minus`}
            >
                <Text style={styles.counterBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.counterValue}>{value}</Text>
            <TouchableOpacity
                style={styles.counterBtn}
                onPress={() => onChange(value + 1)}
                testID={`${testIDBase}-plus`}
            >
                <Text style={styles.counterBtnText}>+</Text>
            </TouchableOpacity>
        </View>
    </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const COLORS = {
    primary: '#3B82F6',
    success: '#22C55E',
    error: '#EF4444',
    border: '#374151',
    background: '#111827',
    surface: '#1F2937',
    card: '#1F2937',
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    placeholder: '#4B5563',
    accent: '#60A5FA',
    required: '#F59E0B',
};

const styles = StyleSheet.create({
    scroll: { flex: 1, backgroundColor: COLORS.background },
    content: { padding: 16, paddingBottom: 40 },

    // Toggle
    toggleRow: {
        flexDirection: 'row',
        backgroundColor: COLORS.surface,
        borderRadius: 10,
        padding: 4,
        marginBottom: 20,
    },
    toggleBtn: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        borderRadius: 8,
    },
    toggleBtnActive: {
        backgroundColor: COLORS.primary,
        shadowColor: COLORS.primary,
        shadowOpacity: 0.5,
        shadowRadius: 8,
        elevation: 4,
    },
    toggleText: {
        color: COLORS.textSecondary,
        fontWeight: '600',
        fontSize: 14,
    },
    toggleTextActive: { color: '#FFFFFF' },

    // Section
    section: {
        backgroundColor: COLORS.card,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    sectionTitle: {
        color: COLORS.accent,
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 12,
    },
    sectionHint: {
        color: COLORS.textSecondary,
        fontSize: 11,
        marginBottom: 12,
        fontStyle: 'italic',
    },

    // Input fields
    row: { flexDirection: 'row', alignItems: 'flex-start' },
    gap: { width: 8 },
    flexField: { flex: 1 },
    roleTimeField: { flex: 1, marginRight: 8 },
    inputLabel: {
        color: COLORS.textSecondary,
        fontSize: 11,
        marginBottom: 4,
        fontWeight: '500',
    },
    textInput: {
        backgroundColor: COLORS.background,
        borderWidth: 1.5,
        borderColor: COLORS.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 10,
        color: COLORS.text,
        fontSize: 15,
        fontWeight: '500',
        marginBottom: 8,
    },
    inputError: { borderColor: COLORS.error },

    // Time axis
    timeAxisRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 8,
    },
    blockTimeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
    },
    blockTimeLabel: {
        color: COLORS.textSecondary,
        fontSize: 13,
        marginRight: 8,
    },
    blockTimeValue: {
        color: COLORS.success,
        fontSize: 22,
        fontWeight: '700',
        letterSpacing: 1,
    },
    inlineError: { color: COLORS.error, fontSize: 11, marginLeft: 8 },

    // Arrow
    arrow: { color: COLORS.textSecondary, fontSize: 18, paddingTop: 24 },
    simArrow: { justifyContent: 'center', paddingHorizontal: 4 },

    // Error banner
    errorBanner: {
        backgroundColor: '#450A0A',
        borderWidth: 1,
        borderColor: COLORS.error,
        borderRadius: 8,
        padding: 10,
        marginTop: 8,
    },
    errorBannerText: { color: COLORS.error, fontSize: 12, lineHeight: 18 },

    // Landing counter
    counterContainer: { flex: 1 },
    counterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.background,
        borderWidth: 1.5,
        borderColor: COLORS.border,
        borderRadius: 8,
        height: 48,
        overflow: 'hidden',
    },
    counterBtn: {
        width: 44,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLORS.surface,
    },
    counterBtnText: { color: COLORS.text, fontSize: 22, fontWeight: '300' },
    counterValue: {
        flex: 1,
        textAlign: 'center',
        color: COLORS.text,
        fontSize: 20,
        fontWeight: '600',
    },

    // Action buttons
    actions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 8,
        gap: 12,
    },
    cancelBtn: {
        flex: 1,
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: COLORS.border,
    },
    cancelText: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '600' },
    saveBtn: {
        flex: 2,
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: 12,
        backgroundColor: COLORS.primary,
    },
    saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

export default DualTrackForm;
