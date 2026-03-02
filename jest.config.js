/** @type {import('jest').Config} */
module.exports = {
    // Use ts-jest to compile TypeScript on the fly — no separate build step needed.
    preset: 'ts-jest',

    // Node environment — correct for pure utility functions with no React Native APIs.
    testEnvironment: 'node',

    // Test file discovery pattern
    testMatch: [
        '**/__tests__/**/*.test.ts',
        '**/?(*.)+(spec|test).ts',
    ],

    // TypeScript transform config — matches tsconfig.json compiler options
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: {
                    // Override: ts-jest needs commonjs modules at runtime
                    module: 'commonjs',
                    // We must skip WatermelonDB's @field decorators in type check
                    // since we don't install the native package here.
                    skipLibCheck: true,
                },
            },
        ],
    },

    // Path aliases — none yet; will be added when Expo project is initialized.
    moduleNameMapper: {},

    // Mock WatermelonDB so its native modules don't break the test runner.
    // The TimeCalculator tests don't use WatermelonDB at all, but schema.ts
    // and LogbookRecord.ts import from it — this mock satisfies those imports.
    moduleNameMapper: {
        '@nozbe/watermelondb': '<rootDir>/__mocks__/@nozbe/watermelondb.js',
        '@nozbe/watermelondb/decorators': '<rootDir>/__mocks__/@nozbe/watermelondb/decorators.js',
    },

    // Coverage configuration
    collectCoverageFrom: [
        'utils/**/*.ts',
        '!utils/**/__tests__/**',
    ],

    coverageThreshold: {
        global: {
            branches: 80,
            functions: 90,
            lines: 90,
            statements: 90,
        },
    },
};
