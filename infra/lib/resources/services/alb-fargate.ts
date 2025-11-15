import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { getCloudFrontPlId } from '../helpers/index';

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

export interface AlbFargateReturn {
  service: ecsPatterns.ApplicationLoadBalancedFargateService;
  tlsEnabledParam: cdk.CfnParameter;
  tlsEnabledCondition: cdk.CfnCondition;
  certificateArnParam: cdk.CfnParameter;
  domainNameParam: cdk.CfnParameter;
  hostedZoneNameParam: cdk.CfnParameter;
}

export function createAlbFargateService(
  scope: Construct,
  id: string,
  opts: AlbFargateOptions
): AlbFargateReturn {
  
  // ── CFN Parameters for TLS configuration ─────────────────────────────────────
  const tlsEnabledParam = new cdk.CfnParameter(scope, 'TlsEnabled', {
    type: 'String',
    allowedValues: ['true', 'false'],
    default: 'false',
    description: 'Enable HTTPS/TLS for ALB (creates Route53 record + HTTPS listener)',
  });
  tlsEnabledParam.overrideLogicalId('TlsEnabled');

  const certificateArnParam = new cdk.CfnParameter(scope, 'CertificateArn', {
    type: 'String',
    default: '',
    description: 'ACM certificate ARN for ALB (required if TlsEnabled=true)',
  });
  certificateArnParam.overrideLogicalId('CertificateArn');

  const domainNameParam = new cdk.CfnParameter(scope, 'AlbDomainName', {
    type: 'String',
    default: '',
    description: 'Domain name for ALB (e.g., backend.alb.yourdomain.com)',
  });
  domainNameParam.overrideLogicalId('AlbDomainName');

  const hostedZoneNameParam = new cdk.CfnParameter(scope, 'HostedZoneName', {
    type: 'String',
    default: '',
    description: 'Route53 hosted zone name (e.g., alb.yourdomain.com)',
  });
  hostedZoneNameParam.overrideLogicalId('HostedZoneName');

  // ── Create the ALB Fargate Service ───────────────────────────────────────────
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
    openListener: false,
  });

  // ── Auto Scaling ─────────────────────────────────────────────────────────────
  const scaling = svc.service.autoScaleTaskCount({
    minCapacity: opts.minCount ?? 1,
    maxCapacity: opts.maxCount ?? 2,
  });

  scaling.scaleOnCpuUtilization('CpuScaling', {
    targetUtilizationPercent: 60,
    scaleInCooldown: cdk.Duration.seconds(60),
    scaleOutCooldown: cdk.Duration.seconds(60),
  });

  // ── Health Check ─────────────────────────────────────────────────────────────
  svc.targetGroup.configureHealthCheck({
    port: opts.healthCheck.port,
    path: opts.healthCheck.path,
    healthyHttpCodes: '200-399',
    interval: cdk.Duration.seconds(opts.healthCheck.interval),
    timeout: cdk.Duration.seconds(opts.healthCheck.timeout),
    healthyThresholdCount: opts.healthCheck.healthyThreshold,
    unhealthyThresholdCount: opts.healthCheck.unhealthyThreshold,
  });

  // ── ECR Permissions ──────────────────────────────────────────────────────────
  svc.taskDefinition.executionRole!.addManagedPolicy(
    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
  );
  const repo = ecr.Repository.fromRepositoryName(scope, `${id}RepoImport`, opts.repositoryName);
  repo.grantPull(svc.taskDefinition.executionRole!);

  // ── Security Group Rules (0.0.0.0/0 for both HTTP and HTTPS) ────────────────
  const albSg = svc.loadBalancer.connections.securityGroups[0];

  // TLS condition
  const tlsEnabledCondition = new cdk.CfnCondition(scope, `${id}TlsEnabledCondition`, {
    expression: cdk.Fn.conditionEquals(tlsEnabledParam.valueAsString, 'true'),
  });

  albSg.addIngressRule(
    ec2.Peer.prefixList(getCloudFrontPlId(scope, `${id}CfPl`)),
    ec2.Port.tcpRange(80, 443),
    'Allow CloudFront to ALB 80 to 443'
  );

  // ── HTTPS Listener (conditional) using L1 ────────────────────────────────────
  const httpsListener = new elbv2.CfnListener(scope, `${id}HttpsListener`, {
    loadBalancerArn: svc.loadBalancer.loadBalancerArn,
    port: 443,
    protocol: 'HTTPS',
    certificates: [{
      certificateArn: certificateArnParam.valueAsString,
    }],
    defaultActions: [{
      type: 'forward',
      targetGroupArn: svc.targetGroup.targetGroupArn,
    }],
  });
  httpsListener.cfnOptions.condition = tlsEnabledCondition;

  // ── Route 53 Record (conditional) ────────────────────────────────────────────
  const route53Record = new route53.CfnRecordSet(scope, `${id}Route53Record`, {
    hostedZoneName: cdk.Fn.join('', [hostedZoneNameParam.valueAsString, '.']), // Must end with dot
    name: domainNameParam.valueAsString,
    type: 'A',
    aliasTarget: {
      dnsName: svc.loadBalancer.loadBalancerDnsName,
      hostedZoneId: svc.loadBalancer.loadBalancerCanonicalHostedZoneId,
      evaluateTargetHealth: true,
    },
  });
  route53Record.cfnOptions.condition = tlsEnabledCondition;

  return {
    service: svc,
    tlsEnabledParam,
    tlsEnabledCondition,
    certificateArnParam,
    domainNameParam,
    hostedZoneNameParam,
  };
}