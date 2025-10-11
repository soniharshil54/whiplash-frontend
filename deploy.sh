#!/usr/bin/env bash
set -euo pipefail


# =================== Init step start =============================
# error if .cdk.env file is missing
if [ ! -f .cdk.env ]; then
  echo "Error: .cdk.env file not found!"
  exit 1
fi

# load env variables from .cdk.env file
export $(grep -v '^#' .cdk.env | xargs)

# load env variables from .env file if APP_TYPE is 'backend'
if [[ "${APP_TYPE}" == "backend" ]]; then
  if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
  fi
fi

# Validate env variables
echo "Using environment variables:"
echo "  AWS_REGION: ${AWS_REGION}"
echo "  DEPLOY_ENV: ${DEPLOY_ENV}"
echo "  AWS_PROFILE: ${AWS_PROFILE}"
echo "  PROJECT: ${PROJECT}"
echo "  APP_TYPE: ${APP_TYPE}"

# Validate required environment variables
if [[ -z "${AWS_REGION}" || -z "${DEPLOY_ENV}" || -z "${PROJECT}" || -z "${APP_TYPE}" ]]; then
  echo "Error: One or more required environment variables are missing."
  echo "Please ensure AWS_REGION, DEPLOY_ENV, PROJECT, and APP_TYPE are set."
  exit 1
fi

# Other app type should be 'frontend' if APP_TYPE is 'backend' and vice versa
if [[ "${APP_TYPE}" == "backend" ]]; then
  OTHER_APP_TYPE="frontend"
elif [[ "${APP_TYPE}" == "frontend" ]]; then
  OTHER_APP_TYPE="backend"
else
  echo "Error: APP_TYPE must be either 'backend' or 'frontend'"
  exit 1
fi

#  app alb dns keys for parameters to be passed on core stack
APP_ALB_KEY="${APP_TYPE}AlbDns"
OTHER_APP_ALB_KEY="${OTHER_APP_TYPE}AlbDns"

# Automatically derive ALB_DOMAIN_NAME if HOSTED_ZONE_NAME is provided
if [[ -n "${HOSTED_ZONE_NAME:-}" ]]; then
  export ALB_DOMAIN_NAME="${APP_TYPE}.${HOSTED_ZONE_NAME}"
  echo "🌐 Derived ALB_DOMAIN_NAME: ${ALB_DOMAIN_NAME}"
else
  ALB_DOMAIN_NAME=""
fi

# Derive protocol from TLS_ENABLED (true/1/yes → HTTPS, else HTTP)
_tls="${TLS_ENABLED:-false}"
_tls_lower="$(echo "${_tls}" | tr '[:upper:]' '[:lower:]')"
if [[ "${_tls_lower}" == "true" || "${_tls_lower}" == "1" || "${_tls_lower}" == "yes" ]]; then
  ORIGIN_PROTOCOL="HTTPS"
else
  ORIGIN_PROTOCOL="HTTP"
fi
echo "🔐 Origin protocol for ${APP_TYPE}: ${ORIGIN_PROTOCOL}"
APP_PROTOCOL_KEY="${APP_TYPE}AlbProtocol"
echo "${APP_TYPE} Protocol Key: $APP_PROTOCOL_KEY"
OTHER_APP_PROTOCOL_KEY="${OTHER_APP_TYPE}AlbProtocol"
echo "${OTHER_APP_TYPE} Protocol Key: $OTHER_APP_PROTOCOL_KEY"

# TLS validation block
if [[ "${_tls_lower}" == "true" || "${_tls_lower}" == "1" || "${_tls_lower}" == "yes" ]]; then
  if [[ -z "${ALB_DOMAIN_NAME:-}" || -z "${HOSTED_ZONE_NAME:-}" || -z "${CERTIFICATE_ARN:-}" ]]; then
    echo "❌ Error: TLS_ENABLED is true, so ALB_DOMAIN_NAME, HOSTED_ZONE_NAME, and CERTIFICATE_ARN are required."
    echo "Please ensure these environment variables are set correctly before proceeding."
    exit 1
  fi
fi

# Stack name and repo ecr repo name 
ECR_REPO_NAME="${PROJECT}-${DEPLOY_ENV}-${APP_TYPE}"
STACK_NAME="${PROJECT}-${APP_TYPE}-${DEPLOY_ENV}"
CORE_STACK_NAME="${PROJECT}-${DEPLOY_ENV}"
INFRA_DIR="./infra"

