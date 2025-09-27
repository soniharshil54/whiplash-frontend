import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export interface AlbFargateOptions {
  // CHANGE: accept ICluster (works for imported clusters)
  cluster: ecs.ICluster;
  cpu: number;
  memoryLimitMiB: number;
  desiredCount: number;
  image: ecs.ContainerImage;
  containerName: string;
  containerPort: number;
  serviceName: string;
  repositoryName: string; // ECR repo to grant pull
  healthCheck: { 
    port: string;
    path: string;
    healthyThreshold: number;
    unhealthyThreshold: number;
    interval: number;
    timeout: number;
  };
  publicLoadBalancer?: boolean;
  healthCheckGraceSec?: number;
  environment?: { [key: string]: string };
}

export function createAlbFargateService(
  scope: Construct,
  id: string,
  opts: AlbFargateOptions
): ecsPatterns.ApplicationLoadBalancedFargateService {
  const svc = new ecsPatterns.ApplicationLoadBalancedFargateService(scope, id, {
    cluster: opts.cluster, // ecs.ICluster is what the pattern expects
    cpu: opts.cpu,
    memoryLimitMiB: opts.memoryLimitMiB,
    publicLoadBalancer: opts.publicLoadBalancer ?? true,
    desiredCount: opts.desiredCount,
    taskImageOptions: {
      image: opts.image,
      containerName: opts.containerName,
      containerPort: opts.containerPort,
      environment: { ...opts.environment },
    },
    serviceName: opts.serviceName,
    circuitBreaker: { rollback: true },
    healthCheckGracePeriod: cdk.Duration.seconds(opts.healthCheckGraceSec ?? 30),
  });

  // Health checks
  svc.targetGroup.configureHealthCheck({
    port: opts.healthCheck.port,
    path: opts.healthCheck.path,
    healthyHttpCodes: '200-399',
    interval: cdk.Duration.seconds(opts.healthCheck.interval),
    timeout: cdk.Duration.seconds(opts.healthCheck.timeout),
    healthyThresholdCount: opts.healthCheck.healthyThreshold,
    unhealthyThresholdCount: opts.healthCheck.unhealthyThreshold,
  });

  // Execution role → ECR pull
  svc.taskDefinition.executionRole!.addManagedPolicy(
    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
  );
  const repo = ecr.Repository.fromRepositoryName(scope, `${id}RepoImport`, opts.repositoryName);
  repo.grantPull(svc.taskDefinition.executionRole!);

  return svc;
}
