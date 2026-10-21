import json
import asyncio
from services import llm


VOICE_SYSTEM_PROMPT = """
You are CliniQ Clinical AI.

You answer doctor voice queries.

Supported intents:

1. lab_trend
2. patient_summary
3. drug_check
4. alert_review
5. adherence_check

Return ONLY valid JSON.

Schema:

{
  "response_type":"",
  "intent_detected":"",
  "summary":"",
  "data":{},
  "confidence":"high"
}
"""


def get_patient_context(patient_id):
    try:
        from services.store import store
        return store.get_patient(patient_id) or {}
    except Exception as e:
        print("Patient fetch error:", e)
        return {}


def _run_llm_query(query: str, patient_id: str):

    patient = get_patient_context(patient_id)

    prompt = f"""
PATIENT DATA:

{json.dumps(patient, indent=2)}

DOCTOR QUERY:

{query}

Return JSON only.
"""

    text = llm.generate(prompt, system=VOICE_SYSTEM_PROMPT, json_mode=True, temperature=0.1)
    if not text:
        raise RuntimeError("Empty AI response")

    try:
        return llm.parse_json(text)
    except json.JSONDecodeError:
        return {
            "response_type": "patient_summary",
            "intent_detected": query,
            "summary": text,
            "data": {},
            "confidence": "low"
        }


async def run_voice_query(query: str, patient_id: str):
    return await asyncio.to_thread(_run_llm_query, query, patient_id)
