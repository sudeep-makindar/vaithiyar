"""
One-off migration: local database.json + cliniq.db  ->  DynamoDB single table.

Usage (from cliniq-backend/):
    AWS_PROFILE=cliniq AWS_REGION=ap-south-1 TABLE_NAME=<table> \
        .venv/bin/python scripts/migrate_to_dynamodb.py

Safe to re-run: every write is an idempotent put on a fixed key.
"""
import json
import os
import sqlite3
import sys
from datetime import datetime

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)
os.environ["STORAGE_BACKEND"] = "dynamodb"
if not os.getenv("TABLE_NAME"):
    sys.exit("Set TABLE_NAME to the DynamoDB table created by the CDK stack.")

from services.store import DynamoStore, LocalJsonStore  # noqa: E402
from services.dynamo_service import DynamoCacheService  # noqa: E402

SQLITE_FILE = os.path.join(ROOT_DIR, "cliniq.db")


def seconds_until(iso_ts: str) -> int:
    return int((datetime.fromisoformat(iso_ts) - datetime.utcnow()).total_seconds())


def migrate():
    local, ddb, cache = LocalJsonStore(), DynamoStore(), DynamoCacheService()

    patients = local.list_patients()
    for p in patients:
        ddb.put_patient(p)
    ddb.put_meta("PILL_EVENTS", local.get_pill_events())
    ddb.put_meta("INTERACTIONS", local.get_interactions())
    print(f"patients: {len(patients)}, pill events + interactions: done")

    if not os.path.exists(SQLITE_FILE):
        print("no cliniq.db found, skipping caches")
        return

    conn = sqlite3.connect(SQLITE_FILE)
    conn.row_factory = sqlite3.Row
    rows = lambda sql: conn.execute(sql).fetchall()  # noqa: E731
    counts = {}

    for r in rows("SELECT * FROM forecast_cache"):
        ttl = seconds_until(r["expires_at"])
        if ttl > 0:
            cache.set_forecast_cache(r["patient_id"], {
                "trajectory": json.loads(r["trajectory_json"]),
                "forecast_drivers": json.loads(r["drivers_json"]),
                "milestones": json.loads(r["milestones_json"]),
                "intervention_impacts": json.loads(r["interventions_json"]),
            }, expires_in_seconds=ttl)
            counts["forecast"] = counts.get("forecast", 0) + 1

    for r in rows("SELECT * FROM comorbidity_web_cache"):
        ttl = seconds_until(r["expires_at"])
        if ttl > 0:
            cache.set_comorbidity_cache(r["patient_id"], {
                "nodes": json.loads(r["nodes_json"]), "edges": json.loads(r["edges_json"]),
            }, expires_in_seconds=ttl)
            counts["comorbidity"] = counts.get("comorbidity", 0) + 1

    for r in rows("SELECT * FROM organ_assessments"):
        cache.save_organ_assessment(r["patient_id"], r["organ"], r["risk_score"], r["summary_text"],
                                    json.loads(r["biomarkers_json"] or "[]"))
        counts["organ"] = counts.get("organ", 0) + 1

    for r in rows("SELECT * FROM alert_explanations"):
        cache.save_alert_explanation(r["alert_id"], r["explanation_text"])
        counts["alert_explain"] = counts.get("alert_explain", 0) + 1

    for r in rows("SELECT * FROM physician_preferences"):
        cache.save_physician_preferences(r["physician_id"], json.loads(r["voice_config_json"]))
        counts["prefs"] = counts.get("prefs", 0) + 1

    print(f"caches migrated: {counts or 'none'}")


if __name__ == "__main__":
    migrate()
