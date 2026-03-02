/**
 * @file screens/EntryFormScreen.tsx
 * @description Container screen for DualTrackForm.
 * Handles both "new record" and "edit existing record" modes.
 * Holds WatermelonDB write logic and navigation.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { DualTrackForm, type FormSavePayload } from '../components/EntryForm/DualTrackForm';
import { database } from '../database';
import type { LogbookRecord } from '../model/LogbookRecord';

type Props = NativeStackScreenProps<RootStackParamList, 'EntryForm'>;
type Nav = NativeStackNavigationProp<RootStackParamList, 'EntryForm'>;

// ─── Helper: write all fields to a WatermelonDB record instance ───────────────

function applyPayloadToRecord(record: LogbookRecord, data: FormSavePayload) {
    // Shared fields
    record.dutyType = data.dutyType;
    record.schdDate = data.schdDate ?? '';
    record.actlDate = data.actlDate ?? '';
    record.acftType = data.acftType || '';
    record.regNo = data.regNo ?? null;

    // Route & Identification
    record.flightNo = data.flightNo ?? null;
    record.depIcao = data.depIcao ?? null;
    record.arrIcao = data.arrIcao ?? null;

    // Time Axis
    record.offTimeUtc = data.offUtcISO ?? '';
    record.toTimeUtc = data.toUtcISO ?? null;
    record.ldgTimeUtc = data.ldgUtcISO ?? null;
    record.onTimeUtc = data.onUtcISO ?? '';

    // Durations
    record.blockTimeMin = data.blockTimeMin;
    record.picMin = data.picMin;
    record.sicMin = data.sicMin;
    record.dualMin = data.dualMin;
    record.instructorMin = data.instructorMin;
    record.nightFlightMin = data.nightFlightMin;
    record.instrumentMin = data.instrumentMin;

    // Role & Approach
    record.pilotRole = data.pilotRole ?? null;
    record.approachType = data.approachType ?? null;

    // Landings
    record.dayLdg = data.dayLdg;
    record.nightLdg = data.nightLdg;

    // Simulator Specific
    record.simNo = data.simNo ?? null;
    record.simCat = data.simCat ?? null;
    record.trainingAgency = data.trainingAgency ?? null;
    record.trainingType = data.trainingType ?? null;

    // Notes
    record.remarks = data.remarks ?? null;

    // Sync meta
    record.appSyncStatus = 'LOCAL_ONLY';
    record.lastModifiedAt = new Date().toISOString();
    // uuid reserved for Phase 5 — keep null until cloud sync
    record.uuid = record.uuid ?? null;
}

// ─── Screen Component ─────────────────────────────────────────────────────────

export const EntryFormScreen: React.FC<Props> = ({ route }) => {
    const navigation = useNavigation<Nav>();
    const recordId = route.params?.recordId;
    const isEditing = Boolean(recordId);

    // When editing, load the existing record so we can pass initialValues to the form
    const [existingRecord, setExistingRecord] = useState<LogbookRecord | null>(null);
    const [loading, setLoading] = useState(isEditing);

    useEffect(() => {
        if (!recordId) return;
        let cancelled = false;
        (async () => {
            try {
                const rec = await database
                    .get<LogbookRecord>('logbook_records')
                    .find(recordId);
                if (!cancelled) setExistingRecord(rec);
            } catch (e) {
                console.error('[EntryFormScreen] Failed to load record for editing:', e);
                if (!cancelled) {
                    Alert.alert('加载失败', '无法读取记录，请重试。');
                    navigation.goBack();
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [recordId, navigation]);

    /**
     * Called by DualTrackForm after passing all validations.
     * Creates a new record or updates the existing one based on edit mode.
     */
    const handleSave = async (data: FormSavePayload) => {
        try {
            await database.write(async () => {
                if (isEditing && existingRecord) {
                    // UPDATE existing record
                    await existingRecord.update(record => applyPayloadToRecord(record, data));
                } else {
                    // CREATE new record
                    const collection = database.get<LogbookRecord>('logbook_records');
                    await collection.create(record => {
                        applyPayloadToRecord(record, data);
                        record.isDeleted = false;
                        record.uuid = null; // Phase 5 will generate UUID on sync
                    });
                }
            });
            navigation.goBack();
        } catch (error) {
            console.error('[EntryFormScreen] Error saving to DB:', error);
            Alert.alert('保存失败', '写入本地数据库时发生错误，请重试。');
        }
    };

    const handleCancel = () => {
        navigation.goBack();
    };

    if (loading) {
        return (
            <View style={[styles.container, styles.centered]}>
                <ActivityIndicator size="large" color="#3B82F6" />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <DualTrackForm
                onSave={handleSave}
                onCancel={handleCancel}
                initialDutyType={existingRecord?.dutyType ?? 'FLIGHT'}
                existingRecord={existingRecord ?? undefined}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0A0F1E' },
    centered: { alignItems: 'center', justifyContent: 'center' },
});

export default EntryFormScreen;
