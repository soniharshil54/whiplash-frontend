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

INFRA_DIR="./infra"

# ──────────────── CDK DEPLOY (update stack with new image tag) ────────────────
echo "🚀 Destroying CloudFormation DEPLOY_ENV ${DEPLOY_ENV}"

cd "${INFRA_DIR}"

cdk context --clear
cdk destroy \
  --require-approval never \
  --context stage="${DEPLOY_ENV}"

echo "✅ Frontend destroyed successfully"
