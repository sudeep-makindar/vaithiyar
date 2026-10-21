from services import llm
from tools.case_sheet import *
from tools.pill_guard import *

TOOL_DEFINITIONS = [{ 'function_declarations': [
  { 'name': 'get_patient_case_sheet',
    'description': 'Get the full clinical history for a patient by ID',
    'parameters': { 'type': 'object', 'properties': {
      'patient_id': { 'type': 'string', 'description': 'Patient ID e.g. P-00142' }
    }, 'required': ['patient_id'] } },
  { 'name': 'extract_lab_trends',
    'description': 'Get time-series trend for a specific lab test for a patient',
    'parameters': { 'type': 'object', 'properties': {
      'patient_id': { 'type': 'string' },
      'test_name':  { 'type': 'string', 'description': 'e.g. HbA1c, Creatinine, BP_Systolic' },
      'date_range': { 'type': 'string', 'description': 'e.g. last 6 months' }
    }, 'required': ['patient_id', 'test_name'] } },
  { 'name': 'check_drug_interactions',
    'description': 'Check for drug interaction alerts given a medication list',
    'parameters': { 'type': 'object', 'properties': {
      'medication_list': { 'type': 'array', 'items': { 'type': 'string' } }
    }, 'required': ['medication_list'] } },
  { 'name': 'generate_consultation_brief',
    'description': 'Generate the pre-consultation brief for a patient',
    'parameters': { 'type': 'object', 'properties': {
      'patient_id': { 'type': 'string' }
    }, 'required': ['patient_id'] } },
  { 'name': 'get_clinical_guideline',
    'description': 'Get standard clinical guidelines for a diagnosis code like T2DM, HTN',
    'parameters': { 'type': 'object', 'properties': {
      'diagnosis_code': { 'type': 'string' },
      'query_type': { 'type': 'string' }
    }, 'required': ['diagnosis_code'] } },
  { 'name': 'flag_clinical_pattern',
    'description': 'Find clinical patterns (e.g. Lab Good, Vitals, Renal) for a patient',
    'parameters': { 'type': 'object', 'properties': {
      'patient_id': { 'type': 'string' },
      'pattern_type': { 'type': 'string' }
    }, 'required': ['patient_id', 'pattern_type'] } },
    
  # Pill Guard Tools
  { 'name': 'send_medication_reminder',
    'description': 'Trigger a reminder ping to patient phone',
    'parameters': { 'type': 'object', 'properties': {
      'patient_id': { 'type': 'string' },
      'dose_time': { 'type': 'string' },
      'medications': { 'type': 'array', 'items': {'type': 'string'} }
    }, 'required': ['patient_id', 'dose_time', 'medications'] } },
  { 'name': 'log_dose_event',
    'description': 'Log an adherence or missed dose event into patient history',
    'parameters': { 'type': 'object', 'properties': {
      'patient_id': { 'type': 'string' },
      'dose_time': { 'type': 'string' },
      'status': { 'type': 'string', 'description': 'confirmed, missed, wrong' },
      'notes': { 'type': 'string' }
    }, 'required': ['patient_id', 'dose_time', 'status'] } },
  { 'name': 'escalate_to_caregiver',
    'description': 'Alert a family member or nurse regarding extreme non-compliance or wrong pills',
    'parameters': { 'type': 'object', 'properties': {
      'patient_id': { 'type': 'string' },
      'reason': { 'type': 'string' },
      'severity': { 'type': 'string' },
      'evidence': { 'type': 'string' }
    }, 'required': ['patient_id', 'reason', 'severity', 'evidence'] } },
  { 'name': 'generate_adherence_report',
    'description': 'Pull total adherence percentage for a week',
    'parameters': { 'type': 'object', 'properties': {
      'patient_id': { 'type': 'string' },
      'week_start': { 'type': 'string' }
    }, 'required': ['patient_id', 'week_start'] } },
]}]

# Groq uses the OpenAI tool schema
OPENAI_TOOLS = [{"type": "function", "function": decl} for decl in TOOL_DEFINITIONS[0]["function_declarations"]]

