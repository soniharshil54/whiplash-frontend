#!/usr/bin/env bash
set -euo pipefail

# load env variables from .env file if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "Using environment variables:"
echo "  AWS_REGION: ${AWS_REGION}"
echo "  DEPLOY_ENV: ${DEPLOY_ENV}"
echo "  AWS_PROFILE: ${AWS_PROFILE}"

REPO_NAME="${PROJECT}-${DEPLOY_ENV}-frontend"
STACK_NAME="${PROJECT}-${DEPLOY_ENV}"
INFRA_DIR="./infra"

# ──────────────── VERSION & IMAGE ────────────────
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
VERSION=$(cat VERSION)
export VERSION
IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${VERSION}"

echo "🚀 Deploying frontend version: ${VERSION}"
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

echo "✅ Frontend ${VERSION} deployed successfully"

FRONTEND_ALB=$(aws cloudformation describe-stacks \
  --stack-name whiplash-frontend-dev \
  --query "Stacks[0].Outputs[?contains(OutputKey, 'FrontendAlbDns')].OutputValue | [0]" \
  --output text)

if [ -z "$FRONTEND_ALB" ] || [ "$FRONTEND_ALB" = "None" ]; then
  echo "❌ Error: Could not retrieve Frontend ALB DNS from CloudFormation outputs"
  exit 1
fi

echo "✅ Frontend ALB DNS: $FRONTEND_ALB"

echo "🚀 Updating core infrastructure stack ${PROJECT}-${DEPLOY_ENV}"

parameterKey="FrontendAlbDns"
echo "Parameter Key: $parameterKey"
aws cloudformation update-stack \
  --stack-name ${PROJECT}-${DEPLOY_ENV} \
  --use-previous-template \
  --parameters \
    ParameterKey=$parameterKey,ParameterValue=$FRONTEND_ALB \
    ParameterKey=BackendAlbDns,UsePreviousValue=true \
  --capabilities CAPABILITY_IAM \
  --no-cli-pager \
  || echo "No updates needed or stack is already updating"

# Wait for stack update to complete (optional)
aws cloudformation wait stack-update-complete \
  --stack-name ${PROJECT}-${DEPLOY_ENV}
