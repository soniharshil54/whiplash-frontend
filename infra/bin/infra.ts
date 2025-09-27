#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraStack } from '../lib/infra-stack';
import { getConfigForStack } from '../lib/config';
import { getRequiredEnvVar } from '../lib/common';

console.log('process.env --- infra.ts');

const baseProjectName = getRequiredEnvVar('PROJECT')
const projectName = `${baseProjectName}-frontend`;
// const version = getRequiredEnvVar('VERSION');
const deployEnv = getRequiredEnvVar('DEPLOY_ENV') as 'dev' | 'staging' | 'prod';

if (!['dev', 'staging', 'prod'].includes(deployEnv)) {
  throw new Error('DEPLOY_ENV must be one of: dev, staging, prod');
}

const app = new cdk.App();

console.log('process.env.PROJECT', process.env.PROJECT);
console.log('process.env.DEPLOY_ENV', process.env.DEPLOY_ENV);
console.log('process.env.VERSION', process.env.VERSION); 

if (!deployEnv || !['dev', 'staging', 'prod'].includes(deployEnv)) {
  throw new Error('Missing required env var: DEPLOY_ENV');
}

const stage = deployEnv;
const config = getConfigForStack(stage);
if (!config) throw new Error(`No config found for stage: ${stage}`);

new InfraStack(app, stage, {
  stackName: `${projectName}-${stage}`, // Option A: short id, explicit stackName
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  stage,
  projectName,
  baseProjectName,
  imageTag: app.node.tryGetContext('version'),
  config,
  appType: 'Frontend',
});