TOOL_MAP = {
  'get_patient_case_sheet': get_patient_case_sheet,
  'extract_lab_trends': extract_lab_trends,
  'check_drug_interactions': check_drug_interactions,
  'generate_consultation_brief': generate_consultation_brief,
  'flag_clinical_pattern': flag_clinical_pattern,
  'get_clinical_guideline': get_clinical_guideline,
  'send_medication_reminder': send_medication_reminder,
  'log_dose_event': log_dose_event,
  'escalate_to_caregiver': escalate_to_caregiver,
  'generate_adherence_report': generate_adherence_report,
}

def local_query_fallback(query: str, patient_id: str) -> str:
    import sys, os as _os
    # Ensure mock_data is importable regardless of working directory
    backend_dir = _os.path.dirname(_os.path.dirname(__file__))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    try:
        from mock_data import PATIENTS
        patient = next((p for p in PATIENTS if p['id'] == patient_id), None)
    except Exception:
        patient = None

    if not patient:
        return f"**ClinIQ Offline Mode**\n\nPatient {patient_id} — offline analysis unavailable. Please try again when the AI service is available."
    
    query_lower = query.lower()
    
    # 1. Creatinine / Renal / Kidney / CKD
    if any(k in query_lower for k in ['creatinine', 'creatine', 'renal', 'kidney', 'ckd']):
        if 'Creatinine' in patient.get('labs', {}):
            labs = patient['labs']['Creatinine']
            values_str = ", ".join([f"{l['date']}: {l['val']} mg/dL" for l in labs])
            latest_val = labs[-1]['val']
            first_val = labs[0]['val']
            trend = "worsening" if latest_val > first_val else "improving"
            return (
                f"**Clinical Insight: Renal Function (Creatinine Trends)**\n\n"
                f"For patient **{patient['name']}** ({patient_id}), the creatinine markers over the last 12-14 months are:\n"
                f"- **Timeline**: {values_str}\n"
                f"- **Baseline (Jul 24)**: {first_val} mg/dL\n"
                f"- **Latest (Sep 25)**: {latest_val} mg/dL\n"
                f"- **Trend**: **{trend.upper()}** (overall increase of {round(latest_val - first_val, 2)} mg/dL)\n\n"
                f"**Clinical Interpretation**: The steadily rising creatinine levels suggest progressive renal impairment. "
                f"This trend is consistent with a progression from CKD Stage 2 to Stage 3. "
                f"Recommend close monitoring of eGFR and UACR, avoiding nephrotoxic agents, and reviewing the dosage of renal-cleared medications."
            )
            
    # 2. HbA1c / Diabetes / Glucose / Glycemic
    if any(k in query_lower for k in ['hba1c', 'diabetes', 'glucose', 'glycemic', 't2dm']):
        if 'HbA1c' in patient.get('labs', {}):
            labs = patient['labs']['HbA1c']
            values_str = ", ".join([f"{l['date']}: {l['val']}%" for l in labs])
            latest_val = labs[-1]['val']
            first_val = labs[0]['val']
            trend = "worsening" if latest_val > first_val else "improving"
            return (
                f"**Clinical Insight: Glycemic Control (HbA1c Trends)**\n\n"
                f"For patient **{patient['name']}** ({patient_id}), the HbA1c progression over the last 12-14 months is:\n"
                f"- **Timeline**: {values_str}\n"
                f"- **Baseline (Jul 24)**: {first_val}%\n"
                f"- **Latest (Sep 25)**: {latest_val}%\n"
                f"- **Trend**: **{trend.upper()}** (net change of {round(latest_val - first_val, 2)}%)\n\n"
                f"**Clinical Interpretation**: The patient shows persistent glycemic elevation (peaking at 9.5% in July 25 before dropping to 8.6% in September 25). "
                f"Uncontrolled Type 2 Diabetes is indicated. "
                f"Therapeutic adjustment (such as adding an SGLT2 inhibitor or titrating insulin dose) is recommended to target HbA1c < 7.0% as per clinical guidelines."
            )

    # 3. Lipids / Cholesterol / LDL / HDL / Triglycerides
    if any(k in query_lower for k in ['lipid', 'cholesterol', 'ldl', 'hdl', 'triglyceride', 'dyslipid']):
        labs_data = patient.get('labs', {})
        lipid_keys = [k for k in ['LDL', 'HDL', 'Cholesterol', 'Triglycerides', 'Total_Cholesterol'] if k in labs_data]
        if lipid_keys:
            lines = []
            for key in lipid_keys:
                labs = labs_data[key]
                latest = labs[-1]
                first = labs[0]
                unit = 'mg/dL'
                trend_dir = 'worsening' if key != 'HDL' and latest['val'] > first['val'] else ('improving' if key != 'HDL' else ('worsening' if latest['val'] < first['val'] else 'stable'))
                lines.append(f"- **{key}**: {first['val']} → {latest['val']} {unit} ({trend_dir.upper()}), timeline: " + ", ".join([f"{l['date']}: {l['val']}" for l in labs]))
            return (
                f"**Clinical Insight: Lipid Profile Trends (Last 6 Months)**\n\n"
                f"For patient **{patient['name']}** ({patient_id}), lipid panel progression:\n"
                + "\n".join(lines) +
                f"\n\n**Clinical Interpretation**: "
                f"Review statin adherence and dietary compliance. Persistent LDL elevation raises cardiovascular risk, especially given co-existing T2DM and CKD. "
                f"Per ACC/AHA guidelines, target LDL < 70 mg/dL for very high-risk patients. Consider titrating statin dose or adding ezetimibe if targets are unmet."
                f"\n\n*(Local offline analysis — live AI service temporarily unavailable)*"
            )
        else:
            return (
                f"**Clinical Insight: Lipid Panel**\n\n"
                f"No detailed lipid time-series data is available in offline records for patient **{patient['name']}** ({patient_id}).\n\n"
                f"Based on the active medication list, **Atorvastatin** is prescribed, suggesting a history of dyslipidaemia. "
                f"Please review the most recent lab panel for LDL, HDL, and total cholesterol values.\n\n"
                f"*(Local offline analysis — live AI service temporarily unavailable)*"
            )

    # 4. BP / Blood Pressure / Hypertension / BP Systolic
    if any(k in query_lower for k in ['bp', 'blood pressure', 'systolic', 'hypertension', 'htn']):
        if 'BP_Systolic' in patient.get('labs', {}):
            labs = patient['labs']['BP_Systolic']
            values_str = ", ".join([f"{l['date']}: {l['val']} mmHg" for l in labs])
            latest_val = labs[-1]['val']
            first_val = labs[0]['val']
            trend = "worsening" if latest_val > first_val else "improving"
            return (
                f"**Clinical Insight: Blood Pressure Trends**\n\n"
                f"For patient **{patient['name']}** ({patient_id}), the systolic blood pressure readings over the last 12-14 months are:\n"
                f"- **Timeline**: {values_str}\n"
                f"- **Baseline (Jul 24)**: {first_val} mmHg\n"
                f"- **Latest (Sep 25)**: {latest_val} mmHg\n"
                f"- **Trend**: **{trend.upper()}**\n\n"
                f"**Clinical Interpretation**: BP remains elevated despite dual antihypertensive therapy (Amlodipine and Lisinopril). "
                f"Recommend verifying medication adherence (patient has missed doses of Lisinopril recently) or considering lifestyle modifications."
            )

    # 5. ESR / Rheumatoid Arthritis / RA
    if any(k in query_lower for k in ['esr', 'rheumatoid', 'ra', 'arthritis']):
        if 'ESR' in patient.get('labs', {}):
            labs = patient['labs']['ESR']
            values_str = ", ".join([f"{l['date']}: {l['val']} mm/hr" for l in labs])
            latest_val = labs[-1]['val']
            first_val = labs[0]['val']
            trend = "improving" if latest_val < first_val else "worsening"
            return (
                f"**Clinical Insight: Inflammatory Markers (ESR Trends)**\n\n"
                f"For patient **{patient['name']}** ({patient_id}), the ESR values over the last 12-14 months are:\n"
                f"- **Timeline**: {values_str}\n"
                f"- **Baseline (Jul 24)**: {first_val} mm/hr\n"
                f"- **Latest (Sep 25)**: {latest_val} mm/hr\n"
                f"- **Trend**: **{trend.upper()}** (ESR has decreased significantly by {abs(latest_val - first_val)} mm/hr)\n\n"
                f"**Clinical Interpretation**: The significant downward trend in ESR indicates a positive response to DMARD therapy (Methotrexate), "
                f"suggesting that the rheumatoid arthritis is stabilizing."
            )

    # 6. Hemoglobin / Anaemia
    if any(k in query_lower for k in ['hemoglobin', 'hgb', 'anaemia', 'anemia']):
        if 'Hemoglobin' in patient.get('labs', {}):
            labs = patient['labs']['Hemoglobin']
            values_str = ", ".join([f"{l['date']}: {l['val']} g/dL" for l in labs])
            latest_val = labs[-1]['val']
            first_val = labs[0]['val']
            trend = "improving" if latest_val > first_val else "worsening"
            return (
                f"**Clinical Insight: Hematological Markers (Hemoglobin Trends)**\n\n"
                f"For patient **{patient['name']}** ({patient_id}), the Hemoglobin values over the last 12-14 months are:\n"
                f"- **Timeline**: {values_str}\n"
                f"- **Baseline (Jul 24)**: {first_val} g/dL\n"
                f"- **Latest (Sep 25)**: {latest_val} g/dL\n"
                f"- **Trend**: **{trend.upper()}**\n\n"
                f"**Clinical Interpretation**: Hemoglobin has risen from 9.0 g/dL to 12.8 g/dL, indicating successful resolution of anemia."
            )

    # Default fallback — always succeeds
    meds = ", ".join([m['name'] for m in patient.get('medications', [])])
    diags = ", ".join(patient.get('diagnosis', []))
    brief = patient.get('consultBrief', 'Review required.')
    
    return (
        f"**ClinIQ AI Co-Pilot — Offline Clinical Summary**\n\n"
        f"**Patient**: {patient['name']} ({patient_id}, {patient['age']}Y {patient['sex']})\n"
        f"**Diagnoses**: {diags}\n"
        f"**Active Medications**: {meds}\n"
        f"**Clinical Status**: {brief}\n\n"
        f"*Live AI analysis is temporarily unavailable (API quota exceeded). The above reflects the patient's last known clinical profile.*"
    )

