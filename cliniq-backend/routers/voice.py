import os
import json
import base64
import uuid
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from services.supabase_service import db_service
from agents.voice_query_agent import run_voice_query
from services import aws, llm

MEDICAL_VOCAB_HINT = "Clinical consultation. Drug names: metformin, apixaban, metoprolol, amlodipine, atorvastatin, lisinopril. HbA1c, creatinine, eGFR."

router = APIRouter(prefix="/api/voice", tags=["voice"])

class CommandRequest(BaseModel):
    transcribed_text: str
    current_page: str
    patient_id: str = None
    physician_id: str = "doc-1"

class SynthesizeRequest(BaseModel):
    text: str
    language_code: str = "en-US"
    voice_name: str = "en-IN-Neural2-D"
    speed: float = 1.0

class TranslateRequest(BaseModel):
    text: str
    source_language: str = "auto"
    target_language: str = "en"

class VoiceQueryRequest(BaseModel):
    patient_id: str
    query: str
    source: str = "voice"

# Helper: Clean JSON from a model's markdown block
def clean_llm_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()
    try:
        return json.loads(cleaned)
    except Exception as e:
        print(f"Error decoding JSON from model output: {e}\nRaw output: {text}")
        return {"error": "Failed to parse JSON", "raw": text}

# 1. /api/voice/transcribe
@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language_code: str = Form("en-US"),
    context: str = Form("command")
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    try:
        # Groq Whisper speech-to-text (multilingual: hi, ta, te, ml, kn, bn, mr, en)
        prompt = MEDICAL_VOCAB_HINT if context in ["clinical_note", "consultation"] else None
        transcribed_text = llm.transcribe(audio_bytes, audio.filename or "audio.webm",
                                          audio.content_type or "audio/webm", language_code, prompt)
        return {
            "transcribed_text": transcribed_text,
            "detected_language": language_code,
            "confidence": 0.9,
            "engine": "groq_whisper"
        }
    except Exception as e:
        print(f"Transcription failure: {e}")
        return {"error": str(e), "transcribed_text": ""}

# 2. /api/voice/synthesize
@router.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    try:
        # Amazon Polly neural voices (en-IN / hi-IN "Kajal") when running on AWS
        polly_audio = aws.synthesize_speech(req.text, req.language_code, req.speed)
        if polly_audio:
            return {
                "audio_base64": base64.b64encode(polly_audio).decode("utf-8"),
                "format": "mp3",
                "engine": "amazon_polly"
            }
        # Client-side browser speech when Polly is unavailable (local dev, unsupported language)
        return {
            "audio_base64": "",
            "format": "mp3",
            "engine": "browser_fallback",
            "text_to_speak": req.text,
            "language_code": req.language_code
        }
    except Exception as e:
        return {"error": str(e)}

# 3. /api/voice/translate
@router.post("/translate")
def translate(req: TranslateRequest):
    # Amazon Translate first (purpose-built, cheaper per call); LLM as fallback
    aws_translated = aws.translate_text(req.text, req.source_language, req.target_language)
    if aws_translated is not None:
        return {
            "translated_text": aws_translated,
            "source_language": req.source_language,
            "target_language": req.target_language,
            "engine": "amazon_translate"
        }
    try:
        # LLM translation fallback
        prompt = (
            f"Translate the following text to '{req.target_language}'. "
            f"If source language is '{req.source_language}', auto-detect it. "
            "Return only the translated text, with no extra formatting, quotes, or introductory text.\n\n"
            f"Text: {req.text}"
        )
        translated_text = llm.generate(prompt, temperature=0.1).strip()
        
        return {
            "translated_text": translated_text,
            "source_language": req.source_language,
            "target_language": req.target_language
        }
    except Exception as e:
        return {"error": str(e), "translated_text": req.text}

