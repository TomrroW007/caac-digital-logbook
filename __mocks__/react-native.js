/**
 * Minimal mock for react-native in Jest (Node) test environment.
 * Only surfaces the APIs directly used by utils/ code under test.
 */

module.exports = {
    Platform: {
        OS: 'web', // default to 'web' so non-native code paths are exercised
        select: jest.fn((obj) => obj.web ?? obj.default ?? Object.values(obj)[0]),
    },
    Alert: {
        alert: jest.fn(),
    },
};
