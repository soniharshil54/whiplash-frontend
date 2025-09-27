export const devConfig = {
  environment: 'dev',
  deploymentConfig: {
    container: {
      instances: 1,
      memory: 512,
      cpu: 256,
    },
    targetGroup: {
      port: 3000,
      healthCheck: {
        port: '3000',
        path: '/api/healthcheck',
        interval: 30,
        timeout: 10,
        healthyThreshold: 2,
        unhealthyThreshold: 2,
      },
    },
    service: {
      desiredCount: 1,
    },
  },
};
