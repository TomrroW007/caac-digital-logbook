/**
 * Mock for @nozbe/watermelondb/decorators
 * All decorators are replaced with no-ops so ts-jest can compile models
 * without the native WatermelonDB SQLite bindings.
 */

// No-op property decorator factory
const noop = () => () => { };

const field = noop;
const text = noop;
const readonly = noop;
const date = noop;

// immutableRelation, relation, children etc. — add if needed in later phases
const immutableRelation = noop;
const relation = noop;
const children = noop;
const lazy = noop;

module.exports = {
    field,
    text,
    readonly,
    date,
    immutableRelation,
    relation,
    children,
    lazy,
};
