/**
 * Mock for @nozbe/watermelondb/sync
 * Provides a no-op synchronize function for Jest test environment.
 */

const synchronize = jest.fn().mockResolvedValue(undefined);

module.exports = { synchronize };
