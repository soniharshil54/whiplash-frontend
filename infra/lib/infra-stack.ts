import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Config } from '../lib/config/types/config';

import { nameResource, getAllEnvVars, getEnvVars } from './common';
import { createAlbFargateService } from './resources/services/alb-fargate';

interface InfraStackProps extends cdk.StackProps {
  stage: string;
  projectName: string;
  config: Config;
  imageTag: string;
  baseProjectName: string;
  appType: 'Backend' | 'Frontend';
}

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: InfraStackProps) {
    super(scope, id, props);

    const { stage, projectName, config, baseProjectName, appType } = props;
    const appTypeLower = appType.toLowerCase();
    const name    = nameResource(projectName, stage);
    const account = cdk.Stack.of(this).account;
    const region  = cdk.Stack.of(this).region;

    const imageTag = props.imageTag;
    const desired  = config.deploymentConfig.service.desiredCount;

    // ─────────────────────────────────────────────────────────────────────────────
    // SSM reads
    // MUST be concrete at synth for fromLookup:
    const vpcId = ssm.StringParameter.valueFromLookup(this, `/${baseProjectName}/${stage}/vpcId`);

    // These can be tokens (resolved at deploy)
    const clusterName = ssm.StringParameter.valueForStringParameter(this, `/${baseProjectName}/${stage}/clusterName`);
    const repoName    = ssm.StringParameter.valueForStringParameter(this, `/${baseProjectName}/${stage}/ecr${appType}RepoName`);
    const bucketName  = ssm.StringParameter.valueForStringParameter(this, `/${baseProjectName}/${stage}/s3BucketName`);

    // Optional: if you also exported public/private subnet ids and want to force placement,
    // you can read them here too (valueForStringParameter is fine).

    // ─────────────────────────────────────────────────────────────────────────────
    // Import VPC via lookup (now allowed because vpcId is a real string)
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId });

    // Import Cluster (needs the VPC object; SSM token for name is fine)
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', {
      clusterName,
      vpc,
      securityGroups: [], // supply if you exported one
    });

    // ECR repo and image
    const repo  = ecr.Repository.fromRepositoryName(this, `${appType}Repo`, repoName);
    const image = ecs.ContainerImage.fromEcrRepository(repo, imageTag);

    // S3 bucket (shared from common-infra)
    const bucket = s3.Bucket.fromBucketName(this, 'AppBucket', bucketName);

    console.log('process.env ---', getAllEnvVars());

    // ─────────────────────────────────────────────────────────────────────────────
    // Service (pattern creates a **public ALB** in the VPC’s public subnets)
    const svc = createAlbFargateService(this, name(`${appType}Service`), {
      cluster,
      cpu: config.deploymentConfig.container.cpu,
      memoryLimitMiB: config.deploymentConfig.container.memory,
      desiredCount: desired,
      image,
      containerName: name(`${appTypeLower}-container`),
      containerPort: config.deploymentConfig.targetGroup.port,
      serviceName: name(`${appTypeLower}-service`),
      repositoryName: repoName,
      healthCheck: config.deploymentConfig.targetGroup.healthCheck,
      publicLoadBalancer: true, // ALB in public subnets
      environment: getEnvVars(['PROJECT', 'VERSION', 'DEPLOY_ENV', 'SAMPLE_VAR_KEY_1', 'SAMPLE_VAR_KEY_2']),
    });

    // App permissions: S3 RW on task role
    bucket.grantReadWrite(svc.taskDefinition.taskRole);

    new cdk.CfnOutput(this, name(`${appType}URL`), {
      value: `http://${svc.loadBalancer.loadBalancerDnsName}`,
    });
  }
}
