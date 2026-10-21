from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import time
import asyncio
import os
from services.supabase_service import db_service
from services.ai_service import ai_service
from services.store import store

router = APIRouter(prefix="/api", tags=["comorbidity"])

class ComorbidityRequest(BaseModel):
    patient_id: str

class SecondOpinionRequest(BaseModel):
    patient_id: str
    hypothesis: str

COMORBIDITY_SCHEMA = """
{
  "nodes": [
    { "id": string, "condition": string, "severity": float, "icd_code": string, "description": string }
  ],
  "edges": [
    { "source": string, "target": string, "strength": float, "direction": "amplifying" | "counteracting", "mechanism": string }
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

@router.post("/comorbidity/web")
async def get_comorbidity_web(req: ComorbidityRequest):
    cached = db_service.get_comorbidity_cache(req.patient_id)
    if cached:
        print(f"Serving comorbidity web for {req.patient_id} from SQLite Cache...")
        async def stream_cache():
            cached_json_str = json.dumps(cached)
            chunk_size = 50
            for i in range(0, len(cached_json_str), chunk_size):
                chunk = cached_json_str[i:i+chunk_size]
                yield f"data: {json.dumps(chunk)}\n\n"
                await asyncio.sleep(0.01)
            yield "data: [DONE]\n\n"
        return StreamingResponse(stream_cache(), media_type="text/event-stream")

    print(f"No cache found for {req.patient_id}. Querying live AI comorbidity web engine...")
    patient_snapshot = get_patient_snapshot(req.patient_id)
    
    prompt = (
        "You are a clinical AI comorbidity engine. Construct a condition-link interaction network graph for this patient. "
        "Each condition the patient has should be a node. Each link (edge) represents a pathological correlation, amplification, or counteraction. "
        "Generate nodes and edges in strict JSON matching this schema:\n"
        f"{COMORBIDITY_SCHEMA}\n"
        f"Patient snapshot:\n{patient_snapshot}\n"
        "Explain the physiological mechanism in the mechanism field for each edge. Return only valid JSON, no prose."
    )
    
    async def stream_live_ai():
        full_text = ""
        for chunk in ai_service.stream_json(prompt):
            full_text += chunk
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(0.02)
            
        try:
            clean_text = full_text.strip()
            if clean_text.startswith("```json"):
                clean_text = clean_text[7:-3].strip()
            elif clean_text.startswith("```"):
                clean_text = clean_text[3:-3].strip()
            data = json.loads(clean_text)
            db_service.set_comorbidity_cache(req.patient_id, data)
        except Exception as e:
            print(f"Failed to cache comorbidity web response: {e}")
            
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_live_ai(), media_type="text/event-stream")

@router.post("/second-opinion")
async def execute_second_opinion(req: SecondOpinionRequest):
    """
    Stress-test clinical hypothesis against patient profile history and stream verdict.
    Enforces live AI call to highlight the 'wow' moment.
    """
    print(f"Executing Second Opinion for patient {req.patient_id} and hypothesis: {req.hypothesis}...")
    patient_snapshot = get_patient_snapshot(req.patient_id)
    
    prompt = (
        "You are a clinical second opinion engine. "
        f"Given this hypothesis about patient: \"{req.hypothesis}\". "
        f"Stress-test this against their complete clinical profile data:\n{patient_snapshot}\n"
        "You must analyze support, contradictions, and insufficient evidence points. "
        "First, return a structured header containing confidence_score (0-100) and verdict (SUPPORTED | CONTRADICTED | INSUFFICIENT EVIDENCE). "
        "Then, stream a detailed, multi-step evidence chain explaining why this verdict was reached, citing specific lab readings, medications, and risk multipliers. "
        "Structure the streaming response as a clean clinical brief. "
        "Format the first line exactly as: [VERDICT: <verdict> | CONFIDENCE: <confidence_score>] "
        "Followed by a blank line, and then the markdown-formatted detailed explanation."
    )
    
    async def stream_second_opinion():
        full_text = ""
        for chunk in ai_service.stream_content(prompt):
            full_text += chunk
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(0.02)
            
        # Parse and save the results in the database log
        try:
            verdict = "INSUFFICIENT EVIDENCE"
            confidence = 50
            
            # Simple extraction from [VERDICT: ... | CONFIDENCE: ...]
            first_line = full_text.split("\n")[0]
            if "VERDICT:" in first_line:
                parts = first_line.replace("[", "").replace("]", "").split("|")
                for p in parts:
                    if "VERDICT:" in p:
                        verdict = p.split(":")[1].strip()
                    if "CONFIDENCE:" in p:
                        try:
                            confidence = int(p.split(":")[1].strip())
                        except:
                            pass
            
            # Save opinion to the database
            db_service.save_second_opinion(
                patient_id=req.patient_id,
                hypothesis=req.hypothesis,
                confidence_score=confidence,
                verdict=verdict,
                evidence_chain=full_text
            )
        except Exception as e:
            print(f"Failed to save second opinion log: {e}")
            
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_second_opinion(), media_type="text/event-stream")


@router.post("/second-opinion/structured")
async def structured_second_opinion(req: SecondOpinionRequest):
    """Same stress-test as /second-opinion, returned as JSON for the patient-page AI Opinion panel."""
    from services import llm
    prompt = (
        "You are a clinical second-opinion engine reviewing a physician's working hypothesis.\n"
        f"Hypothesis: \"{req.hypothesis}\"\n"
        f"Patient profile (latest labs, diagnoses, medications):\n{get_patient_snapshot(req.patient_id)}\n\n"
        "Cite specific lab values, trends and medications. Return ONLY JSON:\n"
        '{"verdict": "CORROBORATED" | "CONTRADICTED" | "INSUFFICIENT EVIDENCE", "confidence": <0-100>, '
        '"support": ["3-4 specific supporting findings"], "contradict": ["2-3 gaps, conflicts or differentials"]}'
    )
    try:
        result = await asyncio.to_thread(llm.generate_json, prompt, temperature=0.2)
        db_service.save_second_opinion(req.patient_id, req.hypothesis, int(result.get("confidence", 0) or 0),
                                       result.get("verdict", ""), json.dumps(result))
        return {
            "verdict": str(result.get("verdict", "INSUFFICIENT EVIDENCE")).upper(),
            "confidence": result.get("confidence"),
            "support": result.get("support", []),
            "contradict": result.get("contradict", []),
        }
    except Exception as e:
        print(f"Structured second opinion failed: {e}")
        return {"verdict": "INSUFFICIENT EVIDENCE", "confidence": None,
                "support": [], "contradict": ["AI service is busy right now. Please retry in a few seconds."]}
