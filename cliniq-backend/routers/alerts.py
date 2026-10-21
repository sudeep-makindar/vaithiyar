from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
from services.supabase_service import db_service
from services.ai_service import ai_service

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

class AlertExplainRequest(BaseModel):
    alert_id: str
    patient_id: str
    description: str

class UrgencyScoreRequest(BaseModel):
    patient_id: str
    alert_description: str
    severity: str

@router.post("/explain")
async def explain_alert(req: AlertExplainRequest):
    """
    Generate and stream a 3-4 sentence clinical explanation of why an alert fired.
    """
    # Check cache first
    cached = db_service.get_alert_explanation(req.alert_id)
    if cached:
        print(f"Serving explanation for alert {req.alert_id} from SQLite Cache...")
        async def stream_cache():
            chunk_size = 30
            for i in range(0, len(cached), chunk_size):
                chunk = cached[i:i+chunk_size]
                yield f"data: {json.dumps(chunk)}\n\n"
                await asyncio.sleep(0.01)
            yield "data: [DONE]\n\n"
        return StreamingResponse(stream_cache(), media_type="text/event-stream")

    print(f"No explanation cache for alert {req.alert_id}. Querying live AI co-pilot...")
    prompt = (
        "You are a clinical co-pilot advising a physician. An alert was fired for a patient: "
        f"Alert description: \"{req.description}\" (ID: {req.alert_id}). "
        "Write a concise, 3-4 sentence clinical explanation explaining why this alert is significant, "
        "what physiological risks are associated with it in simple terms, and what immediate follow-up diagnostics "
        "or therapeutic adjustments the clinician should consider. Stream your reasoning. Avoid generic advice."
    )

    async def stream_explanation():
        full_text = ""
        for chunk in ai_service.stream_content(prompt):
            full_text += chunk
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(0.02)
        
        # Cache the explanation
        try:
            db_service.save_alert_explanation(req.alert_id, full_text)
        except Exception as e:
            print(f"Failed to cache alert explanation: {e}")
            
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_explanation(), media_type="text/event-stream")

def calculate_urgency_score(patient_name: str, patient_age: int, conditions: list, alert_desc: str, severity: str) -> int:
    """
    Synchronous utility to calculate alert urgency 1-10 using the LLM.
    """
    prompt = (
        "You are a clinical triage AI. Rate the clinical urgency of the following alert on a scale from 1 to 10 (where 10 is immediate life-threatening emergency, 1 is routine screening followup). "
        f"Patient Context: {patient_name}, {patient_age}y, Conditions: {', '.join(conditions)}. "
        f"Alert: \"{alert_desc}\" (Baseline Severity: {severity}). "
        "Return ONLY a single integer score between 1 and 10. No explanations, no text."
    )
    try:
        response_text = ai_service.generate_content(prompt).strip()
        # Find any digit 1-10
        import re
        match = re.search(r'\b(10|[1-9])\b', response_text)
        if match:
            return int(match.group(1))
        return 5 # Fallback
    except Exception as e:
        print(f"Error calculating urgency score: {e}")
        return 5
