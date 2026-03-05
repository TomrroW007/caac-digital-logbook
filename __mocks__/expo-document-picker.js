/**
 * Mock for expo-document-picker for Jest test environment.
 */

const getDocumentAsync = jest.fn().mockResolvedValue({
    canceled: true,
    assets: [],
});

module.exports = { getDocumentAsync };
