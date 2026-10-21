#!/usr/bin/env python3
import os
import secrets

import aws_cdk as cdk

from cliniq_stack import ClinIQStack

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Shared secret CloudFront sends to the Lambda Function URL. Generated once and kept
# out of git, so redeploys don't rotate it needlessly.
secret_file = os.path.join(HERE, ".origin-secret")
if not os.path.exists(secret_file):
    with open(secret_file, "w") as f:
        f.write(secrets.token_urlsafe(32))
with open(secret_file) as f:
    origin_secret = f.read().strip()

app = cdk.App()
ClinIQStack(
    app, "ClinIQPlus",
    origin_secret=origin_secret,
    backend_bundle=os.path.join(ROOT, "cliniq-backend", ".lambda-build"),
    frontend_dist=os.path.join(ROOT, "dist"),
    env=cdk.Environment(
        account=os.getenv("CDK_DEFAULT_ACCOUNT"),
        region=app.node.try_get_context("region") or "ap-south-1",
    ),
)
app.synth()
