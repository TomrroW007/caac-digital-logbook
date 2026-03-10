/**
 * Mock for @nozbe/watermelondb
 * Provides a minimal no-op Model base class so TypeScript can compile
 * LogbookRecord.ts in the Jest test environment without native binaries.
 */

class Model {
    static table = '';
    get id() { return ''; }
}

const appSchema = (def) => def;
const tableSchema = (def) => def;

module.exports = { Model, appSchema, tableSchema };
