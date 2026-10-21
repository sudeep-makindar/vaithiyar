from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
from services.pdf_service import pdf_service
from services.aws import archive_to_s3

router = APIRouter(prefix="/api/export", tags=["export"])

class ExportRequest(BaseModel):
    patient_id: str
    include_forecast: bool = True
    include_interventions: bool = True

@router.post("/comprehensive-report")
def export_comprehensive_report(req: ExportRequest):
    print(f"Exporting comprehensive PDF report for patient {req.patient_id}...")
    try:
        pdf_path = pdf_service.build_report(req.patient_id)
        if not os.path.exists(pdf_path):
            raise HTTPException(status_code=500, detail="PDF generation failed.")
        
        filename = f"ClinIQ_Report_{req.patient_id}.pdf"
        with open(pdf_path, "rb") as pdf_file:
            archive_to_s3(f"reports/{req.patient_id}", pdf_file.read(), "application/pdf", filename)
        return FileResponse(
            path=pdf_path,
            filename=filename,
            media_type="application/pdf"
        )
    except Exception as e:
        print(f"PDF Export error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
