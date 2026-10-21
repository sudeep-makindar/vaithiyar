import base64
from services import llm

def run_intake_extraction(file_base64: str, file_type: str = "application/pdf", expected_patient_name: str = None, is_new_patient: bool = False, document_type: str = "discharge_summary") -> dict:
    """
    Extracts structured medical data from a document and validates it against the expected patient.
    """
    print(f"Executing Intake Agent. New Patient: {is_new_patient}, Expected: {expected_patient_name}...")
    try:
        # Strip data string header if present
        if "," in file_base64:
            file_base64 = file_base64.split(",")[1]
            
        file_data = base64.b64decode(file_base64)
        
        validation_logic = ""
        if is_new_patient:
            validation_logic = """
        NEW PATIENT PROFILE MODE:
        - The user is intent on creating a NEW patient profile from this document.
        - Your goal is to extract the patient's name reliably from the document.
        - Set 'patient_match' to 'match' because this document IS the source of truth for the new profile.
        - Set 'extracted_name' to the name found in the document.
            """
        else:
            validation_logic = f"""
        PATIENT VALIDATION:
        The current patient in the system is: "{expected_patient_name if expected_patient_name else 'Unknown'}".
        1. Search for the patient's name across ALL pages of the document. 
        2. If a name is found on ANY page, use it for validation.
        3. Compare the found name with "{expected_patient_name if expected_patient_name else 'Unknown'}".
        4. Set 'patient_match' to:
           - "match" (exact or clearly the same person)
           - "partial" (similar name or nickname found)
           - "mismatch" (a clearly different name found)
           - "not_found" (no name found on any page)
            """

        type_logic = ""
        if "imaging" in document_type.lower():
            type_logic = """
        DOCUMENT TYPE: IMAGING (X-Ray / MRI / CT)
        - Since this is an imaging scan, DO NOT attempt to hallucinate medications, detailed vitals, or dietary restrictions.
        - Prioritize extracting the "Diagnosis" and "Imaging Analysis".
        - For fields like medications, vitals, etc., naturally return "Not mentioned" or omit values.
        - Ensure "document_type" is returned literally as "imaging".
            """
        else:
            type_logic = """
        DOCUMENT TYPE: PRESCRIPTION / DISCHARGE SUMMARY
        - Prioritize extracting all biometric vitals, medications, diagnoses, and regimens.
        - Ensure "document_type" is returned literally as "discharge_summary".
            """

        prompt = f'''
        You are a highly accurate medical data extraction AI. 
        Your task is to parse the attached medical document and extract clinical information.
        
        {validation_logic}
        
        {type_logic}
        
        Fields to extract:
        1. Document Type: Identify all types present in the document.
        2. Diagnosis: Primary and secondary diagnoses.
        3. Medications: List of prescribed medications with dosage and frequency.
        4. Vitals: Extract specific numeric values for Blood Pressure (sys/dia), Heart Rate (bpm), and Blood Glucose/Sugar if available.
        5. Vital Thresholds: Any mentioned thresholds for vitals that require attention.
        6. Dietary Restrictions: Specific food items or diets to follow or avoid.
        7. Activity Limitations: Physical activity restrictions or recommendations.
        8. Follow-up Date: The date for the next medical appointment.
        9. Imaging Analysis: Provide a detailed "Radiological Impression" for any imaging.
        
        IMPORTANT:
        - Extract ALL relevant clinical data found across ALL pages.
        - For 'vitals', provide a structured object: {{"bp": "120/80", "hr": "72", "glucose": "95", "raw": "..."}}
        
        Return ONLY a JSON object:
        {{
          "patient_match": "match" | "partial" | "mismatch" | "not_found",
          "extracted_name": "...",
          "age": {{"value": "<age in years or Not mentioned>", "confidence": 90}},
          "sex": {{"value": "Male | Female | Not mentioned", "confidence": 90}},
          "document_type": "string",
          "diagnosis": {{"value": "...", "confidence": 95}},
          "medications": {{"value": "...", "confidence": 98}},
          "vitals": {{"value": {{"bp": "...", "hr": "...", "glucose": "...", "raw": "..."}}, "confidence": 90}},
          "vital_thresholds": {{"value": "...", "confidence": 90}},
          "dietary_restrictions": {{"value": "...", "confidence": 85}},
          "activity_limitations": {{"value": "...", "confidence": 92}},
          "follow_up_date": {{"value": "...", "confidence": 99}},
          "imaging_analysis": {{"value": "...", "confidence": 85}}
        }}
        '''
        
        # PDFs with a text layer go to the text model; scanned PDFs and photos go to the vision model
        if "pdf" in file_type.lower():
            doc_text, page_images = llm.pdf_to_text_and_images(file_data)
        else:
            doc_text, page_images = "", [file_data]

        if doc_text:
            # ~3k tokens: covers a typical 1-3 page discharge summary and stays inside
            # Groq's free-tier per-minute token budget
            prompt += f"\n\nDOCUMENT TEXT:\n{doc_text[:12000]}"
        return llm.generate_json(prompt, images=page_images or None, temperature=0.1)
        
    except Exception as e:
        err_str = str(e)
        print(f"Error executing Intake Agent: {err_str}")
        is_rate_limit = '429' in err_str or 'quota' in err_str.lower()
        is_imaging = 'imaging' in document_type.lower()
        
        if is_rate_limit:
            # Return a graceful offline stub so the UI can still show something useful
            note = "AI analysis temporarily unavailable (API quota reached). Please retry in ~1 minute."
            if is_imaging:
                return {
                    "patient_match": "not_found",
                    "extracted_name": expected_patient_name or "Unknown",
                    "document_type": "imaging",
                    "diagnosis": {"value": f"Imaging document uploaded. {note}", "confidence": 0},
                    "medications": {"value": "Not mentioned", "confidence": 0},
                    "vitals": {"value": {"bp": "—", "hr": "—", "glucose": "—", "raw": note}, "confidence": 0},
                    "vital_thresholds": {"value": "Not mentioned", "confidence": 0},
                    "dietary_restrictions": {"value": "Not mentioned", "confidence": 0},
                    "activity_limitations": {"value": "Not mentioned", "confidence": 0},
                    "follow_up_date": {"value": "Not mentioned", "confidence": 0},
                    "imaging_analysis": {"value": f"Image received but could not be analyzed. {note}", "confidence": 0},
                    "_offline": True
                }
            else:
                return {
                    "patient_match": "not_found",
                    "extracted_name": expected_patient_name or "Unknown",
                    "document_type": document_type,
                    "diagnosis": {"value": f"Document uploaded. {note}", "confidence": 0},
                    "medications": {"value": "Not mentioned", "confidence": 0},
                    "vitals": {"value": {"bp": "—", "hr": "—", "glucose": "—", "raw": note}, "confidence": 0},
                    "vital_thresholds": {"value": "Not mentioned", "confidence": 0},
                    "dietary_restrictions": {"value": "Not mentioned", "confidence": 0},
                    "activity_limitations": {"value": "Not mentioned", "confidence": 0},
                    "follow_up_date": {"value": "Not mentioned", "confidence": 0},
                    "imaging_analysis": {"value": "Not applicable", "confidence": 0},
                    "_offline": True
                }
        # Non-rate-limit error — still return structured stub, never raw error
        return {
            "patient_match": "not_found",
            "extracted_name": expected_patient_name or "Unknown",
            "document_type": document_type,
            "diagnosis": {"value": f"Extraction failed: {err_str[:120]}", "confidence": 0},
            "medications": {"value": "Not mentioned", "confidence": 0},
            "vitals": {"value": {"bp": "—", "hr": "—", "glucose": "—", "raw": ""}, "confidence": 0},
            "vital_thresholds": {"value": "Not mentioned", "confidence": 0},
            "dietary_restrictions": {"value": "Not mentioned", "confidence": 0},
            "activity_limitations": {"value": "Not mentioned", "confidence": 0},
            "follow_up_date": {"value": "Not mentioned", "confidence": 0},
            "imaging_analysis": {"value": "Not available", "confidence": 0},
        }
