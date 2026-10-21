"""
DynamoDB implementation of the AI cache / clinical log tables.

Drop-in replacement for the SQLite SupabaseService (same method names and return
shapes). Selected automatically when STORAGE_BACKEND=dynamodb.

Item layout in the shared single table:
  FORECAST#<pid>          / LATEST                 (TTL)
  COMORBIDITY#<pid>       / LATEST                 (TTL)
  ORGAN#<pid>             / <organ>
  ALERT_EXPLAIN           / <alert id>
  SECOND_OPINION#<pid>    / <iso ts>#<id>
  NOTE#<pid>              / <iso ts>#<id>
  VOICE_CMD#<physician>   / <iso ts>#<id>
  VOICE_INT#<pid>         / <iso ts>#<id>
  PREFS                   / <physician id>

DynamoDB TTL deletes expired items in the background (can lag), so reads also
check the ttl attribute themselves.
"""
import json
import time
import uuid
from datetime import datetime

from services.aws import TABLE_NAME, client

DEFAULT_VOICE_PREFS = {
    "primaryLanguage": "en-US",
    "voiceGender": "female",
    "speakingSpeed": 1.0,
    "autoReadAlerts": False,
    "morningBriefing": True,
    "consultationRecording": True,
    "patientModeLanguage": "hi-IN",
    "micSensitivity": 0.5,
    "voiceConfirmation": False,
}


class DynamoCacheService:
    def __init__(self):
        self.table = TABLE_NAME
        self.ddb = client("dynamodb")

    # --- primitives ---
    def _put(self, pk: str, sk: str, data, ttl_seconds: int | None = None):
        item = {"pk": {"S": pk}, "sk": {"S": sk}, "data": {"S": json.dumps(data, default=str)}}
        if ttl_seconds:
            item["ttl"] = {"N": str(int(time.time()) + ttl_seconds)}
        self.ddb.put_item(TableName=self.table, Item=item)

    def _get(self, pk: str, sk: str):
        res = self.ddb.get_item(TableName=self.table, Key={"pk": {"S": pk}, "sk": {"S": sk}})
        item = res.get("Item")
        if not item:
            return None
        if "ttl" in item and int(item["ttl"]["N"]) < time.time():
            return None
        return json.loads(item["data"]["S"])

    def _query(self, pk: str, newest_first: bool = True) -> list:
        res = self.ddb.query(
            TableName=self.table,
            KeyConditionExpression="pk = :pk",
            ExpressionAttributeValues={":pk": {"S": pk}},
            ScanIndexForward=not newest_first,
        )
        return [json.loads(i["data"]["S"]) for i in res["Items"]]

    @staticmethod
    def _now() -> str:
        return datetime.utcnow().isoformat()

    def _log_sk(self) -> tuple[str, str]:
        now, rid = self._now(), str(uuid.uuid4())
        return now, rid

    # --- Forecast cache ---
    def get_forecast_cache(self, patient_id: str):
        return self._get(f"FORECAST#{patient_id}", "LATEST")

    def set_forecast_cache(self, patient_id: str, data: dict, expires_in_seconds: int = 86400):
        self._put(f"FORECAST#{patient_id}", "LATEST", {
            "patient_id": patient_id,
            "generated_at": self._now(),
            "trajectory": data.get("trajectory", data.get("conditions", [])),
            "forecast_drivers": data.get("forecast_drivers", []),
            "milestones": data.get("milestones", []),
            "intervention_impacts": data.get("intervention_impacts", []),
        }, ttl_seconds=expires_in_seconds)

    # --- Comorbidity web cache ---
    def get_comorbidity_cache(self, patient_id: str):
        return self._get(f"COMORBIDITY#{patient_id}", "LATEST")

    def set_comorbidity_cache(self, patient_id: str, data: dict, expires_in_seconds: int = 86400):
        self._put(f"COMORBIDITY#{patient_id}", "LATEST",
                  {"nodes": data.get("nodes", []), "edges": data.get("edges", [])},
                  ttl_seconds=expires_in_seconds)

    # --- Organ assessment ---
    def get_organ_assessment(self, patient_id: str, organ: str):
        return self._get(f"ORGAN#{patient_id}", organ.lower())

    def save_organ_assessment(self, patient_id: str, organ: str, risk_score: int, summary_text: str, biomarkers: list):
        self._put(f"ORGAN#{patient_id}", organ.lower(), {
            "patient_id": patient_id,
            "organ": organ.lower(),
            "risk_score": risk_score,
            "summary_text": summary_text,
            "biomarkers": biomarkers,
            "generated_at": self._now(),
        })

    # --- Second opinion ---
    def save_second_opinion(self, patient_id: str, hypothesis: str, confidence_score: int, verdict: str, evidence_chain: str):
        now, rid = self._log_sk()
        self._put(f"SECOND_OPINION#{patient_id}", f"{now}#{rid}", {
            "id": rid, "patient_id": patient_id, "hypothesis": hypothesis,
            "confidence_score": confidence_score, "verdict": verdict,
            "evidence_chain": evidence_chain, "generated_at": now,
        })

    # --- Alert explanations ---
    def get_alert_explanation(self, alert_id: str):
        cached = self._get("ALERT_EXPLAIN", alert_id)
        return cached["explanation_text"] if cached else None

    def save_alert_explanation(self, alert_id: str, explanation_text: str):
        self._put("ALERT_EXPLAIN", alert_id, {"explanation_text": explanation_text, "generated_at": self._now()})

    # --- Voice: consultation notes ---
    def save_consultation_note(self, patient_id: str, physician_id: str, raw_transcript: str, structured_note_json: dict,
                               duration_seconds: int, language_code: str, status: str = "draft"):
        now, rid = self._log_sk()
        self._put(f"NOTE#{patient_id}", f"{now}#{rid}", {
            "id": rid, "patient_id": patient_id, "physician_id": physician_id, "recorded_at": now,
            "raw_transcript": raw_transcript, "structured_note": structured_note_json or {},
            "duration_seconds": duration_seconds, "language_code": language_code, "status": status,
        })
        return rid

    def get_consultation_notes(self, patient_id: str):
        return self._query(f"NOTE#{patient_id}")

    # --- Voice: command + patient interaction logs ---
    def log_voice_command(self, physician_id: str, patient_id: str, command_text: str, interpreted_action: str,
                          confidence: float, page_context: str, success: int):
        now, rid = self._log_sk()
        self._put(f"VOICE_CMD#{physician_id}", f"{now}#{rid}", {
            "id": rid, "physician_id": physician_id, "patient_id": patient_id, "command_text": command_text,
            "interpreted_action": interpreted_action, "confidence": confidence, "executed_at": now,
            "page_context": page_context, "success": success,
        })

    def save_patient_interaction(self, patient_id: str, physician_id: str, spoken_input: str, detected_language: str,
                                 structured_output_json: dict, physician_alerted: int):
        now, rid = self._log_sk()
        self._put(f"VOICE_INT#{patient_id}", f"{now}#{rid}", {
            "id": rid, "patient_id": patient_id, "physician_id": physician_id, "spoken_input": spoken_input,
            "detected_language": detected_language, "structured_output": structured_output_json,
            "physician_alerted": physician_alerted, "created_at": now,
        })

    # --- Physician preferences ---
    def get_physician_preferences(self, physician_id: str):
        return self._get("PREFS", physician_id) or dict(DEFAULT_VOICE_PREFS)

    def save_physician_preferences(self, physician_id: str, voice_config: dict):
        self._put("PREFS", physician_id, voice_config)
