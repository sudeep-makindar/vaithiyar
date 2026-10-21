from fastapi import FastAPI, File, UploadFile, Request
import json
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from dotenv import load_dotenv

# Load environment variables from the same directory as this script
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# On AWS, pull the Groq API key from SSM Parameter Store before any agent runs
from services.aws import load_secrets_into_env, archive_to_s3
load_secrets_into_env()

from services.store import store
from agents.query_agent import run_nl_query
from agents.pill_agent import run_vision_agent
from agents.pill_analyzer_agent import analyze_pill_images
from agents.intake_agent import run_intake_extraction
from agents.trial_matcher_agent import screen_trials_with_ai

import random
import uuid

app = FastAPI(title='ClinIQ Backend')
app.add_middleware(CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'], allow_headers=['*'])

# On AWS the Lambda Function URL is only meant to be reached through CloudFront,
# which injects this shared secret header. Unset locally, so dev is unaffected.
ORIGIN_VERIFY_SECRET = os.getenv("ORIGIN_VERIFY_SECRET")

@app.middleware("http")
async def verify_cloudfront_origin(request: Request, call_next):
    if (ORIGIN_VERIFY_SECRET and request.url.path != "/api/health"
            and request.headers.get("x-origin-verify") != ORIGIN_VERIFY_SECRET):
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "Forbidden"}, status_code=403)
    return await call_next(request)

from routers import forecast, comorbidity, alerts, pillguard, patients, export, voice, insights

class QueryRequest(BaseModel):
    query: str
    patient_id: str

class SecondOpinionRequest(BaseModel):
    diagnosis: str
    patient_id: str

class PillVerifyRequest(BaseModel):
    image_base64: str
    prescription_id: str

class IntakeRequest(BaseModel):
    file_base64: str
    file_type: str = "application/pdf"
    expected_patient_name: str = None
    is_new_patient: bool = False
    document_type: str = "discharge_summary"

@app.get('/api/health')
def health():
    from services.aws import STORAGE_BACKEND
    return {"status": "ok", "storage": STORAGE_BACKEND}

@app.get('/api/patients')
def get_patients():
    return store.list_patients()

@app.get('/api/patient/{id}')
def get_patient(id: str):
    return store.get_patient(id) or {"error": "Not found"}

@app.delete('/api/patient/{id}')
def delete_patient(id: str):
    if store.delete_patient(id):
        return {"status": "success", "message": f"Deleted {id}"}
    return {"error": "Not found"}

@app.get('/api/patient/{id}/brief')
def get_brief(id: str):
    patient = store.get_patient(id)
    return {"consultBrief": patient['consultBrief']} if patient else {"error": "Not found"}

@app.get('/api/patient/{id}/labs/{test}')
def get_labs(id: str, test: str):
    patient = store.get_patient(id)
    if not patient: return {"error": "Patient not found"}
    labs = patient.get("labs", {}).get(test, [])
    return {"data": labs}

@app.get('/api/patient/{id}/patterns')
def get_patterns(id: str):
    patient = store.get_patient(id)
    return {"patterns": patient.get("clinicalPatterns", [])} if patient else {"error": "Not found"}

@app.get('/api/patient/{id}/adherence')
def get_adherence(id: str):
    patient = store.get_patient(id)
    if not patient: return {"error": "Not found"}
    return {
        "calendar": patient.get("adherenceCalendar", []),
        "score": patient.get("adherenceScore", 0)
    }

@app.get('/api/patient/{id}/interactions')
def get_interactions(id: str):
    return store.get_interactions()

@app.get('/api/pill-events')
def get_pill_events():
    return store.get_pill_events()

@app.post('/api/query')
def query_agent(req: QueryRequest):
    response = run_nl_query(req.query, req.patient_id)
    return {"response": response}

# Mount new routers
app.include_router(forecast.router)
app.include_router(comorbidity.router)
app.include_router(alerts.router)
app.include_router(pillguard.router)
app.include_router(patients.router)
app.include_router(export.router)
app.include_router(voice.router)
app.include_router(insights.router)


@app.post('/api/pill/verify')
def pill_verify(req: PillVerifyRequest):
    result = run_vision_agent(req.image_base64, req.prescription_id)
    return result

@app.post('/api/analyze-pill')
async def analyze_pill_endpoint(
    front_image: UploadFile = File(...),
    back_image: UploadFile = File(...)
):
    # Read the file contents
    front_bytes = await front_image.read()
    back_bytes = await back_image.read()
    archive_to_s3("uploads/pill-scans", front_bytes, front_image.content_type or "image/jpeg", "front.jpg")
    archive_to_s3("uploads/pill-scans", back_bytes, back_image.content_type or "image/jpeg", "back.jpg")
    
    # Call our agent
    result_str = analyze_pill_images(front_bytes, back_bytes)
    
    # The agent returns a JSON string, so we parse it to return actual JSON instead of an escaped string
    try:
        return json.loads(result_str)
    except json.JSONDecodeError:
        return {"error": "Failed to parse AI response", "raw": result_str}

