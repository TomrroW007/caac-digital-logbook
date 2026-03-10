import { Platform, Alert } from 'react-native';
import { crossAlert } from '../alertPolyfill';

// Mock react-native explicitly
jest.mock('react-native', () => ({
    Platform: {
        OS: 'ios', // default to native
    },
    Alert: {
        alert: jest.fn(),
    },
}));

describe('alertPolyfill', () => {
    let originalWindow: any;

    beforeEach(() => {
        jest.clearAllMocks();
        // Setup web mocks
        originalWindow = (global as any).window;
        (global as any).window = {
            confirm: jest.fn(),
            alert: jest.fn(),
        };
    });

    afterEach(() => {
        (global as any).window = originalWindow;
        Platform.OS = 'ios'; // Reset OS
    });

    it('should use Alert.alert on non-web platforms', () => {
        Platform.OS = 'ios';
        const buttons = [{ text: 'OK' }];
        crossAlert('Test Title', 'Test Message', buttons);

        expect(Alert.alert).toHaveBeenCalledWith('Test Title', 'Test Message', buttons);
        expect((global as any).window.alert).not.toHaveBeenCalled();
        expect((global as any).window.confirm).not.toHaveBeenCalled();
    });

    describe('on Web platform', () => {
        beforeEach(() => {
            Platform.OS = 'web';
        });

        it('should use window.alert for single button informational alerts', () => {
            const mockPress = jest.fn();
            crossAlert('Info Title', 'Info Message', [{ text: 'OK', onPress: mockPress }]);

            expect((global as any).window.alert).toHaveBeenCalledWith('Info Title\n\nInfo Message');
            expect(mockPress).toHaveBeenCalled();
            expect((global as any).window.confirm).not.toHaveBeenCalled();
            expect(Alert.alert).not.toHaveBeenCalled();
        });

        it('should format message correctly if message is undefined for window.alert', () => {
            const mockPress = jest.fn();
            crossAlert('Info Title', undefined, [{ text: 'OK', onPress: mockPress }]);

            expect((global as any).window.alert).toHaveBeenCalledWith('Info Title');
            expect(mockPress).toHaveBeenCalled();
        });

        it('should fallback to default OK button if none provided', () => {
            crossAlert('No Buttons');

            expect((global as any).window.alert).toHaveBeenCalledWith('No Buttons');
            expect(Alert.alert).not.toHaveBeenCalled();
        });

        it('should use window.confirm for 2-button alerts and handle OK', () => {
            ((global as any).window.confirm as jest.Mock).mockReturnValue(true);

            const mockCancel = jest.fn();
            const mockAction = jest.fn();

            crossAlert('Confirm Title', 'Confirm Message', [
                { text: 'Cancel', style: 'cancel', onPress: mockCancel },
                { text: 'Delete', style: 'destructive', onPress: mockAction },
            ]);

            expect((global as any).window.confirm).toHaveBeenCalledWith('Confirm Title\n\nConfirm Message');
            expect(mockAction).toHaveBeenCalled();
            expect(mockCancel).not.toHaveBeenCalled();
        });

        it('should format message correctly if message is undefined for window.confirm', () => {
            ((global as any).window.confirm as jest.Mock).mockReturnValue(true);
            const mockAction = jest.fn();
            crossAlert('Confirm Title', undefined, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: mockAction },
            ]);

            expect((global as any).window.confirm).toHaveBeenCalledWith('Confirm Title');
            expect(mockAction).toHaveBeenCalled();
        });

        it('should use window.confirm and handle Cancel', () => {
            ((global as any).window.confirm as jest.Mock).mockReturnValue(false);

            const mockCancel = jest.fn();
            const mockAction = jest.fn();

            crossAlert('Confirm Title', 'Confirm Message', [
                { text: 'Cancel', style: 'cancel', onPress: mockCancel },
                { text: 'Delete', style: 'destructive', onPress: mockAction },
            ]);

            expect((global as any).window.confirm).toHaveBeenCalledWith('Confirm Title\n\nConfirm Message');
            expect(mockCancel).toHaveBeenCalled();
            expect(mockAction).not.toHaveBeenCalled();
        });

        it('should handle missing onPress in buttons gracefully', () => {
            ((global as any).window.confirm as jest.Mock).mockReturnValue(true);
            expect(() => {
                crossAlert('Confirm Title', 'Confirm Message', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive' },
                ]);
            }).not.toThrow();
        });

        it('should correctly select the action button if the first button is cancel', () => {
            ((global as any).window.confirm as jest.Mock).mockReturnValue(true);
            const mockAction = jest.fn();
            crossAlert('Confirm', 'Msg', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'OK', onPress: mockAction }
            ]);
            expect(mockAction).toHaveBeenCalled();
        });
    });
});
