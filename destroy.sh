#!/usr/bin/env bash
set -euo pipefail

# error if .cdk.env file is missing
if [ ! -f .cdk.env ]; then
  echo "Error: .cdk.env file not found!"
  exit 1
fi

# load env variables from .cdk.env file
export $(grep -v '^#' .cdk.env | xargs)

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

STACK_NAME="${PROJECT}-${APP_TYPE}-${DEPLOY_ENV}"
INFRA_DIR="./infra"

# ──────────────── CDK DEPLOY (update stack with new image tag) ────────────────
echo "🚀 Destroying CloudFormation stack ${STACK_NAME}"

cd "${INFRA_DIR}"

cdk context --clear
cdk destroy \
  --require-approval never \
  --context stage="${DEPLOY_ENV}"

echo "✅ ${STACK_NAME} destroyed successfully"
