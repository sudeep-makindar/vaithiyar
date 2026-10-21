from mock_data import DRUG_INTERACTIONS, GUIDELINES
from services.store import store

# All functions return dicts that the LLM can read as tool results

def get_patient_case_sheet(patient_id: str) -> dict:
    patient = store.get_patient(patient_id)  # never fall back to stale mock records
    if not patient: return {'error': 'Patient not found'}
    return patient

def extract_lab_trends(patient_id: str, test_name: str, date_range: str = 'all') -> dict:
    patient = get_patient_case_sheet(patient_id)
    if 'error' in patient: return patient
    
    labs = patient.get('labs', {}).get(test_name, [])
    if not labs: return {'error': f'No {test_name} data for {patient_id}'}
    
    # Simple date filtering (mock for now since we use 'Jan 25' format)
    # In a real app we'd parse the dates
    filtered_labs = labs[-6:] if date_range == 'last 6 months' else labs
    
    if not filtered_labs: return {'error': 'No data in range'}

    first, last = filtered_labs[0], filtered_labs[-1]
    
    # Clinical logic: Rising HbA1c or BP is usually 'worsening'
    if test_name in ['HbA1c', 'BP_Systolic', 'Creatinine']:
        trend = 'worsening' if last['val'] > first['val'] else 'improving'
    else:
        # For things like Hemoglobin, falling is bad
        trend = 'improving' if last['val'] > first['val'] else 'worsening'

    return { 
        'test': test_name, 
        'data': filtered_labs, 
        'trend': trend,
        'first': first, 
        'latest': last,
        'change': round(last['val'] - first['val'], 2) 
    }

def check_drug_interactions(medication_list: list) -> dict:
    interactions = []
    med_names = [(m['name'] if isinstance(m, dict) else str(m)).lower() for m in medication_list]
    taking = lambda drug: any(drug.lower() in name or name in drug.lower() for name in med_names)  # noqa: E731
    for pair in store.get_interactions() or DRUG_INTERACTIONS:
        if taking(pair['drug_a']) and taking(pair['drug_b']):
            interactions.append(pair)
    return { 'interactions': interactions, 'count': len(interactions) }

def get_clinical_guideline(diagnosis_code: str, query_type: str) -> dict:
    guide = GUIDELINES.get(diagnosis_code, {})
    return guide if guide else {'error': f'No guideline for {diagnosis_code}'}

def generate_consultation_brief(patient_id: str) -> dict:
    patient = get_patient_case_sheet(patient_id)
    if 'error' in patient: return patient
    
    # Aggregate dynamic data
    med_names = [m['name'] for m in patient.get('medications', [])]
    interactions = check_drug_interactions(med_names)
    
    # Get trends for primary vitals
    hba1c = extract_lab_trends(patient_id, 'HbA1c')
    bp = extract_lab_trends(patient_id, 'BP_Systolic')
    
    brief = {
        'patient_name': patient['name'],
        'diagnoses': patient['diagnosis'],
        'medications': med_names,
        'interaction_risk': interactions['count'] > 0,
        'interaction_details': interactions['interactions'],
        'primary_trends': {
            'HbA1c': hba1c.get('trend', 'N/A'),
            'BP': bp.get('trend', 'N/A')
        },
        'status_summary': patient.get('consultBrief', 'Review required.')
    }
    return brief

def flag_clinical_pattern(patient_id: str, pattern_type: str) -> dict:
    patient = get_patient_case_sheet(patient_id)
    if 'error' in patient: return patient
    
    detected = []
    
    # Autonomous detection logic
    if pattern_type == 'Vitals':
        bp_data = extract_lab_trends(patient_id, 'BP_Systolic')
        if not 'error' in bp_data and bp_data['latest']['val'] > 140:
            detected.append({
                'type': 'Hypertension Alert',
                'description': f"Current BP ({bp_data['latest']['val']}) is above target (140) despite medication.",
                'severity': 'HIGH'
            })
            
    if pattern_type == 'Lab Alert':
        hba1c_data = extract_lab_trends(patient_id, 'HbA1c')
        if not 'error' in hba1c_data and hba1c_data['trend'] == 'worsening':
             detected.append({
                'type': 'Glycemic Control',
                'description': f"HbA1c has increased by {hba1c_data['change']} over the observed period.",
                'severity': 'MEDIUM'
            })

    # Fallback to pre-defined patterns in mock_data
    existing = [p for p in patient.get('clinicalPatterns', []) if p['type'] == pattern_type]
    
    return { 
        'patterns': detected + existing, 
        'detected_count': len(detected),
        'total_count': len(detected) + len(existing) 
    }
