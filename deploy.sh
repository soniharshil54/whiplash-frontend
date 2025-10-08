#!/usr/bin/env bash
set -euo pipefail

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

REPO_NAME="${PROJECT}-${DEPLOY_ENV}-${APP_TYPE}"
STACK_NAME="${PROJECT}-${APP_TYPE}-${DEPLOY_ENV}"
CORE_STACK_NAME="${PROJECT}-${DEPLOY_ENV}"
INFRA_DIR="./infra"

# ──────────────── VERSION & IMAGE ────────────────
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
VERSION=$(cat VERSION)
export VERSION
IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${VERSION}"

echo "🚀 Deploying ${APP_TYPE} version: ${VERSION}"
echo "📦 Image URI: ${IMAGE_URI}"
echo "📂 Infra stack: ${STACK_NAME}"

# ──────────────── DOCKER BUILD & PUSH ────────────────
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

export IMAGE_URI
docker compose -f docker-compose.build.yml build
docker push "${IMAGE_URI}"

# ──────────────── CDK DEPLOY (update stack with new image tag) ────────────────
echo "🚀 Updating CloudFormation stack ${STACK_NAME} with version ${VERSION}"

cd "${INFRA_DIR}"

cdk context --clear
cdk deploy \
  --require-approval never \
  --context stage="${DEPLOY_ENV}" \
  --context version="${VERSION}"

echo "✅ ${APP_TYPE} ${VERSION} deployed successfully"

APP_ALB_KEY="${APP_TYPE}AlbDns"
APP_ALB=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query "Stacks[0].Outputs[?contains(OutputKey, '${APP_ALB_KEY}')].OutputValue | [0]" \
  --output text)

if [[ -z "$APP_ALB" || "$APP_ALB" == "None" ]]; then
  echo "❌ Error: Could not retrieve ${APP_TYPE} ALB DNS from CloudFormation outputs"
  exit 1
fi

echo "✅ ${APP_TYPE} ALB DNS: $APP_ALB"

echo "🚀 Updating core infrastructure stack ${CORE_STACK_NAME} with ${APP_TYPE} ALB DNS"

echo "${APP_TYPE} ALB Key: $APP_ALB_KEY, Value: $APP_ALB"
OTHER_APP_ALB_KEY="${OTHER_APP_TYPE}AlbDns"
echo "${OTHER_APP_TYPE} ALB Key: $OTHER_APP_ALB_KEY"
aws cloudformation update-stack \
  --stack-name ${CORE_STACK_NAME} \
  --use-previous-template \
  --parameters \
    ParameterKey=$APP_ALB_KEY,ParameterValue=$APP_ALB \
    ParameterKey=$OTHER_APP_ALB_KEY,UsePreviousValue=true \
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

# Wait for stack update to complete (optional)
aws cloudformation wait stack-update-complete \
  --stack-name ${CORE_STACK_NAME}

echo "✅ Core infrastructure stack ${CORE_STACK_NAME} updated successfully"
