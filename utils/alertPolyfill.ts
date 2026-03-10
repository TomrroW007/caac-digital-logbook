/**
 * @file utils/alertPolyfill.ts
 * @description Cross-platform alert that works on iOS, Android, AND Web.
 *
 * React Native's `Alert.alert()` is a no-op on Web.
 * This module provides a drop-in replacement that uses `window.confirm`
 * on Web and `Alert.alert()` on native platforms.
 */

import { Alert, Platform } from 'react-native';

export interface AlertButton {
    text?: string;
    onPress?: () => void | Promise<void>;
    style?: 'default' | 'cancel' | 'destructive';
}

/**
 * Show an alert dialog that works on all platforms including Web.
 *
 * - On native (iOS/Android): delegates to `Alert.alert()`.
 * - On Web: uses `window.confirm()` for 2-button alerts (cancel + action),
 *   or `window.alert()` for single-button informational alerts.
 */
export function crossAlert(
    title: string,
    message?: string,
    buttons?: AlertButton[],
): void {
    if (Platform.OS !== 'web') {
        Alert.alert(title, message, buttons as any);
        return;
    }

    // ── Web fallback ──
    const safeButtons = buttons ?? [{ text: 'OK' }];
    const cancelBtn = safeButtons.find(b => b.style === 'cancel');
    const actionBtn = safeButtons.find(b => b.style !== 'cancel') ?? safeButtons[0];

    if (safeButtons.length <= 1) {
        // Informational alert — just OK
        window.alert(`${title}${message ? '\n\n' + message : ''}`);
        actionBtn?.onPress?.();
        return;
    }

    // Confirmation dialog
    const confirmed = window.confirm(`${title}${message ? '\n\n' + message : ''}`);
    if (confirmed) {
        actionBtn?.onPress?.();
    } else {
        cancelBtn?.onPress?.();
    }
}
