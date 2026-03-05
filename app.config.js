export default ({ config }) => {
    return {
        ...config,
        extra: {
            ...config.extra,
            workerUrl: process.env.EXPO_PUBLIC_WORKER_URL || config.extra.workerUrl,
        },
    };
};
