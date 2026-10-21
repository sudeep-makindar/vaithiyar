# ClinIQ+ on AWS: Services We Implemented and How

ClinIQ+ runs on a **serverless AWS architecture**: no servers to manage, and resources scale automatically with usage. Every resource is created from code using **AWS CDK (Python)**.

- **Live site:** https://dcngngptdqg14.cloudfront.net
- **Region:** `ap-southeast-2` (Sydney)
- **Infrastructure code:** `infra/cliniq_stack.py` (28 AWS resources)

---

## Architecture at a glance

```
User (browser / Android app)
        │
        ▼
Amazon CloudFront ──────────────► Amazon S3 (website files)
        │  /api/*
        ▼
AWS Lambda (FastAPI backend, response streaming)
        │
        ├──► Amazon DynamoDB        patient data, AI cache, logs, calendar
        ├──► Amazon S3              uploads and PDF reports
        ├──► AWS SSM Parameter Store  encrypted API keys
        ├──► Amazon Polly           Indian-voice text-to-speech
        ├──► Amazon SNS             clinical alerts to the doctor
        ├──► Amazon Bedrock         backup AI model (Amazon Nova)
        └──► Amazon CloudWatch      logs, dashboard, alarm
```

---

## 1. Amazon CloudFront: content delivery and routing

**Purpose:** the single, secure entry point for the whole application.

**How we implemented it**
- One CloudFront **distribution** with two behaviours:
  - `/*` (default) serves the React app from the S3 website bucket through **Origin Access Control (OAC)**
  - `/api/*` goes to the Lambda **Function URL** (all HTTP methods, caching disabled, all viewer headers forwarded except Host)
- **HTTPS only:** HTTP requests are redirected to HTTPS.
- **CloudFront Function** (JavaScript, viewer-request): rewrites extension-less paths such as `/patient/P-00142` to `/index.html`, so single-page-app routes load without masking real API 404s.
- **Custom origin header** `x-origin-verify` holds a secret value. The backend rejects any API request without it, so the Lambda URL can only be used through CloudFront.
- **Origin read timeout** raised to 60 seconds for long AI responses.
- Price class 200, which includes edge locations in India.

**CDK constructs:** `cloudfront.Distribution`, `origins.S3BucketOrigin.with_origin_access_control`, `origins.FunctionUrlOrigin`, `cloudfront.Function`

---

## 2. Amazon S3: storage

**Purpose:** host the website and store clinical files.

**How we implemented it: two buckets**

| Bucket | Contents | Configuration |
|---|---|---|
| **Site bucket** | Built React app (`dist/`) | All public access blocked; readable only by CloudFront (OAC); S3-managed encryption; TLS enforced |
| **Files bucket** | Intake documents, pill photos, consultation and symptom audio, generated PDF reports | All public access blocked; S3-managed encryption; TLS enforced; **lifecycle rule** deletes `uploads/` after 30 days |

- The website is deployed with CDK `BucketDeployment`, which uploads `dist/` and **invalidates the CloudFront cache** automatically.
- The backend archives files with `archive_to_s3()` in `cliniq-backend/services/aws.py`, using keys like `uploads/intake/2026/10/21/<id>-discharge_summary.pdf` and `reports/<patient-id>/...`.
- Archiving is best-effort, so a storage failure never breaks a clinical request.

---

## 3. AWS Lambda: serverless backend

**Purpose:** run the entire FastAPI (Python) backend without servers.

**How we implemented it**
- **Runtime:** Python 3.12 on **arm64 (Graviton)**; 1,536 MB memory; 120-second timeout.
- **Lambda Web Adapter** (AWS-published layer) runs the existing FastAPI/uvicorn app **without code changes**. The entry script `run.sh` starts uvicorn, and the adapter forwards Lambda invocations to it.
- **Function URL** with `InvokeMode = RESPONSE_STREAM`, so AI answers stream to the browser token by token (Server-Sent Events).
- **Packaging without Docker:** `scripts/build_lambda.sh` downloads prebuilt Linux ARM64 wheels for Python 3.12 and copies in the app code, giving a 151 MB bundle.
- **Configuration through environment variables:** table name, bucket name, SNS topic ARN, SSM parameter names, Bedrock model ID, origin secret.
- **Writable paths** (matplotlib charts, PDF generation) use `/tmp`.
- **Readiness check:** the adapter waits for `/api/health` before serving traffic.

**CDK constructs:** `lambda_.Function`, `LayerVersion.from_layer_version_arn` (Web Adapter), `add_function_url(invoke_mode=RESPONSE_STREAM)`

---

## 4. Amazon DynamoDB: database

**Purpose:** store all application data.

**How we implemented it**
- **One table, single-table design:** partition key `pk`, sort key `sk`; **on-demand** capacity.
- **Time-To-Live (TTL)** on the `ttl` attribute, so AI cache entries expire automatically after 24 hours.
- Item layout:

| `pk` | `sk` | Stores |
|---|---|---|
| `PATIENT` | patient ID | Full patient record (diagnoses, medicines, 24-month labs, alerts) |
| `META` | `PILL_EVENTS`, `INTERACTIONS`, `CALENDAR_EVENTS` | Shared reference data and doctor-added events |
| `FORECAST#<id>` | `LATEST` | AI 12-month forecast (TTL) |
| `COMORBIDITY#<id>` | `LATEST` | AI comorbidity graph (TTL) |
| `ORGAN#<id>` | organ name | AI organ assessment |
| `ALERT_EXPLAIN` | alert ID | AI alert explanation |
| `NOTE#<id>`, `VOICE_INT#<id>`, `SECOND_OPINION#<id>` | timestamp + ID | Clinical logs, newest first |
| `VOICE_CMD#<doctor>` | timestamp + ID | Voice-command log |
| `PREFS` | doctor ID | Voice preferences |

