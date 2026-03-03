/**
 * TypeScript type stubs for @nozbe/watermelondb/decorators
 * Used by `tsc --noEmit` in the standalone Phase 1 environment.
 */

type PropertyDecorator = (target: object, propertyKey: string | symbol) => void;
type DecoratorFactory = (...args: any[]) => PropertyDecorator;

/** Binds a DB column to a model property. */
export const field: DecoratorFactory = () => () => { };

/** Alias for field — used for string columns in newer WDB versions. */
export const text: DecoratorFactory = () => () => { };

/** Marks a property as read-only (managed by WatermelonDB). */
export const readonly: DecoratorFactory = () => () => { };

/** Binds a Unix-timestamp column, exposing it as a Date object. */
export const date: DecoratorFactory = () => () => { };

/** Defines an immutable belongs-to relation. */
export const immutableRelation: DecoratorFactory = () => () => { };

/** Defines a mutable belongs-to relation. */
export const relation: DecoratorFactory = () => () => { };

/** Defines a has-many relation. */
export const children: DecoratorFactory = () => () => { };

/** Marks a getter as lazy-evaluated. */
export const lazy: DecoratorFactory = () => () => { };