# 4. /api/voice/command
@router.post("/command")
def command(req: CommandRequest):
    try:
        prompt = (
            "You are a clinical voice command interpreter for a physician dashboard called ClinIQ+. "
            f"The physician said: \"{req.transcribed_text}\". They are currently on the \"{req.current_page}\" page "
            f"viewing patient \"{req.patient_id or 'none'}\". "
            "Interpret this as a structured command and return only valid JSON in this exact format: "
            "{\n"
            "  \"action\": \"string\",\n"
            "  \"target\": \"string\",\n"
            "  \"parameters\": {},\n"
            "  \"confidence\": 0.95,\n"
            "  \"clarification_needed\": false,\n"
            "  \"clarification_prompt\": \"\"\n"
            "}\n\n"
            "Possible actions:\n"
            "- navigate_page (target: dashboard, patients, forecasts, analytics, alerts, pillguard, intake, settings)\n"
            "- show_patient (target: patient_id or patient name)\n"
            "- show_biomarker (target: e.g. HbA1c, BP, Creatinine)\n"
            "- run_forecast (target: patient_id)\n"
            "- toggle_intervention (target: metformin, diet, exercise)\n"
            "- explain_alert (target: alert_id)\n"
            "- read_summary (target: dashboard briefing)\n"
            "- search_patient (target: name string)\n"
            "- open_pillguard\n"
            "- show_comorbidity\n"
            "- set_date_range (target: e.g. last 6 months)\n"
            "- export_report\n"
            "- call_patient\n\n"
            "If confidence is below 0.7 set clarification_needed to true and provide a clarification_prompt question to ask the physician. "
            "Return ONLY the JSON block, no markdown formatting."
        )
        
        parsed_action = llm.generate_json(prompt, temperature=0.1)
        
        # Log to voice_commands_log
        db_service.log_voice_command(
            physician_id=req.physician_id,
            patient_id=req.patient_id,
            command_text=req.transcribed_text,
            interpreted_action=parsed_action.get("action", "unknown"),
            confidence=parsed_action.get("confidence", 0.0),
            page_context=req.current_page,
            success=1 if not parsed_action.get("clarification_needed", False) else 0
        )
        
        return parsed_action
    except Exception as e:
        print(f"Command processing error: {e}")
        return {
            "action": "unknown",
            "target": "",
            "parameters": {},
            "confidence": 0.0,
            "clarification_needed": True,
            "clarification_prompt": "I experienced a system error. Could you repeat that command?"
        }