# VERSION & IMAGE 
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
VERSION=$(cat VERSION)
export VERSION
IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:${VERSION}"
# ==================== Init step start =============================


# ==================== Docker image build and push step start ====================
echo "🚀 Building and pushing ${APP_TYPE} version: ${VERSION} to ${IMAGE_URI}"
echo "📦 Image URI: ${IMAGE_URI}"
echo "📂 Infra stack: ${STACK_NAME}"

aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

export IMAGE_URI
docker compose -f docker-compose.build.yml build
docker push "${IMAGE_URI}"
# ==================== Docker image build and push step finished ====================

# ==================== CDK DEPLOY step start ====================
echo "🚀 Updating CloudFormation stack ${STACK_NAME} with version ${VERSION}"

cd "${INFRA_DIR}"

cdk context --clear
cdk deploy \
  --require-approval never \
  --context stage="${DEPLOY_ENV}" \
  --context version="${VERSION}" \
  --parameters TlsEnabled="${TLS_ENABLED:-false}" \
  --parameters AlbDomainName="${ALB_DOMAIN_NAME:-}" \
  --parameters HostedZoneName="${HOSTED_ZONE_NAME:-}" \
  --parameters CertificateArn="${CERTIFICATE_ARN:-}"

echo "✅ ${APP_TYPE} ${VERSION} deployed successfully"

# application stack is deployed, now we will deploy core stack with alb received from app
echo "🚀 Updating core infrastructure stack ${CORE_STACK_NAME} with ${APP_TYPE} ALB DNS"
APP_ALB=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query "Stacks[0].Outputs[?contains(OutputKey, '${APP_ALB_KEY}')].OutputValue | [0]" \
  --output text)

if [[ -z "$APP_ALB" || "$APP_ALB" == "None" ]]; then
  echo "❌ Error: Could not retrieve ${APP_TYPE} ALB DNS from CloudFormation outputs"
  exit 1
fi

echo "✅ ${APP_TYPE} ALB DNS: $APP_ALB"

echo "${APP_TYPE} ALB Key: $APP_ALB_KEY, Value: $APP_ALB"
echo "${OTHER_APP_TYPE} ALB Key: $OTHER_APP_ALB_KEY"

aws cloudformation update-stack \
  --stack-name ${CORE_STACK_NAME} \
  --use-previous-template \
  --parameters \
    ParameterKey=$APP_ALB_KEY,ParameterValue=$APP_ALB \
    ParameterKey=$OTHER_APP_ALB_KEY,UsePreviousValue=true \
    ParameterKey=$APP_PROTOCOL_KEY,ParameterValue=$ORIGIN_PROTOCOL \
    ParameterKey=$OTHER_APP_PROTOCOL_KEY,UsePreviousValue=true \
    ParameterKey=EnableCustomDomains,UsePreviousValue=true \
    ParameterKey=CustomDomainsCsv,UsePreviousValue=true \
    ParameterKey=AcmCertificateArnUsEast1,UsePreviousValue=true \
    ParameterKey=EnableAtlasEndpoint,UsePreviousValue=true \
    ParameterKey=AtlasServiceName,UsePreviousValue=true \
  --capabilities CAPABILITY_IAM \
  --no-cli-pager \
  || echo "No updates needed or stack is already updating"

echo "✅ Core infrastructure stack update initiated"
echo "Waiting for stack update to complete..."

# Wait for stack update to complete
aws cloudformation wait stack-update-complete \
  --stack-name ${CORE_STACK_NAME}

echo "✅ Core infrastructure stack ${CORE_STACK_NAME} updated successfully"

echo "Now invalidate cloudfront cache"
DISTRIBUTION_ID=$(aws cloudformation describe-stacks --stack-name ${CORE_STACK_NAME} --query "Stacks[0].Outputs[?contains(OutputKey, 'CloudFrontDistributionId')].OutputValue | [0]" --output text)
echo "Creating invalidation for DISTRIBUTION_ID - $DISTRIBUTION_ID"
aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*" --no-cli-pager
echo "Invalidation created for cloudfront distribution id $DISTRIBUTION_ID"
# ==================== CDK DEPLOY step finish ====================
