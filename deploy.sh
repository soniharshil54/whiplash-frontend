#!/usr/bin/env bash
set -euo pipefail

# ──────────────── CONFIG ────────────────
: "${AWS_REGION:=us-east-1}"
: "${STAGE:=dev}"
PROJECT="whiplash"
REPO_NAME="${PROJECT}-${STAGE}-frontend"
STACK_NAME="${PROJECT}-${STAGE}"
INFRA_DIR="../whiplash-infra"

# ──────────────── VERSION & IMAGE ────────────────
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
VERSION=$(cat VERSION)
IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${VERSION}"

echo "🚀 Deploying frontend version: ${VERSION}"
echo "📦 Image URI: ${IMAGE_URI}"
echo "📂 Infra stack: ${STACK_NAME}"

# ──────────────── ECR REPO ────────────────
if ! aws ecr describe-repositories --repository-names "${REPO_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1; then
  echo "📦 Creating ECR repository: ${REPO_NAME}"
  aws ecr create-repository --repository-name "${REPO_NAME}" --region "${AWS_REGION}"
fi

# ──────────────── DOCKER BUILD & PUSH ────────────────
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

export IMAGE_URI
docker compose -f docker-compose.build.yml build
docker push "${IMAGE_URI}"

# (Optional) sanity: ensure manifest has amd64
# docker buildx imagetools inspect "${IMAGE_URI}" | grep -q "linux/amd64" || { echo "No amd64 in manifest"; exit 1; }

# ──────────────── CDK DEPLOY (update stack with new image tag) ────────────────
echo "🚀 Updating CloudFormation stack ${STACK_NAME} with FrontendImageTag=${VERSION}"

cd "${INFRA_DIR}"

cdk deploy \
  --require-approval never \
  --context stage="${STAGE}" \
  --parameters FrontendImageTag="${VERSION}"

cd - >/dev/null

echo "✅ Frontend ${VERSION} deployed successfully"
