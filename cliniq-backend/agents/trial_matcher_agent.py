import re
import os
import json

def extract_trials_from_studies(studies: list) -> list:
    """Extract relevant fields from raw ClinicalTrials.gov study objects."""
    extracted = []
    for study in studies[:5]:
        protocol = study.get("protocolSection", {})
        ident = protocol.get("identificationModule", {})
        eligibility = protocol.get("eligibilityModule", {})
        desc = protocol.get("descriptionModule", {})
        design = protocol.get("designModule", {})

        raw_eligibility = eligibility.get("eligibilityCriteria", "Not specified")
        raw_summary = desc.get("briefSummary", "No summary available.")

        extracted.append({
            "nctId": ident.get("nctId", "Unknown"),
            "briefTitle": ident.get("briefTitle", "Unknown Title"),
            "eligibilityCriteria": raw_eligibility,
            "minimumAge": eligibility.get("minimumAge", "Not specified"),
            "maximumAge": eligibility.get("maximumAge", "Not specified"),
            "sex": eligibility.get("sex", "ALL"),
            "briefSummary": raw_summary[:300] + ("..." if len(raw_summary) > 300 else ""),
            "phases": design.get("phases", [])
        })
    return extracted


def parse_age_years(age_str: str) -> int | None:
    """Convert strings like '18 Years', '65 Years' to int."""
    if not age_str or age_str == "Not specified":
        return None
    match = re.search(r"(\d+)", age_str)
    return int(match.group(1)) if match else None


def rule_based_screen(patient: dict, trial: dict) -> dict:
    """
    Deterministic rule-based eligibility screening.
    Returns eligible, match_reasons, disqualifiers, priority_score.
    """
    age = patient.get("age", 0)
    sex = (patient.get("sex") or "").lower()
    diagnoses = [d.lower() for d in patient.get("diagnosis", [])]
    medications = [m.lower() for m in patient.get("active_medications", [])]

    criteria_text = trial.get("eligibilityCriteria", "").lower()
    trial_sex = (trial.get("sex") or "ALL").upper()
    min_age = parse_age_years(trial.get("minimumAge"))
    max_age = parse_age_years(trial.get("maximumAge"))
    title = trial.get("briefTitle", "").lower()
    summary = trial.get("briefSummary", "").lower()

    match_reasons = []
    disqualifiers = []
    score = 5  # baseline

    # --- Age check ---
    if min_age is not None and age < min_age:
        disqualifiers.append(f"Patient age ({age}) is below minimum age ({min_age})")
        score -= 3
    elif max_age is not None and age > max_age:
        disqualifiers.append(f"Patient age ({age}) exceeds maximum age ({max_age})")
        score -= 3
    else:
        match_reasons.append(f"Age {age} is within trial range ({min_age or '?'}–{max_age or '?'} years)")
        score += 1

    # --- Sex check ---
    if trial_sex not in ("ALL", ""):
        trial_sex_norm = trial_sex.lower()
        if trial_sex_norm != sex and trial_sex_norm not in ("all",):
            disqualifiers.append(f"Trial requires {trial_sex} participants; patient is {sex}")
            score -= 4
        else:
            match_reasons.append(f"Sex eligibility matches ({sex})")
            score += 1
    else:
        match_reasons.append("Trial accepts all sexes")
        score += 1

    # --- Diagnosis match ---
    diagnosis_hit = False
    for diag in diagnoses:
        keywords = diag.replace(",", " ").split()
        for kw in keywords:
            if len(kw) > 3 and (kw in title or kw in summary or kw in criteria_text):
                match_reasons.append(f"Diagnosis '{diag}' matches trial focus")
                score += 2
                diagnosis_hit = True
                break
        if diagnosis_hit:
            break

    if not diagnosis_hit:
        disqualifiers.append("Patient's diagnoses may not directly match trial focus area")
        score -= 1

    # --- Medication exclusion signals ---
    exclusion_meds = []
    if "insulin" in criteria_text and "insulin" in medications:
        exclusion_meds.append("insulin")
    if "metformin" in criteria_text and "metformin" in medications:
        if "must be on metformin" in criteria_text or "metformin required" in criteria_text:
            match_reasons.append("Patient on metformin, which trial may require")
            score += 1
        elif "no metformin" in criteria_text or "metformin naive" in criteria_text:
            exclusion_meds.append("metformin")

    if exclusion_meds:
        disqualifiers.append(f"Current medication(s) may be exclusion criteria: {', '.join(exclusion_meds)}")
        score -= 2

    # --- Clamp score ---
    score = max(1, min(10, score))

    # --- Determine eligible label ---
    if score >= 7:
        eligible = "likely"
    elif score >= 4:
        eligible = "possible"
    else:
        eligible = "unlikely"

    if not match_reasons:
        match_reasons = ["No strong matching signals found; manual review recommended"]

    return {
        "eligible": eligible,
        "confidence": round(min(score / 10, 1.0), 2),
        "match_reasons": match_reasons,
        "disqualifiers": disqualifiers,
        "priority_score": score
    }


async def screen_trials_with_ai(patient: dict, studies: list) -> dict:
    """
    LLM-powered trial screening (Groq), with a deterministic rule-based fallback.
    """
    import asyncio
    from services import llm

    try:
        diagnoses = patient.get("diagnosis", [])
        age = patient.get("age", 0)
        sex = patient.get("sex", "Unknown")

        if not studies:
            return {"patient_id": patient.get("id"), "matches": [], "total_searched": 0}

        extracted_trials = extract_trials_from_studies(studies)

        prompt = f"""You are a clinical trial eligibility screener. Evaluate the patient against each trial and return a JSON array.

Patient: Age {age}, Sex {sex}, Diagnoses: {', '.join(diagnoses)}

Trials:
{json.dumps(extracted_trials, indent=2)}

Return ONLY a JSON object of the form {{"trials": [...]}}. Each trial object must have: nctId, briefTitle, phases, eligible ("likely"|"possible"|"unlikely"), confidence (0-1), match_reasons (list), disqualifiers (list), priority_score (1-10)."""

        text = await asyncio.to_thread(llm.generate, prompt, json_mode=True, temperature=0.1)
        parsed = llm.parse_json(text)
        evaluated_trials = parsed.get("trials", []) if isinstance(parsed, dict) else parsed

        evaluated_trials.sort(key=lambda x: x.get("priority_score", 0), reverse=True)

        return {
            "patient_id": patient.get("id"),
            "matches": evaluated_trials,
            "total_searched": len(studies)
        }

    except Exception as e:
        print(f"AI trial screening failed: {e}. Falling back to rule-based screening.")
        try:
            extracted_trials = extract_trials_from_studies(studies)
            evaluated_trials = []
            for trial in extracted_trials:
                screen_res = rule_based_screen(patient, trial)
                evaluated_trials.append({
                    "nctId": trial["nctId"],
                    "briefTitle": trial["briefTitle"],
                    "phases": trial["phases"],
                    "eligible": screen_res["eligible"],
                    "confidence": screen_res["confidence"],
                    "match_reasons": screen_res["match_reasons"],
                    "disqualifiers": screen_res["disqualifiers"],
                    "priority_score": screen_res["priority_score"]
                })
            
            evaluated_trials.sort(key=lambda x: x.get("priority_score", 0), reverse=True)
            return {
                "patient_id": patient.get("id"),
                "matches": evaluated_trials,
                "total_searched": len(studies),
                "fallback_active": True
            }
        except Exception as fallback_err:
            return {"error": f"Fallback matching failed: {fallback_err}"}
