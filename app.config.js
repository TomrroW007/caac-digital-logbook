export default ({ config }) => {
    return {
        ...config,
        plugins: [
            ...(config.plugins ?? []),
            '@react-native-community/datetimepicker',
        ],
        extra: {
            ...config.extra,
            workerUrl: process.env.EXPO_PUBLIC_WORKER_URL || config.extra.workerUrl,
        },
    };
};
