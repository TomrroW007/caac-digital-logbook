/**
 * @file components/EntryForm/DualTrackForm.tsx
 * @description Dual-track entry form: FLIGHT / SIMULATOR toggle with dynamic field rendering.
 *
 * Implements PRD §3.1: top-level DUTY selector that auto-purges dirty data on switch.
 * Implements PRD §3.2: FLIGHT mode — four-point time axis, 10-5 auto-fill, compliance guard.
 * Implements PRD §3.3: SIMULATOR mode — SIM-specific fields, From/To time controls.
 * Implements PRD §4.1: blocks save when role-time sum > block time.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Alert,
    ActivityIndicator,
} from 'react-native';

import MaskedTimeInput from '../shared/MaskedTimeInput';
import { OptionPicker } from '../shared/OptionPicker';
import { resolveFourTimePoints } from '../../utils/FlightMath';
import { validateFlightRecord, type FlightRecordInput } from '../../utils/ComplianceValidator';
import { lookupAirportOffset, isDstObservingRegion } from '../../data/airportTimezones';
import { localTimeToUtcISO, isNightHintTime } from '../../utils/TimeCalculator';
import { minutesToHHMM } from '../../utils/TimeCalculator';
import type { LogbookRecord } from '../../model/LogbookRecord';
import type { CapacityRole } from '../../model/schema';
import { fetchFlightInfo } from '../../utils/ApiService';

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
    // 容量角色（座位角色）— determines which time bucket block time flows into
    capacityRole: CapacityRole | '';
    picRaw: string;       // PIC minutes
    picUsRaw: string;     // PIC U/S (機长受监视) minutes
    spicRaw: string;      // SPIC (见习機长) minutes
    sicRaw: string;       // SIC minutes
    dualRaw: string;
    instructorRaw: string;
    // 操纵角色（PF 或 PM）— independent from capacity role
    pilotRole: 'PF' | 'PM' | '';
    approachType: string;
    dayTo: number;
    nightTo: number;
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
    { label: 'ILS CAT I', value: 'ILS CAT I' },
    { label: 'ILS CAT II', value: 'ILS CAT II' },
    { label: 'ILS CAT III', value: 'ILS CAT III' },
    { label: 'RNP AR', value: 'RNP AR' },
    { label: 'RNAV (GNSS)', value: 'RNAV (GNSS)' },
    { label: 'VOR', value: 'VOR' },
    { label: 'NDB', value: 'NDB' },
    { label: '目视 Visual', value: 'Visual' },
];

const SIM_CAT_OPTIONS = [
    { label: 'FNPT I', value: 'FNPT I' },
    { label: 'FNPT II', value: 'FNPT II' },
    { label: 'FFS Level B', value: 'FFS Level B' },
    { label: 'FFS Level C', value: 'FFS Level C' },
    { label: 'FFS Level D', value: 'FFS Level D' },
];

const TRAINING_TYPE_OPTIONS = [
    { label: 'OPC', value: 'OPC' },
    { label: 'LPC', value: 'LPC' },
    { label: 'PC', value: 'PC' },
    { label: 'IR', value: 'IR' },
    { label: 'Base Training', value: 'Base Training' },
    { label: 'Line Training', value: 'Line Training' },
    { label: 'Type Rating', value: 'Type Rating' },
];

// ─── Initial States ───────────────────────────────────────────────────────────

const EMPTY_FLIGHT: FlightFields = {
    flightNo: '', depIcao: '', arrIcao: '',
    offRaw: '', toRaw: '', ldgRaw: '', onRaw: '',
    capacityRole: '',
    picRaw: '', picUsRaw: '', spicRaw: '', sicRaw: '',
    dualRaw: '', instructorRaw: '',
    pilotRole: '', approachType: '',
    dayTo: 0, nightTo: 0,
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
    /** PF or PM — manipulation role (who is on the controls) */
    pilotRole: 'PF' | 'PM' | null;
    /** Seat/capacity role — determines which experience-time bucket was filled */
    capacityRole: CapacityRole | null;
    picUsMin: number;
    spicMin: number;
    dayTo: number;
    nightTo: number;
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
            // Infer capacity role from which time bucket is filled
            capacityRole: existingRecord.safePicUsMin > 0 ? 'PIC_US'
                : existingRecord.safeSpicMin > 0 ? 'SPIC'
                    : existingRecord.sicMin > 0 ? 'SIC'
                        : existingRecord.picMin > 0 ? 'PIC'
                            : '',
            picRaw: existingRecord.picMin > 0 ? String(existingRecord.picMin) : '',
            picUsRaw: existingRecord.safePicUsMin > 0 ? String(existingRecord.safePicUsMin) : '',
            spicRaw: existingRecord.safeSpicMin > 0 ? String(existingRecord.safeSpicMin) : '',
            sicRaw: existingRecord.sicMin > 0 ? String(existingRecord.sicMin) : '',
            dualRaw: existingRecord.dualMin > 0 ? String(existingRecord.dualMin) : '',
            instructorRaw: existingRecord.instructorMin > 0 ? String(existingRecord.instructorMin) : '',
            pilotRole: (existingRecord.pilotRole === 'PF' || existingRecord.pilotRole === 'PM')
                ? existingRecord.pilotRole : '',
            approachType: existingRecord.approachType ?? '',
            dayTo: existingRecord.safeDayTo,
            nightTo: existingRecord.safeNightTo,
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

    // ── DST Override Offsets (one per airport direction) ─────────────────────
    // Initialised from the timezone dictionary. Pilot can ±60m for DST.
    const [depOffsetOverride, setDepOffsetOverride] = useState<number>(
        lookupAirportOffset(existingRecord?.depIcao ?? '')
    );
    const [arrOffsetOverride, setArrOffsetOverride] = useState<number>(
        lookupAirportOffset(existingRecord?.arrIcao ?? '')
    );
    // Which airports currently trigger the DST warning banner
    const depHasDst = flight.depIcao.length === 4 && isDstObservingRegion(flight.depIcao);
    const arrHasDst = flight.arrIcao.length === 4 && isDstObservingRegion(flight.arrIcao);

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
        // PRD §3.1: purge mode-specific data on toggle.
        // QA-mandated: dayTo/nightTo MUST also reset to 0 on DUTY switch.
        if (next === 'SIMULATOR') {
            setFlight(EMPTY_FLIGHT); // EMPTY_FLIGHT.dayTo = 0, .nightTo = 0
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

        // Use DST-override offsets (pilot-confirmed) — not raw dictionary lookup.
        // This ensures DST adjustments are reflected in UTC conversions.
        const toUtcISO = flight.toRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.toRaw, depOffsetOverride)
            : null;
        const ldgUtcISO = flight.ldgRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.ldgRaw, arrOffsetOverride)
            : null;
        const offUtcISO = flight.offRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.offRaw, depOffsetOverride)
            : null;
        const onUtcISO = flight.onRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.onRaw, arrOffsetOverride)
            : null;

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
    }, [flight, shared.actlDate, depOffsetOverride, arrOffsetOverride]);

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

        // Use DST-override offsets (may differ from dictionary defaults after pilot adjustment)
        const offUtcISO = flight.offRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.offRaw, depOffsetOverride) : null;
        const onUtcISO = flight.onRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.onRaw, arrOffsetOverride) : null;
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
            picUsMin: parseMins(flight.picUsRaw),
            spicMin: parseMins(flight.spicRaw),
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
            const errMap: Record<string, string> = {};
            result.errors.forEach(e => { errMap[e.field] = e.message; });
            setErrors(errMap);
            Alert.alert(
                '保存失败',
                `存在 ${result.errors.length} 项不符合要求的内容，请检查标注字段后重新保存。`,
                [{ text: '确认', style: 'default' }]
            );
            return;
        }

        setErrors({});

        const toUtcISO = flight.toRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.toRaw, depOffsetOverride) : null;
        const ldgUtcISO = flight.ldgRaw.length === 4
            ? localTimeToUtcISO(aDate, flight.ldgRaw, arrOffsetOverride) : null;

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
            pilotRole: dutyType === 'FLIGHT' ? (flight.pilotRole as 'PF' | 'PM' | null || null) : null,
            capacityRole: dutyType === 'FLIGHT' ? (flight.capacityRole as CapacityRole || null) : null,
            picUsMin: dutyType === 'FLIGHT' ? parseMins(flight.picUsRaw) : 0,
            spicMin: dutyType === 'FLIGHT' ? parseMins(flight.spicRaw) : 0,
            dayTo: dutyType === 'FLIGHT' ? flight.dayTo : 0,
            nightTo: dutyType === 'FLIGHT' ? flight.nightTo : 0,
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

    // ── Capacity Role Selection with Block Time Auto-Fill ──────────────────────
    /**
     * When pilot selects a capacity role, automatically fills the corresponding
     * time field with the current block time (one-tap entry per PRD requirement).
     */
    const handleCapacityRoleSelect = (role: CapacityRole | '') => {
        if (!role || blockTimeMin === null) {
            updateFlight({ capacityRole: role });
            return;
        }
        const bt = String(blockTimeMin);
        switch (role) {
            case 'PIC': updateFlight({ capacityRole: role, picRaw: bt, picUsRaw: '', spicRaw: '', sicRaw: '' }); break;
            case 'PIC_US': updateFlight({ capacityRole: role, picUsRaw: bt, picRaw: '', spicRaw: '', sicRaw: '' }); break;
            case 'SPIC': updateFlight({ capacityRole: role, spicRaw: bt, picRaw: '', picUsRaw: '', sicRaw: '' }); break;
            case 'SIC': updateFlight({ capacityRole: role, sicRaw: bt, picRaw: '', picUsRaw: '', spicRaw: '' }); break;
        }
    };

    // ── Night-hint: show 🌙 when LDG or ON is after 19:00 ────────────────────
    const showNightHint = isNightHintTime(flight.ldgRaw) || isNightHintTime(flight.onRaw);

    // ── Flight number auto-fill (Phase 6) ────────────────────────────────────
    const [fetchingFlight, setFetchingFlight] = useState(false);
    const [fetchSuccess, setFetchSuccess] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // Cleanup: abort any in-flight fetch when component unmounts
    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    const handleFlightNoBlur = useCallback(async () => {
        const fno = flight.flightNo;
        const date = shared.actlDate;

        // Gate: need FLIGHT mode, ≥4 chars, and a date
        if (dutyType !== 'FLIGHT' || fno.length < 4 || !date) return;

        // Abort any previous in-flight request
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setFetchingFlight(true);
        setFetchSuccess(false);

        const info = await fetchFlightInfo(fno, date, controller.signal);

        // Guard: component may have unmounted or request was superseded
        if (controller.signal.aborted) return;

        setFetchingFlight(false);

        if (!info) return; // Silent degradation — no error shown

        // Only fill EMPTY fields — never overwrite user input (SME red line)
        const updates: Partial<FlightFields> = {};
        if (!flight.depIcao && info.depIcao) updates.depIcao = info.depIcao;
        if (!flight.arrIcao && info.arrIcao) updates.arrIcao = info.arrIcao;

        const sharedUpdates: Partial<SharedFields> = {};
        if (!shared.acftType && info.acftType) sharedUpdates.acftType = info.acftType;
        if (!shared.regNo && info.regNo) sharedUpdates.regNo = info.regNo;

        if (Object.keys(updates).length > 0) updateFlight(updates);
        if (Object.keys(sharedUpdates).length > 0) updateShared(sharedUpdates);

        // Show success icon briefly
        if (Object.keys(updates).length > 0 || Object.keys(sharedUpdates).length > 0) {
            setFetchSuccess(true);
            setTimeout(() => setFetchSuccess(false), 2000);
        }
    }, [flight.flightNo, flight.depIcao, flight.arrIcao, shared.actlDate, shared.acftType, shared.regNo, dutyType, updateFlight, updateShared]);

    // ── Remarks section (shared across both duty tracks) ─────────────────────
    const renderRemarksSection = () => (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>备注 Remarks</Text>
            <TextInput
                style={[styles.textInput, { height: 72, textAlignVertical: 'top' }]}
                value={shared.remarks}
                onChangeText={v => updateShared({ remarks: v })}
                placeholder="备注（可选）"
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

            {/* ── Header: title + SIMULATOR secondary entry ─────────────────── */}
            <View style={styles.formHeader}>
                <Text style={styles.formHeaderTitle}>
                    {dutyType === 'FLIGHT' ? '✈ 经历时间 Experience' : '🖥 模拟机 Simulator'}
                </Text>
                <TouchableOpacity
                    style={[
                        styles.simToggleBtn,
                        dutyType === 'SIMULATOR' && styles.simToggleBtnActive,
                    ]}
                    onPress={() => handleDutyTypeChange(dutyType === 'SIMULATOR' ? 'FLIGHT' : 'SIMULATOR')}
                    testID="duty-toggle-simulator"
                >
                    <Text style={[
                        styles.simToggleText,
                        dutyType === 'SIMULATOR' && styles.simToggleTextActive,
                    ]}>
                        {dutyType === 'SIMULATOR' ? '✈ 切回飞行' : '🖥 模拟机'}
                    </Text>
                </TouchableOpacity>
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
                        <Text style={styles.inputLabel}>登记号 Reg No.</Text>
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
                                <Text style={styles.inputLabel}>出发站 DEP</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={flight.depIcao}
                                    onChangeText={v => {
                                        const icao = v.toUpperCase();
                                        updateFlight({ depIcao: icao });
                                        // Auto-sync the offset state; pilot can override below
                                        if (icao.length === 4) setDepOffsetOverride(lookupAirportOffset(icao));
                                    }}
                                    placeholder="ZBAA"
                                    placeholderTextColor={COLORS.placeholder}
                                    maxLength={4}
                                    autoCapitalize="characters"
                                    testID="input-dep-icao"
                                />
                            </View>
                            <Text style={styles.arrow}>→</Text>
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>到达站 ARR</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={flight.arrIcao}
                                    onChangeText={v => {
                                        const icao = v.toUpperCase();
                                        updateFlight({ arrIcao: icao });
                                        if (icao.length === 4) setArrOffsetOverride(lookupAirportOffset(icao));
                                    }}
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
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <TextInput
                                        style={[styles.textInput, { flex: 1 }]}
                                        value={flight.flightNo}
                                        onChangeText={v => updateFlight({ flightNo: v.toUpperCase() })}
                                        onBlur={handleFlightNoBlur}
                                        placeholder="CA1501"
                                        placeholderTextColor={COLORS.placeholder}
                                        autoCapitalize="characters"
                                        testID="input-flight-no"
                                    />
                                    {fetchingFlight && (
                                        <ActivityIndicator
                                            size="small"
                                            color={COLORS.placeholder}
                                            style={{ marginLeft: 6 }}
                                        />
                                    )}
                                    {fetchSuccess && (
                                        <Text style={{ marginLeft: 6, fontSize: 16 }}>✨</Text>
                                    )}
                                </View>
                            </View>
                        </View>

                        {/* DST Override — shown when DEP or ARR is in a DST-observing region */}
                        {(depHasDst || arrHasDst) && (
                            <View style={styles.dstBanner}>
                                <Text style={styles.dstBannerTitle}>
                                    💡 时差提示：可能实行夏令时 (DST)
                                </Text>
                                <Text style={styles.dstBannerText}>
                                    系统推算 UTC 偏移量仅供参考，请核对并按需微调 ⏷。
                                </Text>
                                {depHasDst && (
                                    <View style={styles.dstOffsetRow}>
                                        <Text style={styles.dstOffsetLabel}>
                                            DEP {flight.depIcao} 偏移:
                                            {depOffsetOverride >= 0 ? ' UTC+' : ' UTC'}
                                            {(depOffsetOverride / 60).toFixed(1)}h
                                        </Text>
                                        <TouchableOpacity
                                            style={styles.dstStepBtn}
                                            onPress={() => setDepOffsetOverride(v => v - 60)}
                                            testID="dep-dst-minus"
                                        >
                                            <Text style={styles.dstStepText}>−1h</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.dstStepBtn}
                                            onPress={() => setDepOffsetOverride(v => v + 60)}
                                            testID="dep-dst-plus"
                                        >
                                            <Text style={styles.dstStepText}>+1h</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                                {arrHasDst && (
                                    <View style={styles.dstOffsetRow}>
                                        <Text style={styles.dstOffsetLabel}>
                                            ARR {flight.arrIcao} 偏移:
                                            {arrOffsetOverride >= 0 ? ' UTC+' : ' UTC'}
                                            {(arrOffsetOverride / 60).toFixed(1)}h
                                        </Text>
                                        <TouchableOpacity
                                            style={styles.dstStepBtn}
                                            onPress={() => setArrOffsetOverride(v => v - 60)}
                                            testID="arr-dst-minus"
                                        >
                                            <Text style={styles.dstStepText}>−1h</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.dstStepBtn}
                                            onPress={() => setArrOffsetOverride(v => v + 60)}
                                            testID="arr-dst-plus"
                                        >
                                            <Text style={styles.dstStepText}>+1h</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>
                        )}
                    </View>

                    {/* Four-Point Time Axis */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>时刻（当地时间 LT）</Text>
                        <Text style={styles.sectionHint}>
                            填写起飞 (T/O) / 着陆 (LDG) 时刻后，滑出 (OFF) / 滑入 (ON) 时刻将自动推算（±10/5 分钟）
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
                                label="T/O"
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
                                <Text style={styles.blockTimeLabel}>飞行时间（Block Time）：</Text>
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
                        <Text style={styles.sectionTitle}>经历时间 Experience</Text>
                        <Text style={styles.sectionHint}>
                            经历时间各项之和不得超过飞行时间（Block Time）
                        </Text>

                        {/* ── My Role: capacity role selector + PF/PM toggle ── */}
                        <View style={styles.myRoleCard}>
                            <Text style={styles.myRoleTitle}>我的角色 My Role</Text>
                            <Text style={styles.myRoleHint}>
                                选择角色后，飞行时间（Block Time）将自动填入对应字段（可手动修改）
                            </Text>

                            {/* 4-way capacity role selector */}
                            <View style={styles.capacityRoleRow}>
                                {([
                                    { role: 'PIC', label: 'PIC', sub: '机长' },
                                    { role: 'PIC_US', label: 'PIC U/S', sub: '监视下履行机长职责' },
                                    { role: 'SPIC', label: 'SPIC', sub: '见习机长' },
                                    { role: 'SIC', label: 'SIC', sub: '副驾驶' },
                                ] as { role: CapacityRole; label: string; sub: string }[]).map(({ role, label, sub }) => (
                                    <TouchableOpacity
                                        key={role}
                                        style={[
                                            styles.capacityRoleBtn,
                                            flight.capacityRole === role && styles.capacityRoleBtnActive,
                                        ]}
                                        onPress={() => handleCapacityRoleSelect(role)}
                                        testID={`capacity-role-${role.toLowerCase()}`}
                                    >
                                        <Text style={[
                                            styles.capacityRoleBtnLabel,
                                            flight.capacityRole === role && styles.capacityRoleBtnLabelActive,
                                        ]}>
                                            {label}
                                        </Text>
                                        <Text style={[
                                            styles.capacityRoleBtnSub,
                                            flight.capacityRole === role && styles.capacityRoleBtnSubActive,
                                        ]}>
                                            {sub}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* PF / PM toggle — manipulation role, independent */}
                            <View style={styles.pfPmRow}>
                                <Text style={styles.pfPmLabel}>操纵职责（可叠选）</Text>
                                <View style={styles.pfPmBtns}>
                                    {(['PF', 'PM'] as const).map(r => (
                                        <TouchableOpacity
                                            key={r}
                                            style={[
                                                styles.pfPmBtn,
                                                flight.pilotRole === r && styles.pfPmBtnActive,
                                            ]}
                                            onPress={() => updateFlight({
                                                pilotRole: flight.pilotRole === r ? '' : r,
                                            })}
                                            testID={`pilot-role-${r.toLowerCase()}`}
                                        >
                                            <Text style={[
                                                styles.pfPmBtnText,
                                                flight.pilotRole === r && styles.pfPmBtnTextActive,
                                            ]}>
                                                {r === 'PF' ? '操纵驾驶员（PF）' : '监控驾驶员（PM）'}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        </View>

                        {/* ── Time buckets (all 6 fields visible, matching role highlighted) ── */}
                        <View style={styles.row}>
                            {([
                                { key: 'picRaw', role: 'PIC', label: '机长 PIC', testID: 'input-pic', errKey: 'pic_min' },
                                { key: 'picUsRaw', role: 'PIC_US', label: 'PIC U/S', testID: 'input-pic-us', errKey: undefined },
                                { key: 'spicRaw', role: 'SPIC', label: '见习机长 SPIC', testID: 'input-spic', errKey: undefined },
                            ] as { key: keyof FlightFields; role: CapacityRole; label: string; testID: string; errKey?: string }[]).map(({ key, role, label, testID, errKey }) => (
                                <View key={key} style={styles.roleTimeField}>
                                    <Text style={[
                                        styles.inputLabel,
                                        flight.capacityRole === role && styles.inputLabelHighlight,
                                    ]}>
                                        {label} (分)
                                    </Text>
                                    <TextInput
                                        style={[
                                            styles.textInput,
                                            errKey && fieldError(errKey) && styles.inputError,
                                            flight.capacityRole === role && styles.roleTimeHighlight,
                                        ]}
                                        value={flight[key] as string}
                                        onChangeText={v => updateFlight({ [key]: v.replace(/\D/g, '') })}
                                        keyboardType="number-pad"
                                        placeholder="0"
                                        placeholderTextColor={COLORS.placeholder}
                                        testID={testID}
                                    />
                                </View>
                            ))}
                        </View>
                        <View style={styles.row}>
                            {([
                                { key: 'sicRaw', role: 'SIC', label: '副驾驶 SIC', testID: 'input-sic', errKey: undefined },
                                { key: 'dualRaw', role: null, label: '带飞 Dual', testID: 'input-dual', errKey: undefined },
                                { key: 'instructorRaw', role: null, label: '教员 Instructor', testID: 'input-instructor', errKey: undefined },
                            ] as { key: keyof FlightFields; role: CapacityRole | null; label: string; testID: string; errKey?: string }[]).map(({ key, role, label, testID }) => (
                                <View key={key} style={styles.roleTimeField}>
                                    <Text style={[
                                        styles.inputLabel,
                                        role && flight.capacityRole === role && styles.inputLabelHighlight,
                                    ]}>
                                        {label} (分)
                                    </Text>
                                    <TextInput
                                        style={[
                                            styles.textInput,
                                            role && flight.capacityRole === role && styles.roleTimeHighlight,
                                        ]}
                                        value={flight[key] as string}
                                        onChangeText={v => updateFlight({ [key]: v.replace(/\D/g, '') })}
                                        keyboardType="number-pad"
                                        placeholder="0"
                                        placeholderTextColor={COLORS.placeholder}
                                        testID={testID}
                                    />
                                </View>
                            ))}
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

                    {/* Approach Type (moved out of old "Role & Approach" section) */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>进近方式 Approach Type</Text>
                        <OptionPicker
                            label=""
                            value={flight.approachType}
                            onChange={v => updateFlight({ approachType: v })}
                            options={APPROACH_TYPE_OPTIONS}
                            testID="picker-approach-type"
                        />
                    </View>

                    {/* Takeoffs & Landings — 2×2 grid per SME recommendation */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>起飞/着陆次数</Text>
                        <Text style={styles.sectionHint}>起飞/着陆各按昼夜分别记录（CCAR-61 标准格式）</Text>
                        <View style={styles.row}>
                            <LandingCounter
                                label="昼间起飞 Day T/O"
                                value={flight.dayTo}
                                onChange={v => updateFlight({ dayTo: v })}
                                testIDBase="day-to"
                            />
                            <View style={styles.gap} />
                            <LandingCounter
                                label="夜间起飞 Night T/O"
                                value={flight.nightTo}
                                onChange={v => updateFlight({ nightTo: v })}
                                testIDBase="night-to"
                            />
                        </View>
                        <View style={[styles.row, { marginTop: 8 }]}>
                            <LandingCounter
                                label="昼间着陆（Day LDG）"
                                value={flight.dayLdg}
                                onChange={v => updateFlight({ dayLdg: v })}
                                testIDBase="day-ldg"
                            />
                            <View style={styles.gap} />
                            <LandingCounter
                                label="夜间着陆（Night LDG）"
                                value={flight.nightLdg}
                                onChange={v => updateFlight({ nightLdg: v })}
                                testIDBase="night-ldg"
                            />
                        </View>
                    </View>

                    {/* Special Times */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>特殊时间 Special Times</Text>
                        <Text style={styles.sectionHint}>夜航和仪表时间与飞行时间 (Block Time) 可重叠，不入合规公式计算</Text>
                        <View style={styles.row}>
                            <View style={styles.roleTimeField}>
                                {/* PRD §3.2: 🌙 label icon + amber border when LDG/ON ≥ 19:00 LT */}
                                <Text style={styles.inputLabel}>
                                    {showNightHint ? '🌙 夜航 Night (分) (建议填写)' : '夜航 Night (分)'}
                                </Text>
                                <TextInput
                                    style={[
                                        styles.textInput,
                                        showNightHint && styles.nightHintInput,
                                    ]}
                                    value={flight.nightFlightRaw}
                                    onChangeText={v => updateFlight({ nightFlightRaw: v.replace(/\D/g, '') })}
                                    keyboardType="number-pad"
                                    placeholder="0"
                                    placeholderTextColor={COLORS.placeholder}
                                    testID="input-night-flight"
                                />
                            </View>
                            <View style={styles.roleTimeField}>
                                <Text style={styles.inputLabel}>仪表 Instrument (分)</Text>
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
                                <Text style={styles.inputLabel}>模拟机编号 SIM No.</Text>
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
                                <Text style={styles.inputLabel}>FSTD 鉴定等级</Text>
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
                                <Text style={styles.inputLabel}>训练种类 Training Type</Text>
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
                                label="起始"
                                value={sim.fromRaw}
                                onChange={v => updateSim({ fromRaw: v })}
                                onBlur={handleSimTimeBlur}
                                hasError={!!fieldError('off_time_utc')}
                            />
                            <View style={styles.simArrow}>
                                <Text style={styles.arrow}>→</Text>
                            </View>
                            <MaskedTimeInput
                                label="结束"
                                value={sim.toRaw}
                                onChange={v => updateSim({ toRaw: v })}
                                onBlur={handleSimTimeBlur}
                                hasError={!!fieldError('on_time_utc')}
                            />
                        </View>

                        {blockTimeMin !== null && (
                            <View style={styles.blockTimeRow}>
                                <Text style={styles.blockTimeLabel}>训练时长：</Text>
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
    warning: '#F59E0B',
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

    // ── Form Header (replaces big segmented control) ──────────────────────────
    formHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    formHeaderTitle: {
        color: COLORS.text,
        fontSize: 18,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    // Small secondary SIMULATOR entry button (top-right corner)
    simToggleBtn: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.surface,
    },
    simToggleBtnActive: {
        borderColor: COLORS.primary,
        backgroundColor: '#1E3A5F',
    },
    simToggleText: {
        color: COLORS.textSecondary,
        fontSize: 12,
        fontWeight: '600',
    },
    simToggleTextActive: {
        color: COLORS.accent,
    },

    // ── My Role Card ─────────────────────────────────────────────────────────
    myRoleCard: {
        backgroundColor: '#0F172A',
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1.5,
        borderColor: '#2563EB',
    },
    myRoleTitle: {
        color: '#93C5FD',
        fontSize: 13,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 4,
    },
    myRoleHint: {
        color: COLORS.textSecondary,
        fontSize: 11,
        fontStyle: 'italic',
        marginBottom: 12,
        lineHeight: 16,
    },

    // 4-way capacity role pills
    capacityRoleRow: {
        flexDirection: 'row',
        gap: 6,
        marginBottom: 12,
    },
    capacityRoleBtn: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.surface,
    },
    capacityRoleBtnActive: {
        borderColor: '#3B82F6',
        backgroundColor: '#1E3A5F',
        shadowColor: '#3B82F6',
        shadowOpacity: 0.5,
        shadowRadius: 6,
        elevation: 4,
    },
    capacityRoleBtnLabel: {
        color: COLORS.textSecondary,
        fontSize: 13,
        fontWeight: '700',
    },
    capacityRoleBtnLabelActive: {
        color: '#DBEAFE',
    },
    capacityRoleBtnSub: {
        color: COLORS.placeholder,
        fontSize: 9,
        marginTop: 2,
    },
    capacityRoleBtnSubActive: {
        color: '#93C5FD',
    },

    // PF / PM toggle row
    pfPmRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    pfPmLabel: {
        color: COLORS.textSecondary,
        fontSize: 11,
        fontWeight: '500',
        flex: 1,
    },
    pfPmBtns: {
        flexDirection: 'row',
        gap: 8,
    },
    pfPmBtn: {
        paddingHorizontal: 16,
        paddingVertical: 7,
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.surface,
    },
    pfPmBtnActive: {
        borderColor: '#10B981',
        backgroundColor: '#064E3B',
    },
    pfPmBtnText: {
        color: COLORS.textSecondary,
        fontSize: 12,
        fontWeight: '700',
    },
    pfPmBtnTextActive: {
        color: '#6EE7B7',
    },

    // Highlighted input when it matches the selected capacity role
    inputLabelHighlight: {
        color: '#60A5FA',
    },
    roleTimeHighlight: {
        borderColor: '#3B82F6',
        shadowColor: '#3B82F6',
        shadowOpacity: 0.4,
        shadowRadius: 5,
        elevation: 3,
    },

    // Toggle (kept for legacy reference, no longer rendered)
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

    // Night hint input style (amber border + subtle glow)
    nightHintInput: {
        borderColor: '#F59E0B',
        shadowColor: '#F59E0B',
        shadowOpacity: 0.35,
        shadowRadius: 6,
        elevation: 3,
    },

    // PICUS quick-append button
    picusBtn: {
        alignSelf: 'flex-start',
        marginTop: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#60A5FA',
        backgroundColor: '#1E3A5F',
    },
    picusBtnText: { color: '#93C5FD', fontSize: 12, fontWeight: '700' },

    // DST Banner
    dstBanner: {
        marginTop: 12,
        padding: 12,
        borderRadius: 8,
        backgroundColor: '#422006',
        borderWidth: 1,
        borderColor: '#F59E0B',
    },
    dstBannerTitle: {
        color: '#FCD34D',
        fontWeight: '700',
        fontSize: 12,
        marginBottom: 4,
    },
    dstBannerText: {
        color: '#FDE68A',
        fontSize: 11,
        lineHeight: 16,
        marginBottom: 8,
    },
    dstOffsetRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        gap: 8,
    },
    dstOffsetLabel: {
        flex: 1,
        color: '#FCD34D',
        fontSize: 12,
        fontWeight: '600',
    },
    dstStepBtn: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: '#78350F',
        borderWidth: 1,
        borderColor: '#F59E0B',
    },
    dstStepText: { color: '#FCD34D', fontSize: 13, fontWeight: '700' },

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
