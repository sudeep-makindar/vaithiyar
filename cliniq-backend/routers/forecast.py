from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import time
import asyncio
from services.supabase_service import db_service
from services.ai_service import ai_service
from services.store import store

router = APIRouter(prefix="/api/forecast", tags=["forecast"])

def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}

_NUM, _STR, _INT = {"type": "number"}, {"type": "string"}, {"type": "integer"}
FORECAST_JSON_SCHEMA = _obj({
    "patient_id": _STR,
    "generated_at": _STR,
    "conditions": {"type": "array", "items": _obj({
        "condition": _STR, "icd_code": _STR,
        "trajectory": {"type": "array", "items": _obj({
            "month": _INT, "risk": _NUM, "confidence_low": _NUM, "confidence_high": _NUM, "key_driver": _STR})},
    })},
    "forecast_drivers": {"type": "array", "items": _obj({
        "biomarker": _STR, "contribution_pct": _NUM,
        "direction": {"type": "string", "enum": ["worsening", "stable", "improving"]}})},
    "milestones": {"type": "array", "items": _obj({
        "month": _INT, "condition": _STR, "event": _STR, "probability": _NUM})},
    "intervention_impacts": {"type": "array", "items": _obj({
        "intervention": _STR, "risk_delta": _NUM, "affected_conditions": {"type": "array", "items": _STR}})},
})


class ForecastRequest(BaseModel):
    patient_id: str

class SimulationRequest(BaseModel):
    patient_id: str
    interventions: list[str]

# Enforce the required schema string in the prompt
TRAJECTORY_SCHEMA = """
{
  "patient_id": string,
  "generated_at": ISO timestamp,
  "conditions": [
    {
      "condition": string,
      "icd_code": string,
      "trajectory": [
        { "month": 0, "risk": float, "confidence_low": float, "confidence_high": float, "key_driver": string }
        // months 0 through 12
      ]
    }
  ],
  "forecast_drivers": [
    { "biomarker": string, "contribution_pct": float, "direction": "worsening" | "stable" | "improving" }
  ],
  "milestones": [
    { "month": int, "condition": string, "event": string, "probability": float }
  ],
  "intervention_impacts": [
    { "intervention": string, "risk_delta": float, "affected_conditions": string[] }
  ]
}
"""

def get_patient_snapshot(patient_id: str) -> str:
    try:
        patient = store.get_patient(patient_id)
        if patient:
            return json.dumps({
                "id": patient["id"],
                "name": patient["name"],
                "age": patient["age"],
                "sex": patient["sex"],
                "diagnosis": patient["diagnosis"],
                "medications": patient["medications"],
                "adherenceScore": patient["adherenceScore"],
                "labs_latest": {k: v[-1] if v else None for k, v in patient.get("labs", {}).items()}
            })
    except Exception as e:
        print(f"Error loading patient snapshot: {e}")
    return f"{{'patient_id': '{patient_id}'}}"

import os

@router.post("/trajectory")
async def get_trajectory(req: ForecastRequest):
    # Try fetching from cache first
    cached = db_service.get_forecast_cache(req.patient_id)
    
    if cached:
        print(f"Serving trajectory for {req.patient_id} from SQLite Cache...")
        
        async def stream_cache():
            cached_json_str = json.dumps(cached)
            # Yield in small chunks to simulate real-time generation smoothly
            chunk_size = 50
            for i in range(0, len(cached_json_str), chunk_size):
                chunk = cached_json_str[i:i+chunk_size]
                yield f"data: {json.dumps(chunk)}\n\n"
                await asyncio.sleep(0.01)
            yield "data: [DONE]\n\n"
            
        return StreamingResponse(stream_cache(), media_type="text/event-stream")

    print(f"No cache found for {req.patient_id}. Querying live AI forecasting engine...")
    patient_snapshot = get_patient_snapshot(req.patient_id)
    
    prompt = (
        "You are a clinical AI forecasting engine. Given the following patient data, generate a 12-month disease progression forecast in strict JSON format matching this schema:\n"
        f"{TRAJECTORY_SCHEMA}\n"
        f"Patient data:\n{patient_snapshot}\n"
        "For each active condition, project monthly risk scores from 0.0 to 1.0 with confidence intervals. Identify the top 5 biomarker drivers with percentage contributions. Predict clinical milestones with probabilities. Calculate risk delta for each intervention. Be scientifically grounded. "
        "REQUIRED: the JSON must contain all four top-level arrays: conditions (the 3 most important active conditions at most, "
        "each with 7 trajectory points at months 0, 2, 4, 6, 8, 10, 12; keep key_driver under 8 words), "
        "forecast_drivers (exactly 5), milestones (3-4, months 1-12) and intervention_impacts (exactly 4 realistic options for THIS patient, "
        "risk_delta negative between -0.05 and -0.30). Return only valid JSON, no prose."
    )
    
    async def stream_live_ai():
        full_text = ""
        for chunk in ai_service.stream_json(prompt, schema=FORECAST_JSON_SCHEMA):
            full_text += chunk
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(0.02)
        
        # Save to cache if valid JSON
        try:
            # Clean formatting characters if present
            clean_text = full_text.strip()
            if clean_text.startswith("```json"):
                clean_text = clean_text[7:-3].strip()
            elif clean_text.startswith("```"):
                clean_text = clean_text[3:-3].strip()
            
            data = json.loads(clean_text)
            # Reformat to match expected cache schema
            db_service.set_forecast_cache(req.patient_id, data)
        except Exception as e:
            print(f"Failed to cache live forecast response: {e}")
            
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_live_ai(), media_type="text/event-stream")

@router.post("/simulate")
async def simulate_trajectory(req: SimulationRequest):
    """
    Simulate trajectory based on active interventions. Enforces live AI call to highlight the 'wow' moment.
    """
    print(f"Simulating interventions {req.interventions} for patient {req.patient_id} via live AI...")
    patient_snapshot = get_patient_snapshot(req.patient_id)
    
    # Keep condition names identical to the baseline forecast so the UI can overlay the curves
    baseline = db_service.get_forecast_cache(req.patient_id)
    baseline_conditions = [c.get("condition") for c in (baseline or {}).get("trajectory", []) if c.get("condition")]
    baseline_hint = (f"Use exactly these condition names, in this order: {json.dumps(baseline_conditions)}. "
                     if baseline_conditions else "")

    prompt = (
        "You are a clinical AI forecasting engine. Given the following patient data, generate a 12-month disease progression forecast in strict JSON format matching this schema:\n"
        f"{TRAJECTORY_SCHEMA}\n"
        f"Patient data:\n{patient_snapshot}\n"
        f"SIMULATION INTERVENTIONS TO APPLY: {', '.join(req.interventions)}.\n"
        "Rigorously adjust the risk trajectory scores downward for conditions affected by these interventions. "
        "For example, adding Metformin should drop Type 2 Diabetes progression risk by ~20-30% over 12 months. "
        f"{baseline_hint}"
        "Use at most 3 conditions, each with 7 trajectory points at months 0, 2, 4, 6, 8, 10, 12; key_driver under 8 words; "
        "include 5 forecast_drivers, 3-4 milestones and the applied interventions in intervention_impacts. "
        "Return the full JSON structure including the updated trajectories. Return only valid JSON, no prose."
    )
    
    async def stream_simulation():
        for chunk in ai_service.stream_json(prompt, schema=FORECAST_JSON_SCHEMA):
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(0.02)
        yield "data: [DONE]\n\n"
        
    return StreamingResponse(stream_simulation(), media_type="text/event-stream")
