export const stagingConfig = {
  environment: 'staging',
  deploymentConfig: {
    container: {
      instances: 1,
      memory: 1024,
      cpu: 256,
    },
    targetGroup: {
      port: 80,
      healthCheck: {
        port: '80',
        path: '/',
        interval: 30,
        timeout: 10,
        healthyThreshold: 3,
        unhealthyThreshold: 3,
      },
    },
    service: {
      desiredCount: 2,
    },
  },
};
