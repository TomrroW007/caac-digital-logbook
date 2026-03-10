/**
 * @file components/shared/AppErrorBoundary.tsx
 * @description Global React Error Boundary for the CAAC Digital Logbook.
 *
 * Wraps the entire application tree. Any unhandled render-time error within
 * the tree will be caught here, preventing a blank white screen and giving
 * the pilot a clear recovery action ("重启应用").
 *
 * Design decision: implemented as a class component because React does not
 * yet expose error boundary lifecycle methods to function components.
 */

import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // In production this would be sent to a remote error tracker
        console.error('[AppErrorBoundary] Unhandled render error:', error, info.componentStack);
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <View style={styles.container}>
                    <Text style={styles.icon}>⚠️</Text>
                    <Text style={styles.title}>Something Went Wrong</Text>
                    <Text style={styles.message}>
                        {this.state.error?.message ?? 'An unknown error occurred'}
                    </Text>
                    <TouchableOpacity style={styles.button} onPress={this.handleReset}>
                        <Text style={styles.buttonText}>Reload</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        return this.props.children;
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0A0F1E',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
    },
    icon: { fontSize: 56, marginBottom: 20 },
    title: {
        color: '#F9FAFB',
        fontSize: 22,
        fontWeight: '700',
        marginBottom: 12,
        textAlign: 'center',
    },
    message: {
        color: '#9CA3AF',
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 32,
        lineHeight: 22,
    },
    button: {
        backgroundColor: '#3B82F6',
        paddingHorizontal: 32,
        paddingVertical: 14,
        borderRadius: 12,
    },
    buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
