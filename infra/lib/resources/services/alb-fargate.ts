import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ec2 from 'aws-cdk-lib/aws-ec2'; // 👈 add
import { getCloudFrontPlId } from '../helpers/index'

export interface AlbFargateOptions {
  cluster: ecs.ICluster;
  cpu: number;
  memoryLimitMiB: number;
  desiredCount: number;
  minCount: number;
  maxCount: number;
  image: ecs.ContainerImage;
  containerName: string;
  containerPort: number;
  serviceName: string;
  repositoryName: string;
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
    cluster: opts.cluster,
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

    // 🔒 prevent CDK from adding 0.0.0.0/0 to the ALB SG
    openListener: false, // 👈 add
  });

  const scaling = svc.service.autoScaleTaskCount({
    minCapacity: opts.minCount ?? 1,
    maxCapacity: opts.maxCount ?? 2,
  });

  scaling.scaleOnCpuUtilization('CpuScaling', {
    targetUtilizationPercent: 60,
    scaleInCooldown: cdk.Duration.seconds(60),
    scaleOutCooldown: cdk.Duration.seconds(60),
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

  // ── 🔐 ALB SG: allow ONLY CloudFront (80/443) ────────────────────────────────
  const plId = getCloudFrontPlId(scope, `${id}CfPlLookup`);
  const albSg = svc.loadBalancer.connections.securityGroups[0];

  // albSg.addIngressRule(ec2.Peer.prefixList(plId), ec2.Port.tcp(443), 'Allow CloudFront to ALB 443');
  albSg.addIngressRule(ec2.Peer.prefixList(plId), ec2.Port.tcp(80),  'Allow CloudFront to ALB 80');

  // (optional) outbound lock-down if you wish:
  // albSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Egress 443');

  return svc;
}
