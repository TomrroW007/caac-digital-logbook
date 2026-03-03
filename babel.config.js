module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: [
            // 1. Prioritise handling TypeScript's declare field
            ['@babel/plugin-transform-typescript', { allowDeclareFields: true }],

            // 2. Handling the decorators required for WatermelonDB
            ['@babel/plugin-proposal-decorators', { legacy: true }],

            // 3. Unified configuration class in loose mode
            ['@babel/plugin-transform-class-properties', { loose: true }],
            ['@babel/plugin-transform-private-methods', { loose: true }],
            ['@babel/plugin-transform-private-property-in-object', { loose: true }],
        ],
    };
};