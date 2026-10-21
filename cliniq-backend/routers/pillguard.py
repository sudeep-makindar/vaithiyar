from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import os
from services.ai_service import ai_service
from services.store import store

router = APIRouter(prefix="/api/pillguard", tags=["pillguard"])

class MissedDoseRequest(BaseModel):
    patient_id: str
    drug_name: str

def get_patient_conditions(patient_id: str) -> list:
    try:
        patient = store.get_patient(patient_id)
        if patient:
            return patient.get("diagnosis", [])
    except Exception as e:
        print(f"Error loading patient conditions: {e}")
    return []

@router.post("/missed-dose-impact")
async def missed_dose_impact(req: MissedDoseRequest):
    conditions = get_patient_conditions(req.patient_id)
    
    prompt = (
        f"You are a clinical pharmacology AI. A patient with conditions {', '.join(conditions)} has missed a dose "
        f"of their medication: \"{req.drug_name}\". "
        f"Describe the immediate and short-term clinical impact of missing this dose. "
        "Keep it highly specific to their conditions, mentioning physiological feedback loops (e.g. rebound hypertension, blood sugar spikes). "
        "Write exactly 3 sentences in a calm, professional clinical tone (normal sentence case, no all-caps, no markdown headings), "
        "ending with the recommended action (e.g. take now vs skip, when to resume, what to monitor)."
    )
    
    async def stream_impact():
        for chunk in ai_service.stream_content(prompt):
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(0.02)
        yield "data: [DONE]\n\n"
        
    return StreamingResponse(stream_impact(), media_type="text/event-stream")
