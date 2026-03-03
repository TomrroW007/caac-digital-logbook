module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: [
            // Required by WatermelonDB for @model, @field, @date, @readonly decorators
            ['@babel/plugin-proposal-decorators', { legacy: true }],
        ],
    };
};
