"""
ClinIQ+ on AWS: a fully serverless stack sized for a student credit budget.

  Browser ──► CloudFront ──┬─► S3 (React build, private via Origin Access Control)
                           └─► /api/*  Lambda Function URL (FastAPI via Lambda Web Adapter, streaming SSE)
                                         ├─► DynamoDB  single table, on-demand, TTL caches
                                         ├─► S3        uploads + generated PDF reports
                                         ├─► SNS       high-severity symptom alerts
                                         ├─► SSM       Groq + OpenRouter API keys (SecureString)
                                         └─► Polly · Translate (optional) · Bedrock (Nova failover LLM)

Nothing here bills per hour while idle: no NAT gateway, load balancer, or always-on compute.
"""
from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    Tags,
    aws_budgets as budgets,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_cloudwatch as cw,
    aws_dynamodb as dynamodb,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_logs as logs,
    aws_s3 as s3,
    aws_s3_deployment as s3deploy,
    aws_sns as sns,
    aws_sns_subscriptions as subs,
)
from constructs import Construct

GROQ_KEY_PARAM = "/cliniq/groq-api-key"
OPENROUTER_KEY_PARAM = "/cliniq/openrouter-api-key"


class ClinIQStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, *, origin_secret: str,
                 backend_bundle: str, frontend_dist: str, **kwargs):
        super().__init__(scope, construct_id, **kwargs)
        ctx = self.node.try_get_context
        Tags.of(self).add("project", "cliniq")

        # ---------- Data ----------
        table = dynamodb.Table(
            self, "Data",
            partition_key=dynamodb.Attribute(name="pk", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="sk", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="ttl",
            removal_policy=RemovalPolicy.DESTROY,
        )

        files = s3.Bucket(
            self, "Files",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            lifecycle_rules=[s3.LifecycleRule(prefix="uploads/", expiration=Duration.days(30))],
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        alerts = sns.Topic(self, "ClinicalAlerts", display_name="ClinIQ+ clinical alerts")
        alert_email = ctx("alertEmail")
        if alert_email:
            alerts.add_subscription(subs.EmailSubscription(alert_email))

        # ---------- API (FastAPI on Lambda) ----------
        lwa_layer = lambda_.LayerVersion.from_layer_version_arn(
            self, "WebAdapter",
            f"arn:aws:lambda:{self.region}:753240598075:layer:LambdaAdapterLayerArm64:{ctx('lwaLayerVersion')}",
        )
        log_group = logs.LogGroup(self, "ApiLogs", retention=logs.RetentionDays.ONE_WEEK,
                                  removal_policy=RemovalPolicy.DESTROY)
        api = lambda_.Function(
            self, "Api",
            runtime=lambda_.Runtime.PYTHON_3_12,
            architecture=lambda_.Architecture.ARM_64,
            handler="run.sh",
            code=lambda_.Code.from_asset(backend_bundle),
            layers=[lwa_layer],
            memory_size=1536,
            timeout=Duration.seconds(120),
            log_group=log_group,
            environment={
                "AWS_LAMBDA_EXEC_WRAPPER": "/opt/bootstrap",
                "AWS_LWA_INVOKE_MODE": "response_stream",
                "AWS_LWA_READINESS_CHECK_PATH": "/api/health",
                "PORT": "8000",
                "HOME": "/tmp",
                "MPLCONFIGDIR": "/tmp/matplotlib",
                "STORAGE_BACKEND": "dynamodb",
                "TABLE_NAME": table.table_name,
                "FILES_BUCKET": files.bucket_name,
                "ALERTS_TOPIC_ARN": alerts.topic_arn,
                "GROQ_API_KEY_PARAM": GROQ_KEY_PARAM,
                "OPENROUTER_API_KEY_PARAM": OPENROUTER_KEY_PARAM,
                "OPENROUTER_MODEL": ctx("openrouterModel"),
                "BEDROCK_MODEL_ID": ctx("bedrockModelId"),
                "AWS_AI_SERVICES": "1",
                "AWS_TRANSLATE": "1" if ctx("translateEnabled") else "0",
                "ORIGIN_VERIFY_SECRET": origin_secret,
            },
        )
        table.grant_read_write_data(api)
        files.grant_read_write(api)
        alerts.grant_publish(api)
        api.add_to_role_policy(iam.PolicyStatement(
            actions=["ssm:GetParameter"],
            resources=[f"arn:aws:ssm:{self.region}:{self.account}:parameter{p}"
                       for p in (GROQ_KEY_PARAM, OPENROUTER_KEY_PARAM)],
        ))
        api.add_to_role_policy(iam.PolicyStatement(
            actions=["polly:SynthesizeSpeech", "translate:TranslateText", "comprehend:DetectDominantLanguage"],
            resources=["*"],
        ))
        api.add_to_role_policy(iam.PolicyStatement(
            actions=["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            resources=["arn:aws:bedrock:*::foundation-model/amazon.nova-*",
                       f"arn:aws:bedrock:*:{self.account}:inference-profile/*"],
        ))
        api_url = api.add_function_url(
            auth_type=lambda_.FunctionUrlAuthType.NONE,
            invoke_mode=lambda_.InvokeMode.RESPONSE_STREAM,
        )

        # ---------- Frontend + CDN ----------
        site = s3.Bucket(
            self, "Site",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )
        # SPA routing: extension-less paths serve index.html. Done in a CloudFront Function
        # rather than error responses so real API 404s are not rewritten.
        spa_rewrite = cloudfront.Function(
            self, "SpaRewrite",
            runtime=cloudfront.FunctionRuntime.JS_2_0,
            code=cloudfront.FunctionCode.from_inline(
                "function handler(event) {\n"
                "  var r = event.request;\n"
                "  if (!r.uri.includes('.')) { r.uri = '/index.html'; }\n"
                "  return r;\n"
                "}"
            ),
        )
        distribution = cloudfront.Distribution(
            self, "Cdn",
            comment="ClinIQ+ web + API",
            default_root_object="index.html",
            price_class=cloudfront.PriceClass.PRICE_CLASS_200,  # includes India edge locations
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(site),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
                function_associations=[cloudfront.FunctionAssociation(
                    function=spa_rewrite, event_type=cloudfront.FunctionEventType.VIEWER_REQUEST)],
            ),
            additional_behaviors={
                "/api/*": cloudfront.BehaviorOptions(
                    origin=origins.FunctionUrlOrigin(
                        api_url,
                        read_timeout=Duration.seconds(60),
                        custom_headers={"x-origin-verify": origin_secret},
                    ),
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
                    cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                    origin_request_policy=cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                ),
            },
        )
        s3deploy.BucketDeployment(
            self, "DeploySite",
            sources=[s3deploy.Source.asset(frontend_dist)],
            destination_bucket=site,
            distribution=distribution,
            distribution_paths=["/*"],
        )

        # ---------- Observability & cost guardrails ----------
        dashboard = cw.Dashboard(self, "Dashboard", dashboard_name="ClinIQ-Plus")
        dashboard.add_widgets(
            cw.GraphWidget(title="API invocations / errors",
                           left=[api.metric_invocations(), api.metric_errors()]),
            cw.GraphWidget(title="API duration (p50 / p95)",
                           left=[api.metric_duration(statistic="p50"), api.metric_duration(statistic="p95")]),
            cw.GraphWidget(title="DynamoDB consumed capacity",
                           left=[table.metric_consumed_read_capacity_units(),
                                 table.metric_consumed_write_capacity_units()]),
        )
        cw.Alarm(self, "ApiErrors", metric=api.metric_errors(period=Duration.minutes(5)),
                 threshold=5, evaluation_periods=1,
                 alarm_description="ClinIQ+ API errors in the last 5 minutes")

        if alert_email:
            budgets.CfnBudget(
                self, "MonthlyBudget",
                budget=budgets.CfnBudget.BudgetDataProperty(
                    budget_type="COST", time_unit="MONTHLY",
                    budget_limit=budgets.CfnBudget.SpendProperty(amount=ctx("monthlyBudgetUsd"), unit="USD"),
                ),
                notifications_with_subscribers=[
                    budgets.CfnBudget.NotificationWithSubscribersProperty(
                        notification=budgets.CfnBudget.NotificationProperty(
                            comparison_operator="GREATER_THAN", notification_type=kind,
                            threshold=pct, threshold_type="PERCENTAGE"),
                        subscribers=[budgets.CfnBudget.SubscriberProperty(
                            subscription_type="EMAIL", address=alert_email)],
                    )
                    for kind, pct in [("ACTUAL", 50), ("ACTUAL", 100), ("FORECASTED", 100)]
                ],
            )

        CfnOutput(self, "SiteUrl", value=f"https://{distribution.distribution_domain_name}")
        CfnOutput(self, "TableName", value=table.table_name)
        CfnOutput(self, "FilesBucket", value=files.bucket_name)
        CfnOutput(self, "AlertsTopic", value=alerts.topic_arn)
        CfnOutput(self, "DashboardUrl",
                  value=f"https://{self.region}.console.aws.amazon.com/cloudwatch/home#dashboards/dashboard/ClinIQ-Plus")
