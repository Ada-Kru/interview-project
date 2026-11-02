#!/usr/bin/env bash
set -euo pipefail

export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_ENDPOINT_URL_S3="${AWS_ENDPOINT_URL_S3:-$AWS_ENDPOINT_URL}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"
export CDK_DEFAULT_ACCOUNT="${CDK_DEFAULT_ACCOUNT:-000000000000}"
export CDK_DEFAULT_REGION="${CDK_DEFAULT_REGION:-$AWS_REGION}"
export CDK_CLI_TELEMETRY="${CDK_CLI_TELEMETRY:-false}"
export CDK_S3_FORCE_PATH_STYLE="${CDK_S3_FORCE_PATH_STYLE:-1}"
export CI="${CI:-true}"
export DEMO_STATE_DIR="${DEMO_STATE_DIR:-/tmp/demo}"
export DEMO_API_PORT="${DEMO_API_PORT:-8080}"
export DEMO_OUTPUTS_FILE="${DEMO_OUTPUTS_FILE:-$DEMO_STATE_DIR/outputs.json}"
export DEMO_DATABASE_ENV_FILE="${DEMO_DATABASE_ENV_FILE:-$DEMO_STATE_DIR/database.env}"

mkdir -p "$DEMO_STATE_DIR"

echo "Waiting for MiniStack at ${AWS_ENDPOINT_URL}..."
node scripts/demo-wait.mjs

echo "Preparing the local Aurora database..."
npm run local-db -- --write-env "$DEMO_DATABASE_ENV_FILE"

set -a
# shellcheck disable=SC1090
source "$DEMO_DATABASE_ENV_FILE"
set +a

echo "Bootstrapping the CDK environment in MiniStack..."
npx --no-install cdk bootstrap "aws://${CDK_DEFAULT_ACCOUNT}/${CDK_DEFAULT_REGION}" --no-color

echo "Deploying InterviewProjectStack..."
npx --no-install cdk deploy InterviewProjectStack \
  --require-approval never \
  --outputs-file "$DEMO_OUTPUTS_FILE" \
  --ci \
  --no-color

echo "Applying database migrations..."
npm run db:migrate -- --reset

echo "Starting the demo API gateway on port ${DEMO_API_PORT}..."
exec node scripts/demo-gateway.mjs
