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
import { SmartDatePicker } from '../shared/SmartDatePicker';
import { resolveFourTimePoints, calcFlightTimeMin } from '../../utils/FlightMath';
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

// ─── Aircraft Type Presets (CCAR-61 Chinese commercial aviation + 巴航工业) ─────
export type PresetCategory = {
    label: string;
    items: string[];
};

const ACFT_TYPE_CATEGORIES: PresetCategory[] = [
    {
        label: 'Airbus',
        items: ['A319', 'A320', 'A321', 'A321NEO', 'A330-200', 'A330-300', 'A350-900', 'A380']
    },
    {
        label: 'Boeing',
        items: ['B737-800', 'B737MAX8', 'B777-200', 'B777-300ER', 'B787-9']
    },
    {
        label: 'Others',
        items: ['C919', 'ARJ21', 'E175', 'E190', 'E195', 'ATR72', 'CRJ900']
    }
];

const APPROACH_TYPE_OPTIONS = [
    { label: 'ILS CAT I', value: 'ILS CAT I' },
    { label: 'ILS CAT II', value: 'ILS CAT II' },
    { label: 'ILS CAT III', value: 'ILS CAT III' },
    { label: 'RNP AR', value: 'RNP AR' },
    { label: 'RNAV (GNSS)', value: 'RNAV (GNSS)' },
    { label: 'VOR', value: 'VOR' },
    { label: 'NDB', value: 'NDB' },
    { label: 'Visual', value: 'Visual' },
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
    // Computed air time (TO → LDG, cross-midnight safe) — null until both TO and LDG are present
    const [airTimeMin, setAirTimeMin] = useState<number | null>(null);
    // Whether pilot is manually overriding the auto-computed landing counts
    const [isManualLandings, setIsManualLandings] = useState(false);
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
            setAirTimeMin(null);
            setIsManualLandings(false);
        } else {
            setSim(EMPTY_SIM);
            setBlockTimeMin(null);
            setAirTimeMin(null);
            setIsManualLandings(false);
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

        // Air time: always recompute from TO+LDG whenever either changes.
        // calcFlightTimeMin handles cross-midnight correctly (via Phase 2 engine).
        // Stays null (shows --:--) until both TO and LDG are present — QA air-time空值测试.
        if (toUtcISO && ldgUtcISO) {
            try { setAirTimeMin(calcFlightTimeMin(toUtcISO, ldgUtcISO)); }
            catch { setAirTimeMin(null); }
        } else {
            setAirTimeMin(null);
        }

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
                'Save Failed',
                `${result.errors.length} field(s) require attention. Please review the highlighted fields and try again.`,
                [{ text: 'OK', style: 'default' }]
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
            regNo: dutyType === 'FLIGHT' ? (shared.regNo || null) : null,
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

    // ── PF/PM Auto-Landing Linkage (Phase 8) ─────────────────────────────────
    // When PF is selected, auto-computes 1 day or night takeoff+landing based on
    // isNightHintTime(LDG/ON). When isManualLandings switches back to false, the
    // effect fires again and resets the counters (handles 状态回滚 QA test case).
    // SCOPE GUARD: must NOT run in SIMULATOR mode — sim takeoffs don't count.
    useEffect(() => {
        if (dutyType !== 'FLIGHT') return;
        if (isManualLandings) return;
        const isNight = isNightHintTime(flight.ldgRaw) || isNightHintTime(flight.onRaw);
        if (flight.pilotRole === 'PF') {
            setFlight(prev => ({
                ...prev,
                dayTo: isNight ? 0 : 1,
                nightTo: isNight ? 1 : 0,
                dayLdg: isNight ? 0 : 1,
                nightLdg: isNight ? 1 : 0,
            }));
        } else if (flight.pilotRole === 'PM') {
            setFlight(prev => ({ ...prev, dayTo: 0, nightTo: 0, dayLdg: 0, nightLdg: 0 }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flight.pilotRole, flight.ldgRaw, flight.onRaw, isManualLandings, dutyType]);

    const handleFlightNoBlur = useCallback(async () => {
        // ── Clean flight number in UI (QA: "mu 5428" → "MU5428") ─────────
        const cleaned = flight.flightNo.replace(/\s+/g, '').toUpperCase();
        if (cleaned !== flight.flightNo) {
            updateFlight({ flightNo: cleaned });
        }

        const date = shared.actlDate;

        // Gate: need FLIGHT mode, ≥4 chars, and a date
        if (dutyType !== 'FLIGHT' || cleaned.length < 4 || !date) return;

        // Abort any previous in-flight request
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setFetchingFlight(true);
        setFetchSuccess(false);

        const info = await fetchFlightInfo(cleaned, date, controller.signal);

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
            <Text style={styles.sectionTitle}>Remarks</Text>
            <TextInput
                style={[styles.textInput, { height: 72, textAlignVertical: 'top' }]}
                value={shared.remarks}
                onChangeText={v => updateShared({ remarks: v })}
                placeholder="Remarks (optional)"
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
                    {dutyType === 'FLIGHT' ? '✈ Experience' : '🖥 Simulator'}
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
                        {dutyType === 'SIMULATOR' ? '✈ Flight' : '🖥 Simulator'}
                    </Text>
                </TouchableOpacity>
            </View>

            {/* ── Shared Fields ────────────────────────────────────────────── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Basic Info</Text>

                {/* Row 1: Dates + Flight No (FLIGHT only — placed here to trigger API early) */}
                <View style={styles.row}>
                    <View style={styles.flexField}>
                        <Text style={styles.inputLabel}>Schd Date</Text>
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
                        <Text style={styles.inputLabel}>
                            Actl Date *{'  '}
                            <Text style={styles.dateEchoText}>{shared.actlDate}</Text>
                        </Text>
                        <SmartDatePicker
                            value={shared.actlDate}
                            onChange={v => updateShared({ actlDate: v })}
                            hasError={!!fieldError('actl_date')}
                        />
                    </View>
                    {dutyType === 'FLIGHT' && (
                        <>
                            <View style={styles.gap} />
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>Flight No.</Text>
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
                        </>
                    )}
                </View>

                <View style={styles.row}>
                    <View style={styles.flexField}>
                        <Text style={[styles.inputLabel, fieldError('acft_type') && { color: COLORS.error }]}>
                            A/C Type *
                        </Text>
                        <ComboInput
                            value={shared.acftType}
                            onChange={v => updateShared({ acftType: v })}
                            categorizedPresets={ACFT_TYPE_CATEGORIES}
                            placeholder="A320"
                            hasError={!!fieldError('acft_type')}
                            testID="input-acft-type"
                        />
                    </View>
                    {dutyType === 'FLIGHT' && (
                        <>
                            <View style={styles.gap} />
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>Reg No.</Text>
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
                        </>
                    )}
                </View>
            </View>

            {/* ── FLIGHT Mode Fields ───────────────────────────────────────── */}
            {dutyType === 'FLIGHT' && (
                <>
                    {/* Route */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Route (DEP-ARR)</Text>
                        <View style={styles.row}>
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>DEP</Text>
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
                                <Text style={styles.inputLabel}>ARR</Text>
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
                        </View>

                        {/* DST Override — shown when DEP or ARR is in a DST-observing region */}
                        {(depHasDst || arrHasDst) && (
                            <View style={styles.dstBanner}>
                                <Text style={styles.dstBannerTitle}>
                                    💡 DST Alert: Daylight Saving Time may apply
                                </Text>
                                <Text style={styles.dstBannerText}>
                                    Auto-detected UTC offset is for reference. Verify and adjust as needed ⏷.
                                </Text>
                                {depHasDst && (
                                    <View style={styles.dstOffsetRow}>
                                        <Text style={styles.dstOffsetLabel}>
                                            DEP {flight.depIcao} Offset:
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
                                            ARR {flight.arrIcao} Offset:
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

                    {/* ── 时刻与运行数据 Time & Operations (Phase 8 consolidated card) ── */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Time & Operations</Text>
                        <Text style={styles.sectionHint}>
                            Enter T/O and LDG times. OFF and ON will be auto-estimated (±10/5 min).
                        </Text>

                        {/* Four-Point Time Axis */}
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

                        {/* Compact Time Data Row: Block | Air | Night (input) | Instrument (input) */}
                        <View style={styles.timeDataRow}>
                            <View style={styles.timeDataCell}>
                                <Text style={styles.timeDataLabel}>Block Time</Text>
                                <Text style={[styles.timeDataValue, blockTimeMin !== null && styles.timeDataValueActive]}>
                                    {blockTimeMin !== null ? minutesToHHMM(blockTimeMin) : '--:--'}
                                </Text>
                                {fieldError('block_time_min') && (
                                    <Text style={styles.inlineError}>{fieldError('block_time_min')}</Text>
                                )}
                            </View>
                            <View style={styles.timeDataCell}>
                                <Text style={styles.timeDataLabel}>Air Time</Text>
                                <Text style={[styles.timeDataValue, airTimeMin !== null && styles.timeDataValueActive]}>
                                    {airTimeMin !== null ? minutesToHHMM(airTimeMin) : '--:--'}
                                </Text>
                            </View>
                            <View style={styles.timeDataCellInput}>
                                <Text style={styles.inputLabel}>
                                    {showNightHint ? '🌙 Night (min)' : 'Night (min)'}
                                </Text>
                                <TextInput
                                    style={[styles.textInput, showNightHint && styles.nightHintInput]}
                                    value={flight.nightFlightRaw}
                                    onChangeText={v => updateFlight({ nightFlightRaw: v.replace(/\D/g, '') })}
                                    keyboardType="number-pad"
                                    placeholder="0"
                                    placeholderTextColor={COLORS.placeholder}
                                    testID="input-night-flight"
                                />
                            </View>
                            <View style={styles.timeDataCellInput}>
                                <Text style={styles.inputLabel}>Instrument (min)</Text>
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

                        {/* ── PF/PM Landing Auto-Link ─────────────────────────────── */}
                        <View style={styles.sectionDivider} />
                        <Text style={styles.sectionSubTitle}>T/O & LDG Count</Text>
                        {!isManualLandings ? (
                            flight.pilotRole === 'PF' ? (
                                <View style={styles.pfLandingBanner}>
                                    <Text style={styles.pfLandingBannerText}>
                                        ✓ Auto-counted 1
                                        {(isNightHintTime(flight.ldgRaw) || isNightHintTime(flight.onRaw)) ? ' Night' : ' Day'}
                                        {' '}T/O & LDG
                                    </Text>
                                    <TouchableOpacity
                                        onPress={() => setIsManualLandings(true)}
                                        testID="btn-manual-landings"
                                    >
                                        <Text style={styles.manualLandingsLink}>Edit</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <View style={styles.autoLandingPlaceholder}>
                                    <Text style={styles.autoLandingPlaceholderText}>
                                        {flight.pilotRole === 'PM'
                                            ? 'PM: no T/O & LDG counted'
                                            : 'Select PF to auto-count T/O & LDG'}
                                    </Text>
                                    <TouchableOpacity
                                        onPress={() => setIsManualLandings(true)}
                                        testID="btn-manual-landings"
                                    >
                                        <Text style={styles.manualLandingsLink}>Manual</Text>
                                    </TouchableOpacity>
                                </View>
                            )
                        ) : (
                            <View>
                                <View style={styles.row}>
                                    <LandingCounter
                                        label="Day T/O"
                                        value={flight.dayTo}
                                        onChange={v => updateFlight({ dayTo: v })}
                                        testIDBase="day-to"
                                    />
                                    <View style={styles.gap} />
                                    <LandingCounter
                                        label="Night T/O"
                                        value={flight.nightTo}
                                        onChange={v => updateFlight({ nightTo: v })}
                                        testIDBase="night-to"
                                    />
                                </View>
                                <View style={[styles.row, { marginTop: 8 }]}>
                                    <LandingCounter
                                        label="Day LDG"
                                        value={flight.dayLdg}
                                        onChange={v => updateFlight({ dayLdg: v })}
                                        testIDBase="day-ldg"
                                    />
                                    <View style={styles.gap} />
                                    <LandingCounter
                                        label="Night LDG"
                                        value={flight.nightLdg}
                                        onChange={v => updateFlight({ nightLdg: v })}
                                        testIDBase="night-ldg"
                                    />
                                </View>
                                <TouchableOpacity
                                    style={styles.cancelManualBtn}
                                    onPress={() => setIsManualLandings(false)}
                                    testID="btn-cancel-manual-landings"
                                >
                                    <Text style={styles.cancelManualBtnText}>↩ Reset to Auto</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>

                    {/* Role Times */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Experience Time</Text>
                        <Text style={styles.sectionHint}>
                            Total experience must not exceed Block Time.
                        </Text>

                        {/* ── My Role: capacity role selector + PF/PM toggle ── */}
                        <View style={styles.myRoleCard}>
                            <Text style={styles.myRoleTitle}>My Role</Text>
                            <Text style={styles.myRoleHint}>
                                Block Time auto-fills into the selected role field. Editable.
                            </Text>

                            {/* 4-way capacity role selector */}
                            <View style={styles.capacityRoleRow}>
                                {([
                                    { role: 'PIC', label: 'PIC', sub: 'Captain' },
                                    { role: 'PIC_US', label: 'PIC U/S', sub: 'Supervised PIC' },
                                    { role: 'SPIC', label: 'SPIC', sub: 'Student PIC' },
                                    { role: 'SIC', label: 'SIC', sub: 'First Officer' },
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
                                <Text style={styles.pfPmLabel}>Control Duty</Text>
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
                                                {r === 'PF' ? 'Pilot Flying (PF)' : 'Pilot Monitoring (PM)'}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        </View>

                        {/* ── Time buckets (all 6 fields visible, matching role highlighted) ── */}
                        <View style={styles.row}>
                            {([
                                { key: 'picRaw', role: 'PIC', label: 'PIC', testID: 'input-pic', errKey: 'pic_min' },
                                { key: 'picUsRaw', role: 'PIC_US', label: 'PIC U/S', testID: 'input-pic-us', errKey: undefined },
                                { key: 'spicRaw', role: 'SPIC', label: 'SPIC', testID: 'input-spic', errKey: undefined },
                            ] as { key: keyof FlightFields; role: CapacityRole; label: string; testID: string; errKey?: string }[]).map(({ key, role, label, testID, errKey }) => (
                                <View key={key} style={styles.roleTimeField}>
                                    <Text style={[
                                        styles.inputLabel,
                                        flight.capacityRole === role && styles.inputLabelHighlight,
                                    ]}>
                                        {label} (min)
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
                                { key: 'sicRaw', role: 'SIC', label: 'SIC', testID: 'input-sic', errKey: undefined },
                                { key: 'dualRaw', role: null, label: 'Dual', testID: 'input-dual', errKey: undefined },
                                { key: 'instructorRaw', role: null, label: 'Instructor', testID: 'input-instructor', errKey: undefined },
                            ] as { key: keyof FlightFields; role: CapacityRole | null; label: string; testID: string; errKey?: string }[]).map(({ key, role, label, testID }) => (
                                <View key={key} style={styles.roleTimeField}>
                                    <Text style={[
                                        styles.inputLabel,
                                        role && flight.capacityRole === role && styles.inputLabelHighlight,
                                    ]}>
                                        {label} (min)
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
                        <Text style={styles.sectionTitle}>Approach Type</Text>
                        <OptionPicker
                            label=""
                            value={flight.approachType}
                            onChange={v => updateFlight({ approachType: v })}
                            options={APPROACH_TYPE_OPTIONS}
                            testID="picker-approach-type"
                        />
                    </View>

                    {renderRemarksSection()}
                </>
            )}

            {/* ── SIMULATOR Mode Fields ────────────────────────────────────── */}
            {dutyType === 'SIMULATOR' && (
                <>
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Simulator Info</Text>

                        <View style={styles.row}>
                            <View style={styles.flexField}>
                                <Text style={styles.inputLabel}>SIM No.</Text>
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
                                <Text style={styles.inputLabel}>FSTD Level</Text>
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
                                <Text style={styles.inputLabel}>Training Agency</Text>
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
                                <Text style={styles.inputLabel}>Training Type</Text>
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
                        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Training Period</Text>
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
                                <Text style={styles.blockTimeLabel}>Duration:</Text>
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
                    <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={handleSave}
                    testID="btn-save"
                >
                    <Text style={styles.saveText}>Save Record →</Text>
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
};

// ─── ComboInput Sub-Component ───────────────────────────────────────────────
// Text input + horizontally scrollable preset chips below.
// Tapping a chip fills the input; active chip is highlighted.

const ComboInput: React.FC<{
    value: string;
    onChange: (v: string) => void;
    presets?: string[];
    categorizedPresets?: PresetCategory[];
    placeholder?: string;
    hasError?: boolean;
    testID?: string;
}> = ({ value, onChange, presets, categorizedPresets, placeholder, hasError, testID }) => {
    const [activeCat, setActiveCat] = useState(categorizedPresets?.[0]?.label ?? '');
    const displayItems = categorizedPresets?.find(c => c.label === activeCat)?.items || presets || [];

    return (
        <View>
            <TextInput
                style={[styles.textInput, hasError && styles.inputError, { marginBottom: categorizedPresets ? 0 : 8 }]}
                value={value}
                onChangeText={v => onChange(v.toUpperCase())}
                placeholder={placeholder}
                placeholderTextColor={COLORS.placeholder}
                autoCapitalize="characters"
                testID={testID}
            />
            {categorizedPresets && categorizedPresets.length > 0 && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.catTabsRow}
                    contentContainerStyle={styles.catTabsContent}
                    keyboardShouldPersistTaps="handled"
                >
                    {categorizedPresets.map(cat => (
                        <TouchableOpacity
                            key={cat.label}
                            style={[styles.catTab, activeCat === cat.label && styles.catTabActive]}
                            onPress={() => setActiveCat(cat.label)}
                            testID={`cat-tab-${cat.label}`}
                        >
                            <Text style={[styles.catTabText, activeCat === cat.label && styles.catTabTextActive]}>
                                {cat.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            )}
            <View
                style={styles.presetContent}
                testID={`${testID}-presets`}
            >
                {displayItems.map(p => (
                    <TouchableOpacity
                        key={p}
                        style={[styles.presetChip, value === p && styles.presetChipActive]}
                        onPress={() => onChange(p)}
                        testID={`preset-${p}`}
                    >
                        <Text style={[styles.presetChipText, value === p && styles.presetChipTextActive]}>
                            {p}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
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
    dateEchoText: {
        color: COLORS.primary,
        fontWeight: 'bold',
        fontVariant: ['tabular-nums'],
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

    // ── ComboInput presets ────────────────────────────────────────────────────
    catTabsRow: {
        marginTop: 8,
        flexGrow: 0,
    },
    catTabsContent: {
        flexDirection: 'row',
        gap: 6,
        paddingRight: 4,
    },
    catTab: {
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 14,
        backgroundColor: COLORS.background,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    catTabActive: {
        backgroundColor: '#1E3A5F',
        borderColor: COLORS.primary,
    },
    catTabText: {
        color: COLORS.textSecondary,
        fontSize: 11,
        fontWeight: '600',
    },
    catTabTextActive: {
        color: '#DBEAFE',
    },
    presetContent: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 8,
        marginBottom: 8,
    },
    presetChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: COLORS.surface,
    },
    presetChipActive: {
        borderColor: COLORS.primary,
        backgroundColor: '#1E3A5F',
    },
    presetChipText: {
        color: COLORS.textSecondary,
        fontSize: 11,
        fontWeight: '600',
    },
    presetChipTextActive: {
        color: '#DBEAFE',
    },

    // ── Phase 8: Compact time data row (Block / Air / Night / Instrument) ────
    timeDataRow: {
        flexDirection: 'row' as const,
        marginTop: 12,
        gap: 6,
    },
    timeDataCell: {
        flex: 1,
        alignItems: 'center' as const,
        backgroundColor: COLORS.background,
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: COLORS.border,
        paddingVertical: 8,
        paddingHorizontal: 4,
    },
    timeDataCellInput: {
        flex: 1,
    },
    timeDataLabel: {
        color: COLORS.textSecondary,
        fontSize: 9,
        fontWeight: '600' as const,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    timeDataValue: {
        color: COLORS.placeholder,
        fontSize: 16,
        fontWeight: '700' as const,
        letterSpacing: 0.5,
        fontVariant: ['tabular-nums' as const],
    },
    timeDataValueActive: {
        color: COLORS.success,
    },

    // ── Phase 8: PF/PM landing auto-link UI ──────────────────────────────────
    sectionDivider: {
        height: 1,
        backgroundColor: COLORS.border,
        marginVertical: 12,
    },
    sectionSubTitle: {
        color: COLORS.textSecondary,
        fontSize: 11,
        fontWeight: '700' as const,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    pfLandingBanner: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        backgroundColor: '#064E3B',
        borderWidth: 1,
        borderColor: '#10B981',
        borderRadius: 8,
        padding: 10,
    },
    pfLandingBannerText: {
        color: '#6EE7B7',
        fontSize: 12,
        fontWeight: '600' as const,
        flex: 1,
    },
    manualLandingsLink: {
        color: COLORS.accent,
        fontSize: 12,
        fontWeight: '600' as const,
        marginLeft: 8,
    },
    autoLandingPlaceholder: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        paddingVertical: 6,
    },
    autoLandingPlaceholderText: {
        color: COLORS.placeholder,
        fontSize: 11,
        fontStyle: 'italic' as const,
    },
    cancelManualBtn: {
        alignSelf: 'center' as const,
        marginTop: 10,
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: COLORS.surface,
    },
    cancelManualBtnText: {
        color: COLORS.textSecondary,
        fontSize: 12,
        fontWeight: '500' as const,
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
