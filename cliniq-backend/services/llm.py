"""
Single LLM gateway for ClinIQ+, backed by Groq (OpenAI-compatible API).

  text / JSON / tool calling -> GROQ_TEXT_MODELS  (default openai/gpt-oss-20b, then backups)
  vision (pills, scans)      -> GROQ_VISION_MODEL (default qwen/qwen3.8-27b)
  speech-to-text             -> GROQ_AUDIO_MODEL  (default whisper-large-v3)

Failover chain for text: Groq models -> OpenRouter (Llama 3.1 8B, OPENROUTER_API_KEY)
-> Amazon Bedrock (BEDROCK_MODEL_ID, see services/aws.py) -> offline fallbacks.
Every agent and router goes through this module, so swapping providers is a one-file change.
"""
import base64
import io
import json
import os
import re
import time

import httpx

from services import aws

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
# Comma-separated: the first is primary; the rest are used only when it is rate-limited.
# Groq's free tier caps each model at ~8k tokens/minute, and each model has its own bucket.
TEXT_MODELS = [m.strip() for m in os.getenv(
    "GROQ_TEXT_MODELS", "openai/gpt-oss-20b,openai/gpt-oss-120b,qwen/qwen3.8-27b").split(",") if m.strip()]
VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
AUDIO_MODEL = os.getenv("GROQ_AUDIO_MODEL", "whisper-large-v3")

_http = httpx.Client(base_url=GROQ_BASE_URL, timeout=httpx.Timeout(90.0, connect=10.0))


def _headers() -> dict:
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY is not set. Add it to cliniq-backend/.env")
    return {"Authorization": f"Bearer {key}"}


def _send(path: str, models: list[str], body: dict | None = None, stream: bool = False, **kwargs) -> httpx.Response:
    """POST to Groq, moving to the next model on a rate limit (429), server error or timeout.
    If every Groq model fails, text chat goes to OpenRouter; otherwise wait out the
    primary model's retry-after once and try it again."""
    def attempt(model):
        payload = {**body, "model": model} if body is not None else None
        req = _http.build_request("POST", path, headers=_headers(), json=payload,
                                  data=kwargs.get("data"), files=kwargs.get("files"))
        return _http.send(req, stream=stream)

    res, first_429 = None, None
    for model in models:
        try:
            res = attempt(model)
        except (httpx.HTTPError, RuntimeError) as e:
            print(f"[llm] {model} unreachable ({type(e).__name__}), trying next model")
            res = None
            continue
        if res.status_code in (401, 403, 429) or res.status_code >= 500:
            first_429 = first_429 or (res if res.status_code == 429 else None)
            res.close()
            print(f"[llm] {model} returned {res.status_code}, trying next model")
            res = None
            continue
        break

    if res is None:
        if _openrouter_eligible(path, body):
            return _openrouter(body, stream)
        if first_429 is None:
            raise RuntimeError("Groq unavailable for all models")
        time.sleep(min(float(first_429.headers.get("retry-after", 5)), 15))
        res = attempt(models[0])
    if res.status_code >= 400:
        detail = res.read()[:300] if stream else res.text[:300]
        raise RuntimeError(f"Groq {res.status_code}: {detail}")
    return res


# --- OpenRouter fallback (Llama 3.1 8B) -----------------------------------------------

OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.1-8b-instruct")
_openrouter_http = httpx.Client(base_url="https://openrouter.ai/api/v1",
                                timeout=httpx.Timeout(90.0, connect=10.0))


def _openrouter_eligible(path: str, body: dict | None) -> bool:
    """Text chat only: the fallback model has no vision, and audio stays on Whisper."""
    if path != "/chat/completions" or not body or not os.getenv("OPENROUTER_API_KEY"):
        return False
    return not any(isinstance(m.get("content"), list) for m in body.get("messages", []))


def _openrouter(body: dict, stream: bool) -> httpx.Response:
    payload = {**body, "model": OPENROUTER_MODEL}
    if (payload.get("response_format") or {}).get("type") == "json_schema":
        payload["response_format"] = {"type": "json_object"}  # strict schemas are Groq-only
    req = _openrouter_http.build_request(
        "POST", "/chat/completions", json=payload,
        headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
                 "HTTP-Referer": "https://github.com/sudeep-makindar/CliniQ_Plus", "X-Title": "ClinIQ+"})
    res = _openrouter_http.send(req, stream=stream)
    if res.status_code >= 400:
        detail = res.read()[:300] if stream else res.text[:300]
        raise RuntimeError(f"OpenRouter {res.status_code}: {detail}")
    print(f"[llm] Groq exhausted; served by OpenRouter ({OPENROUTER_MODEL})")
    return res


# --- message building ------------------------------------------------------------

