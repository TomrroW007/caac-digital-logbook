/**
 * @file App.tsx
 * @description Root component for the CAAC Digital Logbook Expo app.
 *
 * Provides:
 *  - React Navigation's NavigationContainer (routing context)
 *  - WatermelonDB's DatabaseProvider (database context)
 *  - Native stack navigator with 4 screens
 *
 * Architecture: All business-logic stays in screens/components.
 * App.tsx is intentionally kept thin — it is responsible only for
 * bootstrapping providers and the navigation tree.
 */

import React from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DatabaseProvider } from '@nozbe/watermelondb/DatabaseProvider';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { database } from './database';
import { DashboardScreen } from './screens/DashboardScreen';
import { TimelineScreen } from './screens/TimelineScreen';
import { EntryFormScreen } from './screens/EntryFormScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AppErrorBoundary } from './components/shared/AppErrorBoundary';
import { PwaInstallPrompt } from './components/shared/PwaInstallPrompt';

// ─── Navigation Type Definitions ─────────────────────────────────────────────

/**
 * Root navigation param list — defines all routes and their params.
 * Exported so screen components can use NativeStackNavigationProp<RootStackParamList>.
 */
export type RootStackParamList = {
    Dashboard: undefined;
    Timeline: undefined;
    EntryForm: { recordId?: string } | undefined;  // undefined = new record
    Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ─── Common Screen Options ────────────────────────────────────────────────────

const SCREEN_OPTIONS = {
    headerStyle: { backgroundColor: '#111827' },
    headerTintColor: '#F9FAFB',
    headerTitleStyle: { fontWeight: '700' as const, fontSize: 17 },
    contentStyle: { backgroundColor: '#0A0F1E' },
} as const;

// ─── Root Component ───────────────────────────────────────────────────────────

export default function App() {
    return (
        <SafeAreaProvider>
            <AppErrorBoundary>
                <DatabaseProvider database={database}>
                    <View style={styles.root}>
                        <NavigationContainer>
                            <StatusBar style="light" backgroundColor="#0A0F1E" />
                        <Stack.Navigator
                        initialRouteName="Dashboard"
                        screenOptions={SCREEN_OPTIONS}
                    >
                        <Stack.Screen
                            name="Dashboard"
                            component={DashboardScreen}
                            options={{ title: '✈ Pilot Logbook', headerShown: true }}
                        />
                        <Stack.Screen
                            name="Timeline"
                            component={TimelineScreen}
                            options={{ title: 'Timeline' }}
                        />
                        <Stack.Screen
                            name="EntryForm"
                            component={EntryFormScreen}
                            options={({ route }) => ({
                                title: route.params?.recordId ? 'Edit Record' : 'New Record',
                                presentation: 'modal',
                            })}
                        />
                        <Stack.Screen
                            name="Settings"
                            component={SettingsScreen}
                            options={{ title: 'Settings & Export' }}
                        />
                    </Stack.Navigator>
                    </NavigationContainer>
                    {/* PWA install guide — web-only, absolute overlay at bottom */}
                    {Platform.OS === 'web' && <PwaInstallPrompt />}
                </View>
                </DatabaseProvider>
            </AppErrorBoundary>
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        position: 'relative',
    },
});
