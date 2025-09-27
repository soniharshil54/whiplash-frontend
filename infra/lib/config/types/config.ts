export type Config = {
  environment: string;
  deploymentConfig: {
    container: {
      // imageRepositoryName: string;
      instances: number;
      memory: number;
      cpu: number;
    };
    targetGroup: {
      port: number;
      healthCheck: {
        port: string;
        path: string;
        interval: number;
        timeout: number;
        healthyThreshold: number;
        unhealthyThreshold: number;
      };
    };
    service: {
      desiredCount: number;
    };
  };
};
