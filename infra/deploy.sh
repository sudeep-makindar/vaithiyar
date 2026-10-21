#!/bin/bash
# One-command deploy of ClinIQ+ to AWS.
#   ./infra/deploy.sh                 (uses AWS profile "cliniq")
#   ALERT_EMAIL=you@example.com ./infra/deploy.sh   (also creates SNS email alerts + $10 budget)
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-cliniq}"
export JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="$(python3 -c "import json;print(json.load(open('$ROOT/infra/cdk.json'))['context']['region'])")"
CDK="npx -y aws-cdk@2"

echo "==> 1/5 Building frontend"
(cd "$ROOT" && npm run build --silent)

echo "==> 2/5 Building Lambda bundle"
"$ROOT/cliniq-backend/scripts/build_lambda.sh"

echo "==> 3/5 Storing API keys in SSM Parameter Store (SecureString)"
GROQ_KEY="$(grep -E '^GROQ_API_KEY=' "$ROOT/cliniq-backend/.env" | cut -d= -f2-)"
[ -n "$GROQ_KEY" ] || { echo "GROQ_API_KEY missing from cliniq-backend/.env"; exit 1; }
aws ssm put-parameter --region "$REGION" --name /cliniq/groq-api-key --type SecureString \
  --value "$GROQ_KEY" --overwrite >/dev/null
OPENROUTER_KEY="$(grep -E '^OPENROUTER_API_KEY=' "$ROOT/cliniq-backend/.env" | cut -d= -f2- || true)"
if [ -n "$OPENROUTER_KEY" ]; then
  aws ssm put-parameter --region "$REGION" --name /cliniq/openrouter-api-key --type SecureString \
    --value "$OPENROUTER_KEY" --overwrite >/dev/null
fi

echo "==> 4/5 Deploying infrastructure"
cd "$ROOT/infra"
[ -d .venv ] || { uv venv --python 3.12 .venv -q && uv pip install -q --python .venv/bin/python -r requirements.txt; }
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
$CDK bootstrap "aws://$ACCOUNT/$REGION" >/dev/null
$CDK deploy ClinIQPlus --require-approval never --outputs-file outputs.json \
  ${ALERT_EMAIL:+--context alertEmail=$ALERT_EMAIL}

echo "==> 5/5 Loading demo cohort into DynamoDB"
TABLE="$(python3 -c "import json;print(json.load(open('outputs.json'))['ClinIQPlus']['TableName'])")"
(cd "$ROOT/cliniq-backend" && AWS_REGION="$REGION" TABLE_NAME="$TABLE" .venv/bin/python scripts/generate_demo_data.py --target dynamodb)

echo
SITE="$(python3 -c "import json;print(json.load(open('outputs.json'))['ClinIQPlus']['SiteUrl'])")"
echo "Done. Site: $SITE"
echo "Before a demo, pre-generate the AI views:  (cd cliniq-backend && .venv/bin/python scripts/warm_demo.py $SITE)"