- **Code:** `services/store.py` (patients) and `services/dynamo_service.py` (cache and logs).
- **Switchable storage:** setting `STORAGE_BACKEND=dynamodb` on Lambda switches the same code from local JSON/SQLite files to DynamoDB.
- **Data loading:** `scripts/generate_demo_data.py --target dynamodb`.

---

## 5. AWS Systems Manager Parameter Store: secrets

**Purpose:** keep API keys out of the code.

**How we implemented it**
- Two **SecureString** (encrypted) parameters:
  - `/cliniq/groq-api-key`
  - `/cliniq/openrouter-api-key`
- The deploy script writes them from the local `.env` file with `aws ssm put-parameter --type SecureString`.
- On each cold start, `load_secrets_into_env()` reads both with decryption **before** any AI module loads.
- IAM allows the Lambda to read **only these two parameters**.

---

## 6. Amazon Polly: text-to-speech

**Purpose:** speak replies to patients in a natural Indian voice.

**How we implemented it**
- Endpoint `POST /api/voice/synthesize` calls `polly.synthesize_speech` with:
  - **Neural** engine, voice **"Kajal"** for `en-IN` and `hi-IN` (Joanna and Amy for US and UK English)
  - **SSML** `<prosody rate>` to control speaking speed
  - MP3 output, returned to the browser as base64
- The frontend (`useVoice.js`) plays Polly's audio, and uses the browser's voice for languages Polly doesn't cover.

---

## 7. Amazon SNS: clinical alerts

**Purpose:** notify the doctor about urgent patient reports.

**How we implemented it**
- One SNS **topic** ("ClinIQ+ clinical alerts"); an email subscription is added through the CDK context `alertEmail`.
- In `POST /api/voice/patient-symptom`, when the AI rates a patient's spoken symptom **severity 7/10 or higher**, the backend publishes a JSON alert: patient ID, complaint, severity, duration, associated symptoms and the English translation.
- **Code:** `publish_alert()` in `services/aws.py`; IAM grants publish rights to this topic only.

---

## 8. Amazon Bedrock: backup AI model

**Purpose:** keep AI features working if the external AI providers fail.

**How we implemented it**
- Model: **Amazon Nova Lite** through the APAC cross-region inference profile `apac.amazon.nova-lite-v1:0`.
- Called with the Bedrock **Converse API**: `converse` for full answers, `converse_stream` for live streaming.
- It is the third level of the AI failover chain in `services/llm.py` and `services/ai_service.py`:

```
Groq (GPT-OSS 20B → GPT-OSS 120B → Qwen) → OpenRouter (Llama 3.1 8B) → Amazon Bedrock (Nova Lite)
```

- IAM allows `InvokeModel` and `InvokeModelWithResponseStream` on Amazon Nova models only.

---

## 9. Amazon CloudWatch: monitoring

**Purpose:** see what the system is doing and catch errors.

**How we implemented it**
- **Log group** for the Lambda function, with **1-week retention**; it records every request, AI failover event and error.
- **Dashboard "ClinIQ-Plus"** with three widgets:
  - Lambda invocations and errors
  - Lambda duration (p50 and p95)
  - DynamoDB consumed read and write capacity
- **Alarm:** triggers when the API has 5 or more errors within 5 minutes.

---

## 10. AWS IAM: security and permissions

**Purpose:** give each component only the access it needs.

**How we implemented it: Lambda execution role (least privilege)**

| Permission | Scope |
|---|---|
| DynamoDB read/write | Our one table only |
| S3 read/write | Files bucket only |
| SNS publish | Alerts topic only |
| SSM `GetParameter` | The two key parameters only |
| Polly `SynthesizeSpeech` | Text-to-speech |
| Bedrock invoke | Amazon Nova models and inference profiles only |

The site bucket is readable **only by our CloudFront distribution** (OAC bucket policy). Both buckets enforce TLS.

---

## 11. AWS CDK + CloudFormation: infrastructure as code

**Purpose:** create, update and delete the whole system from code.

**How we implemented it**
- **CDK app in Python:** `infra/app.py` and `infra/cliniq_stack.py` define one stack, **`ClinIQPlus`**.
- CDK synthesises a **CloudFormation** template, and CloudFormation creates all 28 resources.
- Settings live in `infra/cdk.json` (region, Bedrock model, OpenRouter model, Web Adapter layer version).
- `infra/deploy.sh` runs everything in one command:
  1. Builds the React frontend
  2. Builds the Lambda bundle
  3. Stores API keys in SSM Parameter Store
  4. Runs `cdk bootstrap` and `cdk deploy`
  5. Loads the patient dataset into DynamoDB
- `infra/destroy.sh` removes the stack and parameters in one command. Buckets are auto-emptied on delete.
- **Stack outputs:** site URL, table name, bucket name, SNS topic ARN, dashboard URL.

---

## End-to-end example: uploading a discharge summary

1. The doctor uploads a PDF on the **AI Intake** page.
2. The request reaches **CloudFront**, which adds the secret header and forwards it to **Lambda**.
3. Lambda archives the original PDF to the **S3** files bucket.
4. The AI extracts diagnoses, medicines and vitals (using the API key from **SSM**).
5. The doctor approves. Lambda merges the data into the patient record in **DynamoDB** and recalculates the risk score and alerts.
6. The dashboard shows the new alert; every step is logged in **CloudWatch**.