@app.post('/api/intake/extract')
def intake_extract(req: IntakeRequest):
    try:
        import base64
        ext = "pdf" if "pdf" in req.file_type else req.file_type.split("/")[-1]
        archive_to_s3("uploads/intake", base64.b64decode(req.file_base64.split(",")[-1]), req.file_type, f"{req.document_type}.{ext}")
    except Exception as e:
        print(f"Intake archive skipped: {e}")
    result = run_intake_extraction(req.file_base64, req.file_type, req.expected_patient_name, req.is_new_patient, req.document_type)
    return result

@app.post('/api/intake/save')
async def intake_save(request: Request):
    from datetime import datetime, timezone
    from services.intake_parsing import parse_medications, parse_diagnoses, parse_vitals, parse_age_sex

    data = await request.json()
    print(f"Saving approved intake data: {list(data.keys())}")
    patient_id = data.get("patient_id")
    extracted_name = (data.get("extracted_name") or "Unknown Patient").strip()

    existing_patient = store.get_raw_patient(patient_id) if patient_id else None
    if not existing_patient:
        match = next((p for p in store.list_patients() if p["name"].lower() == extracted_name.lower()), None)
        existing_patient = store.get_raw_patient(match["id"]) if match else None

    meds_list = parse_medications(data.get("medications", {}).get("value", ""))
    diags_list = parse_diagnoses(data.get("diagnosis", {}).get("value", ""))
    vitals = parse_vitals(data.get("vitals", {}).get("value", {}))
    now = datetime.now(timezone.utc)
    month = now.strftime("%b %y")
    doc_type = data.get("document_type") or "clinical document"
    ingest_note = {
        "type": "Data Ingest",
        "timestamp": now.isoformat(),
        "description": f"{doc_type.replace('_', ' ').title()} processed by Intake AI: "
                       f"{len(diags_list)} diagnoses, {len(meds_list)} medications, {len(vitals)} vitals extracted.",
        "severity": "INFO",
    }

    patient = existing_patient or {}
    if not existing_patient:
        age, sex = parse_age_sex(data)
        patient = {
            "id": f"P-{random.randint(10000, 99999)}",
            "name": extracted_name,
            "age": age,
            "sex": sex,
            "dob": f"{now.year - age}" if age else "Not recorded",
            "doctor": "Dr. Vedanth",
            "ward": "General Medicine",
            "adherenceScore": 100,
            "adherenceCalendar": [True] * 7,
            "labs": {},
            "clinicalPatterns": [],
        }
    # Merge into the existing record: a consultation note or new report adds findings,
    # it must not wipe the patient's established problem list or medications.
    known = {d.lower() for d in patient.get("diagnosis") or []}
    patient["diagnosis"] = (patient.get("diagnosis") or []) + [d for d in diags_list if d.lower() not in known]
    meds_by_name = {m["name"].lower(): m for m in patient.get("medications") or []}
    for med in meds_list:
        meds_by_name[med["name"].lower()] = {**meds_by_name.get(med["name"].lower(), {}), **med}
    patient["medications"] = list(meds_by_name.values())
    labs = patient.setdefault("labs", {})
    for lab, val in vitals.items():
        labs.setdefault(lab, []).append({"date": month, "val": val, "fixed": True, "at": now.isoformat()})
    patient.setdefault("clinicalPatterns", []).insert(0, ingest_note)
    follow_up = (data.get("follow_up_date") or {}).get("value")
    focus = diags_list[0] if diags_list else (patient.get("diagnosis") or ["review"])[0]
    patient["consultBrief"] = (f"Updated from {doc_type.replace('_', ' ')} on {now:%d %b %Y}. Primary focus: {focus}."
                               + (f" Follow-up: {follow_up}." if follow_up and "not" not in follow_up.lower() else ""))

    store.put_patient(patient)
    new_id = patient["id"]

    return {"status": "success", "message": "Patient verified and saved successfully", "patient_id": new_id}

from pydantic import BaseModel
from typing import List, Any

class TrialScreenRequest(BaseModel):
    studies: List[Any]

from fastapi import HTTPException
@app.post('/api/trials/match/{patient_id}')
async def match_trials(patient_id: str, body: TrialScreenRequest):
    patient = store.get_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    if not patient.get("diagnosis"):
        raise HTTPException(status_code=400, detail="Patient has no conditions for trial matching")

    result = await screen_trials_with_ai(patient, body.studies)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
