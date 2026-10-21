#!/bin/bash
# Deletes every ClinIQ+ AWS resource so nothing keeps consuming credits.
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-cliniq}"
export JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1
cd "$(dirname "$0")"
npx -y aws-cdk@2 destroy ClinIQPlus --force
REGION="$(python3 -c "import json;print(json.load(open('cdk.json'))['context']['region'])")"
aws ssm delete-parameter --region "$REGION" --name /cliniq/groq-api-key 2>/dev/null || true
aws ssm delete-parameter --region "$REGION" --name /cliniq/openrouter-api-key 2>/dev/null || true
echo "ClinIQ+ removed from AWS."
