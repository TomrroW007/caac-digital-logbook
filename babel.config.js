module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: [
            // 1. Prioritise handling TypeScript's declare field while retaining JSX parsing
            ['@babel/plugin-transform-typescript', { isTSX: true, allExtensions: true, allowDeclareFields: true }],

            // 2. Handling the decorators required for WatermelonDB
            ['@babel/plugin-proposal-decorators', { legacy: true }],

            // 3. Unified configuration class in loose mode
            ['@babel/plugin-transform-class-properties', { loose: true }],
            ['@babel/plugin-transform-private-methods', { loose: true }],
            ['@babel/plugin-transform-private-property-in-object', { loose: true }],
        ],
    };
};