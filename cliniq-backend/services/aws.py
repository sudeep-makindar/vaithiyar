"""
AWS integration layer for ClinIQ+.

Every AWS feature is opt-in through environment variables, so the backend still runs
fully offline on a laptop (STORAGE_BACKEND=local, no AWS credentials needed).

On AWS Lambda the CDK stack sets:
  STORAGE_BACKEND=dynamodb, TABLE_NAME, FILES_BUCKET, ALERTS_TOPIC_ARN,
  GROQ_API_KEY_PARAM / OPENROUTER_API_KEY_PARAM (SSM SecureString names), BEDROCK_MODEL_ID, AWS_AI_SERVICES=1
"""
import os
import json
import uuid
from datetime import datetime
from functools import lru_cache

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()
TABLE_NAME = os.getenv("TABLE_NAME", "")
FILES_BUCKET = os.getenv("FILES_BUCKET", "")
ALERTS_TOPIC_ARN = os.getenv("ALERTS_TOPIC_ARN", "")
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "")
AWS_AI_SERVICES = os.getenv("AWS_AI_SERVICES", "0") == "1"
# Translate can be switched off on its own (e.g. not permitted in the deployment region)
AWS_TRANSLATE = AWS_AI_SERVICES and os.getenv("AWS_TRANSLATE", "1") == "1"
IS_LAMBDA = bool(os.getenv("AWS_LAMBDA_FUNCTION_NAME"))

# Lambda only allows writes under /tmp
WRITABLE_DIR = "/tmp" if IS_LAMBDA else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@lru_cache(maxsize=None)
def client(service: str):
    import boto3
    from botocore.config import Config
    return boto3.client(service, config=Config(retries={"max_attempts": 3, "mode": "standard"}))


def load_secrets_into_env():
    """Fetch API keys from SSM Parameter Store once per cold start.
    Each <NAME>_PARAM env var names the SecureString that holds <NAME>."""
    for env_name in ("GROQ_API_KEY", "OPENROUTER_API_KEY"):
        param = os.getenv(f"{env_name}_PARAM")
        if not param or os.getenv(env_name):
            continue
        try:
            os.environ[env_name] = client("ssm").get_parameter(Name=param, WithDecryption=True)["Parameter"]["Value"]
        except Exception as e:
            print(f"[aws] Could not load {param} from SSM: {e}")


def archive_to_s3(prefix: str, data: bytes, content_type: str, filename: str = "") -> str | None:
    """Best-effort copy of an upload or generated file into the S3 files bucket.
    Never raises: archiving must not break the clinical request that triggered it."""
    if not FILES_BUCKET or not data:
        return None
    key = f"{prefix}/{datetime.utcnow():%Y/%m/%d}/{uuid.uuid4().hex[:8]}-{filename or 'file'}"
    try:
        client("s3").put_object(Bucket=FILES_BUCKET, Key=key, Body=data, ContentType=content_type)
        return key
    except Exception as e:
        print(f"[aws] S3 archive failed for {key}: {e}")
        return None


def presigned_url(key: str, expires: int = 900) -> str | None:
    if not FILES_BUCKET or not key:
        return None
    try:
        return client("s3").generate_presigned_url(
            "get_object", Params={"Bucket": FILES_BUCKET, "Key": key}, ExpiresIn=expires
        )
    except Exception as e:
        print(f"[aws] presign failed for {key}: {e}")
        return None


def publish_alert(subject: str, message: dict):
    """Fan out a clinical alert through SNS (email/SMS subscribers)."""
    if not ALERTS_TOPIC_ARN:
        return
    try:
        client("sns").publish(
            TopicArn=ALERTS_TOPIC_ARN,
            Subject=subject[:100],
            Message=json.dumps(message, indent=2, default=str),
        )
    except Exception as e:
        print(f"[aws] SNS publish failed: {e}")


# --- Amazon Translate ---------------------------------------------------------

def _translate_code(code: str) -> str:
    # Frontend sends BCP-47 codes like "hi-IN"; Translate wants "hi". "auto" passes through.
    return (code or "auto").split("-")[0].lower()


def translate_text(text: str, source: str, target: str) -> str | None:
    if not AWS_TRANSLATE:
        return None
    try:
        res = client("translate").translate_text(
            Text=text,
            SourceLanguageCode=_translate_code(source),
            TargetLanguageCode=_translate_code(target),
        )
        return res["TranslatedText"]
    except Exception as e:
        print(f"[aws] Translate failed, falling back to LLM: {e}")
        return None


# --- Amazon Polly -------------------------------------------------------------

# Neural voices Polly offers for the Indian languages the app supports.
POLLY_VOICES = {
    "en-IN": ("Kajal", "en-IN"),
    "hi-IN": ("Kajal", "hi-IN"),
    "en-US": ("Joanna", "en-US"),
    "en-GB": ("Amy", "en-GB"),
}


def synthesize_speech(text: str, language_code: str, speed: float = 1.0) -> bytes | None:
    if not AWS_AI_SERVICES or language_code not in POLLY_VOICES:
        return None
    voice, lang = POLLY_VOICES[language_code]
    rate = f"{int(max(0.5, min(speed, 2.0)) * 100)}%"
    ssml = f'<speak><prosody rate="{rate}">{_escape_ssml(text)}</prosody></speak>'
    try:
        res = client("polly").synthesize_speech(
            Text=ssml, TextType="ssml", VoiceId=voice, LanguageCode=lang,
            Engine="neural", OutputFormat="mp3",
        )
        return res["AudioStream"].read()
    except Exception as e:
        print(f"[aws] Polly failed: {e}")
        return None


def _escape_ssml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# --- Amazon Bedrock (failover LLM) --------------------------------------------

def bedrock_available() -> bool:
    return bool(BEDROCK_MODEL_ID)


def bedrock_generate(prompt: str, max_tokens: int = 1500) -> str:
    res = client("bedrock-runtime").converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": 0.3},
    )
    return "".join(b.get("text", "") for b in res["output"]["message"]["content"])


def bedrock_stream(prompt: str, max_tokens: int = 1500):
    res = client("bedrock-runtime").converse_stream(
        modelId=BEDROCK_MODEL_ID,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": 0.3},
    )
    for event in res["stream"]:
        delta = event.get("contentBlockDelta", {}).get("delta", {})
        if delta.get("text"):
            yield delta["text"]
