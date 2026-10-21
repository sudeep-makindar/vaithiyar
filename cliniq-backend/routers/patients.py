from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
import json
import asyncio
import os
from services.supabase_service import db_service
from services.ai_service import ai_service
from services.pdf_service import pdf_service
from services.store import store
from services.aws import archive_to_s3

router = APIRouter(prefix="/api/patient", tags=["patients"])

class OrganAssessmentRequest(BaseModel):
    organ: str

def get_patient_data(patient_id: str) -> dict:
    try:
        return store.get_patient(patient_id)
    except Exception as e:
        print(f"Error loading patient data: {e}")
    return None

@router.post("/{id}/organ-assessment")
async def organ_assessment(id: str, req: OrganAssessmentRequest):
    patient = get_patient_data(id)
    if not patient:
        async def err_stream():
            yield "data: {\"error\": \"Patient not found\"}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(err_stream(), media_type="text/event-stream")

    organ = req.organ.lower()
    
    # Filter relevant lab values
    labs = patient.get("labs", {})
    relevant_biomarkers = {}
    if organ == "heart":
        relevant_biomarkers = {
            "BP_Systolic": labs.get("BP_Systolic", [])[-5:],
            "HeartRate": labs.get("HeartRate", [])[-5:],
            "BNP": labs.get("BNP", [])[-5:]
        }
    elif organ == "kidney":
        relevant_biomarkers = {
            "Creatinine": labs.get("Creatinine", [])[-5:],
            "Potassium": labs.get("Potassium", [])[-5:]
        }
    elif organ == "lungs":
        relevant_biomarkers = {
            "FEV1": labs.get("FEV1", [])[-5:]
        }
    elif organ == "joints" or organ == "joints/limbs" or organ == "joints":
        relevant_biomarkers = {
            "ESR": labs.get("ESR", [])[-5:]
        }
    else:
        # Default biomarkers
        relevant_biomarkers = {k: v[-5:] for k, v in labs.items()}

    # Check database cache first
    cached = db_service.get_organ_assessment(id, organ)
    if cached:
        print(f"Serving organ assessment for {organ} of patient {id} from SQLite Cache...")
        async def stream_cache():
            # Construct a response matching what the live AI stream would produce,
            # which is: "[RISK: <score>] \n\n <summary text>"
            response_text = f"[RISK: {cached['risk_score']}]\n\n{cached['summary_text']}"
            chunk_size = 30
            for i in range(0, len(response_text), chunk_size):
                chunk = response_text[i:i+chunk_size]
                yield f"data: {json.dumps(chunk)}\n\n"
                await asyncio.sleep(0.01)
            yield "data: [DONE]\n\n"
        return StreamingResponse(stream_cache(), media_type="text/event-stream")

    print(f"No cache found for {organ} assessment of patient {id}. Querying live AI triage...")
    prompt = (
        f"You are a clinical specialist evaluating patient organ health. "
        f"Patient: {patient['name']}, {patient['age']}y. Diagnoses: {', '.join(patient['diagnosis'])}. "
        f"Evaluate the health of the organ: \"{organ.upper()}\" based on these relevant time-series biomarkers:\n"
        f"{json.dumps(relevant_biomarkers)}\n"
        "Generate a risk score from 0 to 100 (where 100 is critical organ failure, 0 is perfect function) "
        "and write a concise, 3-sentence clinical summary of the findings, explaining what the trends indicate and what to monitor. "
        "Format the first line exactly as: [RISK: <score>] "
        "Followed by a blank line, and then the markdown-formatted summary text. Stream your response."
    )

    async def stream_live():
        full_text = ""
        for chunk in ai_service.stream_content(prompt):
            full_text += chunk
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(0.02)

        # Parse and cache
        try:
            risk_score = 50
            summary_text = full_text
            first_line = full_text.split("\n")[0]
            if "RISK:" in first_line:
                try:
                    risk_score = int(first_line.replace("[", "").replace("]", "").split(":")[1].strip())
                    summary_text = "\n".join(full_text.split("\n")[1:]).strip()
                except Exception as ex:
                    print(f"Failed to parse risk score from line: {first_line}, err: {ex}")
            
            db_service.save_organ_assessment(
                patient_id=id,
                organ=organ,
                risk_score=risk_score,
                summary_text=summary_text,
                biomarkers=list(relevant_biomarkers.keys())
            )
        except Exception as e:
            print(f"Failed to cache organ assessment: {e}")
            
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_live(), media_type="text/event-stream")

@router.get("/{id}/summary-pdf")
def get_patient_summary_pdf(id: str):
    print(f"Exporting patient summary PDF for ID: {id}...")
    try:
        patient = get_patient_data(id)
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found.")

        pdf_path = pdf_service.build_summary_pdf(id)
        if not os.path.exists(pdf_path):
            raise HTTPException(status_code=500, detail="Failed to generate patient summary PDF.")
        
        formatted_name = "".join(c if c.isalnum() else "_" for c in patient["name"].lower())
        filename = f"patient_{formatted_name}_summary.pdf"
        with open(pdf_path, "rb") as pdf_file:
            archive_to_s3(f"reports/{id}", pdf_file.read(), "application/pdf", filename)
        headers = {
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache"
        }
        return FileResponse(
            path=pdf_path,
            filename=filename,
            media_type="application/pdf",
            headers=headers
        )
    except HTTPException as http_ex:
        raise http_ex
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    except Exception as e:
        print(f"Error exporting patient summary PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))