def image_part(data: bytes, max_side: int = 1600) -> dict:
    """Downscale + JPEG-encode so uploads stay well under Groq's 4 MB base64 image limit."""
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=85)
    return {"type": "image_url",
            "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}}


def _messages(prompt: str, system: str | None, images: list[bytes] | None) -> list:
    msgs = [{"role": "system", "content": system}] if system else []
    if images:
        msgs.append({"role": "user", "content": [{"type": "text", "text": prompt}] + [image_part(i) for i in images]})
    else:
        msgs.append({"role": "user", "content": prompt})
    return msgs


# --- core calls -----------------------------------------------------------------------

def generate(prompt: str, *, system: str | None = None, images: list[bytes] | None = None,
             json_mode: bool = False, schema: dict | None = None,
             temperature: float = 0.3, max_tokens: int | None = None) -> str:
    body = {
        "messages": _messages(prompt, system, images),
        "temperature": temperature,
    }
    models = [VISION_MODEL] if images else TEXT_MODELS
    if schema:
        # Strict structured output: the reply is guaranteed to match the schema.
        # Supported by the GPT-OSS models, so restrict the failover chain to them.
        body["response_format"] = {"type": "json_schema",
                                   "json_schema": {"name": "result", "schema": schema, "strict": True}}
        models = [m for m in TEXT_MODELS if "gpt-oss" in m] or TEXT_MODELS
    elif json_mode:
        body["response_format"] = {"type": "json_object"}
    if max_tokens:
        body["max_tokens"] = max_tokens
    try:
        res = _send("/chat/completions", models, body).json()
        return _strip_think(res["choices"][0]["message"].get("content") or "")
    except Exception as e:
        if images or not aws.bedrock_available() or "json_validate_failed" in str(e):
            raise
        print(f"[llm] Groq failed ({e}); failing over to Amazon Bedrock ({aws.BEDROCK_MODEL_ID})")
        full = f"{system}\n\n{prompt}" if system else prompt
        return aws.bedrock_generate(full)


def generate_json(prompt: str, **kwargs) -> dict:
    try:
        return parse_json(generate(prompt, json_mode=True, **kwargs))
    except Exception as e:
        # Groq rejects replies that fail its JSON validator (json_validate_failed); the prompt
        # already asks for JSON, so retry in plain mode and parse leniently.
        if "json_validate_failed" not in str(e) and not isinstance(e, json.JSONDecodeError):
            raise
        print("[llm] JSON mode validation failed; retrying in plain mode")
        return parse_json(generate(prompt + "\n\nRespond with the JSON object only.", **kwargs))


def stream(prompt: str, *, system: str | None = None, temperature: float = 0.3):
    """Yields text chunks as Groq streams them (server-sent events)."""
    body = {"messages": _messages(prompt, system, None), "temperature": temperature, "stream": True}
    res = _send("/chat/completions", TEXT_MODELS, body, stream=True)
    try:
        for line in res.iter_lines():
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            choices = json.loads(line[6:]).get("choices") or [{}]
            delta = choices[0].get("delta", {}).get("content")
            if delta:
                yield delta
    finally:
        res.close()


def run_tools(prompt: str, tools: list, tool_map: dict, *, system: str | None = None, max_steps: int = 10) -> str:
    """Multi-step function-calling loop. `tools` uses the OpenAI tool schema."""
    messages = _messages(prompt, system, None)
    for _ in range(max_steps):
        res = _send("/chat/completions", TEXT_MODELS,
                    {"messages": messages, "tools": tools, "temperature": 0.2}).json()
        msg = res["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        if not calls:
            return _strip_think(msg.get("content") or "")
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"].get("arguments") or "{}")
                result = tool_map[name](**args) if name in tool_map else {"error": f"Function {name} not available"}
            except Exception as e:
                result = {"error": str(e)}
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result, default=str)})
    return "The analysis needed more steps than allowed. Please narrow the question."


# --- audio & documents ----------------------------------------------------------------

def transcribe(audio: bytes, filename: str = "audio.webm", content_type: str = "audio/webm",
               language: str | None = None, prompt: str | None = None) -> str:
    """Whisper speech-to-text. `language` accepts BCP-47 (hi-IN) or ISO-639-1 (hi)."""
    data = {"response_format": "json", "temperature": "0"}
    if language and language != "auto":
        data["language"] = language.split("-")[0].lower()
    if prompt:
        data["prompt"] = prompt[:800]
    res = _send("/audio/transcriptions", [AUDIO_MODEL], None, data={**data, "model": AUDIO_MODEL},
                files={"file": (filename, audio, content_type)})
    return res.json().get("text", "").strip()


def pdf_to_text_and_images(pdf: bytes, max_pages: int = 4) -> tuple[str, list[bytes]]:
    """Returns the PDF's text layer, plus page renders for scanned PDFs with no text layer."""
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(pdf)
    pages = [doc[i] for i in range(min(len(doc), max_pages))]
    text = "\n\n".join(p.get_textpage().get_text_range() for p in pages).strip()
    if len(text) > 200:
        return text, []
    images = []
    for p in pages[:3]:
        buf = io.BytesIO()
        p.render(scale=2).to_pil().save(buf, "PNG")
        images.append(buf.getvalue())
    return text, images


# --- helpers ----------------------------------------------------------------------------

def _strip_think(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def parse_json(text: str):
    """Parse JSON from a model reply, tolerating ```json fences or surrounding prose."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.S)
        if match:
            return json.loads(match.group(1))
        raise
