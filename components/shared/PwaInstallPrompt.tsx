/**
 * @file components/shared/PwaInstallPrompt.tsx
 * @description iOS Safari "Add to Home Screen" install guide banner.
 *
 * Displayed only when:
 *  1. Running on web (Platform.OS === 'web')
 *  2. NOT already in standalone mode (window.matchMedia('(display-mode: standalone)'))
 *  3. User has not previously dismissed the prompt (localStorage flag)
 *
 * The banner persists until the user taps "知道了", after which it is
 * suppressed permanently via localStorage.
 *
 * Android Chrome shows its own native "Add to Home Screen" prompt
 * via the beforeinstallprompt event. This component only handles
 * the iOS-specific case where no native prompt is available.
 */

import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Platform,
} from 'react-native';

// localStorage key used to remember the user dismissed the prompt
const DISMISSED_KEY = 'pwa_install_prompt_dismissed';

export const PwaInstallPrompt: React.FC = () => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (Platform.OS !== 'web') return;

        // Check if already running as installed PWA (standalone / fullscreen)
        const isStandalone =
            window.matchMedia('(display-mode: standalone)').matches ||
            (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

        if (isStandalone) return;

        // Check if user previously dismissed the prompt
        try {
            if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
        } catch {
            // localStorage may be blocked in private browsing — show anyway
        }

        // Delay slightly so the app has time to render first
        const timer = setTimeout(() => setVisible(true), 1500);
        return () => clearTimeout(timer);
    }, []);

    const handleDismiss = () => {
        try {
            localStorage.setItem(DISMISSED_KEY, 'true');
        } catch {
            // ignore storage errors
        }
        setVisible(false);
    };

    if (!visible) return null;

    return (
        <View style={styles.container}>
            <View style={styles.card}>
                <Text style={styles.icon}>✈</Text>
                <View style={styles.body}>
                    <Text style={styles.title}>Get the Best Offline Experience</Text>
                    <Text style={styles.desc}>
                        Tap{' '}
                        <Text style={styles.highlight}>[Share]</Text>
                        {' '}→{' '}
                        <Text style={styles.highlight}>Add to Home Screen</Text>
                        {' '}to use like a native app, with no address bar and offline support.
                    </Text>
                </View>
                <TouchableOpacity
                    style={styles.dismissBtn}
                    onPress={handleDismiss}
                    accessibilityLabel="Dismiss install prompt"
                    testID="pwa-install-dismiss"
                >
                    <Text style={styles.dismissText}>Got it</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: 16,
        // Pointer events so underlying content is still touchable
    },
    card: {
        backgroundColor: '#1C2742',
        borderWidth: 1,
        borderColor: '#3B82F6',
        borderRadius: 16,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        // Subtle shadow for depth
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 8,
    },
    icon: {
        fontSize: 28,
    },
    body: {
        flex: 1,
    },
    title: {
        color: '#F9FAFB',
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 4,
    },
    desc: {
        color: '#9CA3AF',
        fontSize: 12,
        lineHeight: 18,
    },
    highlight: {
        color: '#60A5FA',
        fontWeight: '600',
    },
    dismissBtn: {
        backgroundColor: '#3B82F6',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    dismissText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '600',
    },
});
