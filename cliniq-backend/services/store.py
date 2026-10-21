"""
Patient record store.

Two interchangeable backends selected by STORAGE_BACKEND:
  local    -> database.json next to main.py (original behaviour, for laptop dev)
  dynamodb -> single DynamoDB table (pk/sk), used on AWS Lambda

DynamoDB single-table layout (shared with services/dynamo_service.py caches):
  pk="PATIENT"  sk=<patient id>        data=<patient JSON>
  pk="META"     sk="PILL_EVENTS"       data=<list JSON>
  pk="META"     sk="INTERACTIONS"      data=<list JSON>

Records are kept as a JSON string attribute: patient documents are deeply nested
and contain floats, which DynamoDB would otherwise force into Decimal.
"""
import json
import os

from services.aws import STORAGE_BACKEND, TABLE_NAME, client
from services.clinical import enrich, present

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_DB_FILE = os.path.join(BACKEND_DIR, "database.json")


class LocalJsonStore:
    def _load(self) -> dict:
        if os.path.exists(JSON_DB_FILE):
            with open(JSON_DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        from mock_data import PATIENTS, PILL_SCAN_EVENTS, DRUG_INTERACTIONS
        db = {"patients": PATIENTS, "pill_events": PILL_SCAN_EVENTS, "interactions": DRUG_INTERACTIONS}
        self._save(db)
        return db

    def _save(self, db: dict):
        with open(JSON_DB_FILE, "w", encoding="utf-8") as f:
            json.dump(db, f, indent=2)

    def list_patients(self) -> list:
        return [present(p) for p in self._load().get("patients", [])]

    def get_patient(self, patient_id: str) -> dict | None:
        return next((p for p in self.list_patients() if p.get("id") == patient_id), None)

    def get_raw_patient(self, patient_id: str) -> dict | None:
        return next((p for p in self._load().get("patients", []) if p.get("id") == patient_id), None)

    def put_patient(self, patient: dict):
        patient = enrich(patient)
        db = self._load()
        patients = db.setdefault("patients", [])
        idx = next((i for i, p in enumerate(patients) if p.get("id") == patient["id"]), None)
        if idx is None:
            patients.append(patient)
        else:
            patients[idx] = patient
        self._save(db)

    def delete_patient(self, patient_id: str) -> bool:
        db = self._load()
        before = len(db.get("patients", []))
        db["patients"] = [p for p in db.get("patients", []) if p.get("id") != patient_id]
        self._save(db)
        return len(db["patients"]) < before

    def get_pill_events(self) -> list:
        return self._load().get("pill_events", [])

    def get_interactions(self) -> list:
        return self._load().get("interactions", [])

    def get_meta(self, name: str, default=None):
        return self._load().get("meta", {}).get(name, default)

    def put_meta(self, name: str, value):
        db = self._load()
        db.setdefault("meta", {})[name] = value
        self._save(db)


class DynamoStore:
    def __init__(self):
        self.table = TABLE_NAME
        self.ddb = client("dynamodb")

    def list_patients(self) -> list:
        items, kwargs = [], {
            "TableName": self.table,
            "KeyConditionExpression": "pk = :pk",
            "ExpressionAttributeValues": {":pk": {"S": "PATIENT"}},
        }
        while True:
            res = self.ddb.query(**kwargs)
            items += [present(json.loads(i["data"]["S"])) for i in res["Items"]]
            if "LastEvaluatedKey" not in res:
                return items
            kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]

    def get_raw_patient(self, patient_id: str) -> dict | None:
        res = self.ddb.get_item(TableName=self.table, Key={"pk": {"S": "PATIENT"}, "sk": {"S": patient_id}})
        return json.loads(res["Item"]["data"]["S"]) if "Item" in res else None

    def get_patient(self, patient_id: str) -> dict | None:
        raw = self.get_raw_patient(patient_id)
        return present(raw) if raw else None

    def put_patient(self, patient: dict):
        patient = enrich(patient)
        self.ddb.put_item(TableName=self.table, Item={
            "pk": {"S": "PATIENT"}, "sk": {"S": patient["id"]}, "data": {"S": json.dumps(patient)},
        })

    def delete_patient(self, patient_id: str) -> bool:
        res = self.ddb.delete_item(
            TableName=self.table, Key={"pk": {"S": "PATIENT"}, "sk": {"S": patient_id}}, ReturnValues="ALL_OLD"
        )
        return "Attributes" in res

    def get_meta(self, name: str, default=None):
        res = self.ddb.get_item(TableName=self.table, Key={"pk": {"S": "META"}, "sk": {"S": name}})
        return json.loads(res["Item"]["data"]["S"]) if "Item" in res else default

    def put_meta(self, name: str, value):
        self.ddb.put_item(TableName=self.table, Item={
            "pk": {"S": "META"}, "sk": {"S": name}, "data": {"S": json.dumps(value)},
        })

    def get_pill_events(self) -> list:
        return self.get_meta("PILL_EVENTS", [])

    def get_interactions(self) -> list:
        return self.get_meta("INTERACTIONS", [])


store = DynamoStore() if STORAGE_BACKEND == "dynamodb" else LocalJsonStore()