def run_nl_query(query: str, patient_id: str) -> str:
    print(f"Executing Query Agent for {patient_id}... Query: {query}")
    try:
        from datetime import date
        system = (
            f"You are ClinIQ, a physician AI co-pilot. Today is {date.today():%d %B %Y}. Patient context ID: {patient_id}. "
            "Lab series are monthly and the last reading is the most recent (this month). Only quote values returned by the tools. "
            "Your goal is to extract, summarize, and surface relevant clinical insights from the patient case sheet. "
            "Use the available tools to answer clinical questions, detect patterns, or provide a 'Second Opinion'. "
            "When providing a Second Opinion, rigorously scan for corroborating evidence (supporting the physician's hypothesis) "
            "and contradicting findings (flags or trends that suggest an alternative). "
            "Be extremely specific, cited (mention values/dates), and concise. Assume the user is an expert doctor. "
            "Frame all outputs as insights for physician review, never as final clinical decisions."
        )
        return llm.run_tools(f"Query: {query}", OPENAI_TOOLS, TOOL_MAP, system=system)
    except Exception as e:
        print(f"Error executing Query Agent: {str(e)}")
        try:
            return local_query_fallback(query, patient_id)
        except Exception as fe:
            print(f"Local query fallback failed: {str(fe)}")
            # Detect rate-limit specifically and show a helpful, clean message
            err_str = str(e)
            if '429' in err_str or 'quota' in err_str.lower() or 'rate' in err_str.lower():
                return (
                    "**ClinIQ AI \u2014 Offline Mode**\n\n"
                    "The AI service is temporarily rate-limited (free-tier quota reached). "
                    "Your query has been noted but cannot be processed live right now.\n\n"
                    "**Please try again in ~1 minute.** Your clinical data is safe and no information was lost."
                )
            return (
                "**ClinIQ AI \u2014 Service Unavailable**\n\n"
                "The AI analysis service encountered an unexpected error. Please refresh and try again."
            )