# 5. /api/voice/consultation-record
@router.post("/consultation-record")
async def consultation_record(
    audio: UploadFile = File(...),
    patient_id: str = Form(...),
    physician_id: str = Form("doc-1")
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty recording")
    aws.archive_to_s3(f"uploads/consultations/{patient_id}", audio_bytes, audio.content_type or "audio/webm", "consultation.webm")

    try:
        transcript = llm.transcribe(audio_bytes, audio.filename or "consultation.webm",
                                    audio.content_type or "audio/webm", None, MEDICAL_VOCAB_HINT)

        prompt = (
            "You are a clinical scribe. Below is the transcript of a consultation between a physician and patient. "
            "First, rewrite the transcript labelling each turn with the speaker (Physician vs Patient). "
            "Second, extract the following structured clinical notes:\n"
            "- chief_complaint: The primary symptom or reason for visit.\n"
            "- symptoms_mentioned: A list of symptoms (e.g. fatigue, chest pain).\n"
            "- physician_observations: Key observations discussed.\n"
            "- medications_discussed: List of objects, each with 'name', 'dose', and 'frequency'.\n"
            "- follow_up_instructions: Next steps or return advice.\n"
            "- diagnostic_orders: Labs or tests ordered (e.g., echocardiogram, blood test).\n\n"
            "Return a valid JSON object in this exact schema, with no markdown tags or explanations:\n"
            "{\n"
            "  \"raw_transcript\": \"...\",\n"
            "  \"structured_note\": {\n"
            "     \"chief_complaint\": \"...\",\n"
            "     \"symptoms_mentioned\": [...],\n"
            "     \"physician_observations\": \"...\",\n"
            "     \"medications_discussed\": [\n"
            "        {\"name\": \"...\", \"dose\": \"...\", \"frequency\": \"...\"}\n"
            "     ],\n"
            "     \"follow_up_instructions\": \"...\",\n"
            "     \"diagnostic_orders\": [...]\n"
            "  }\n"
            "}"
        )
        
        parsed_result = llm.generate_json(f"{prompt}\n\nTRANSCRIPT:\n{transcript}", temperature=0.1)
        
        raw_transcript = parsed_result.get("raw_transcript") or transcript or "Transcript unavailable."
        structured_note = parsed_result.get("structured_note", {})
        
        # Save note to local SQLite
        note_id = db_service.save_consultation_note(
            patient_id=patient_id,
            physician_id=physician_id,
            raw_transcript=raw_transcript,
            structured_note_json=structured_note,
            duration_seconds=120, # estimated
            language_code="en-US"
        )
        
        return {
            "id": note_id,
            "raw_transcript": raw_transcript,
            "structured_note": structured_note
        }
    except Exception as e:
        print(f"Scribe endpoint error: {e}")
        return {
            "error": str(e),
            "raw_transcript": "Error during processing.",
            "structured_note": {
                "chief_complaint": "Processing failed",
                "symptoms_mentioned": [],
                "physician_observations": str(e),
                "medications_discussed": [],
                "follow_up_instructions": "Review manually",
                "diagnostic_orders": []
            }
        }

# 6. /api/voice/patient-symptom
@router.post("/patient-symptom")
async def patient_symptom(
    audio: UploadFile = File(...),
    language_code: str = Form("en-US"),
    patient_id: str = Form(...)
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty symptom audio")
    aws.archive_to_s3(f"uploads/symptoms/{patient_id}", audio_bytes, audio.content_type or "audio/webm", "symptom.webm")

    try:
        # Whisper transcribes in the patient's own language; then translate to English
        native_text = llm.transcribe(audio_bytes, audio.filename or "symptom.webm",
                                     audio.content_type or "audio/webm", language_code)
        english_text = native_text
        if not language_code.startswith("en"):
            english_text = (aws.translate_text(native_text, language_code, "en")
                            or llm.generate(f"Translate this patient's words into English. Return only the translation.\n\n{native_text}", temperature=0.1).strip())
        
        # Extract structured data
        extraction_prompt = (
            "A patient described their symptoms in natural language. "
            f"Transcript (English): \"{english_text}\". "
            "Extract: primary complaint, symptom duration, severity (1-10), associated symptoms, relevant history mentions. "
            "Also generate a patient-friendly, reassuring clinical advice response. "
            "Return only a JSON object in this format:\n"
            "{\n"
            "  \"primary_complaint\": \"...\",\n"
            "  \"duration\": \"...\",\n"
            "  \"severity\": 5,\n"
            "  \"associated_symptoms\": [...],\n"
            "  \"history_mentions\": [...],\n"
            "  \"reassuring_advice_english\": \"...\"\n"
            "}"
        )
        
        extracted_data = llm.generate_json(extraction_prompt, temperature=0.2)
        
        # Translate the reassuring advice back to the patient's language
        advice_en = extracted_data.get("reassuring_advice_english", "Thank you, I have logged your symptoms. The doctor will review them shortly.")
        
        trans_back_prompt = (
            f"Translate the following patient reassurance text into the patient's native language code: {language_code}. "
            "Ensure the tone is warm, empathetic, and culturally appropriate. "
            "Return ONLY the translated text, no quotes or additional information.\n\n"
            f"Text: {advice_en}"
        )
        
        advice_native = (aws.translate_text(advice_en, "en", language_code)
                         or llm.generate(trans_back_prompt, temperature=0.3).strip())
        
        severity = extracted_data.get("severity", 0)
        try:
            severity = int(severity)
        except (TypeError, ValueError):
            severity = 0

        # High-severity symptoms page the physician via SNS (email/SMS subscribers)
        if severity >= 7:
            aws.publish_alert(
                f"ClinIQ+ ALERT: patient {patient_id} reported severity {severity}/10",
                {
                    "patient_id": patient_id,
                    "primary_complaint": extracted_data.get("primary_complaint"),
                    "severity": severity,
                    "duration": extracted_data.get("duration"),
                    "associated_symptoms": extracted_data.get("associated_symptoms"),
                    "english_translation": english_text,
                },
            )

        # Save interaction log
        db_service.save_patient_interaction(
            patient_id=patient_id,
            physician_id="doc-1",
            spoken_input=native_text,
            detected_language=language_code,
            structured_output_json=extracted_data,
            physician_alerted=1 if severity >= 7 else 0
        )
        
        return {
            "native_transcript": native_text,
            "english_translation": english_text,
            "structured_data": extracted_data,
            "patient_reassurance_native": advice_native
        }
        
    except Exception as e:
        print(f"Patient symptom endpoint error: {e}")
        return {
            "error": str(e),
            "native_transcript": "",
            "english_translation": "",
            "structured_data": {},
            "patient_reassurance_native": "Error processing your request. Please tell your doctor directly."
        }
print("VOICE QUERY ROUTE LOADED")

@router.post("/query")
async def clinical_voice_query(
    req: VoiceQueryRequest
):

    try:

        result = await run_voice_query(
            query=req.query,
            patient_id=req.patient_id
        )

        return result

    except Exception as e:

        print("Voice Query Error:", e)

        error_detail = str(e)
        if "GROQ_API_KEY" in error_detail:
            summary = "AI service is not configured. Set GROQ_API_KEY in cliniq-backend/.env and restart the backend."
        else:
            summary = f"Failed to process query: {error_detail}"

        return {
            "response_type": "patient_summary",
            "intent_detected": req.query,
            "summary": summary,
            "data": {},
            "confidence": "low"
        }
@router.get("/test-query")
def test_query():
    return {"status": "voice route loaded"}