"""
Builds the ClinIQ+ demo cohort: 9 patients with 24 months of clinically plausible lab trends.

Lab series are stored without fixed months (patient["demo"] = True) and are labelled relative
to the current month when served, and event times are stored as "minutes ago", so the demo
never looks stale. Risk scores, organ flags and lab alerts are computed by services/clinical.py,
not written here.

Usage (from cliniq-backend/):
    .venv/bin/python scripts/generate_demo_data.py                 # local database.json + cliniq.db
    AWS_PROFILE=cliniq AWS_REGION=ap-southeast-2 TABLE_NAME=<table> \
        .venv/bin/python scripts/generate_demo_data.py --target dynamodb
"""
import argparse
import json
import math
import os
import random
import sqlite3
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

MONTHS = 24
COLORS = {"white": "#e5e7eb", "yellow": "#f59e0b", "blue": "#1a6bff", "pink": "#ec4899",
          "orange": "#f97316", "green": "#10b981", "purple": "#8b5cf6", "red": "#ef4444"}


def series(start, end, *, noise=0.0, decimals=1, shape="linear", spike_at=None, spike=0.0, seed=0):
    """Monthly values from start to end with gentle noise and an optional acute episode."""
    rng = random.Random(seed)
    out = []
    for i in range(MONTHS):
        t = i / (MONTHS - 1)
        if shape == "late":            # flat then accelerating (decompensation)
            t = t ** 2.2
        elif shape == "early":         # fast response to treatment, then plateau
            t = 1 - (1 - t) ** 2.5
        v = start + (end - start) * t
        if spike_at is not None:
            v += spike * math.exp(-((i - spike_at) ** 2) / 2.0)
        if 0 < i < MONTHS - 1:
            v += rng.uniform(-noise, noise)
        out.append({"val": round(v, decimals) if decimals else int(round(v))})
    return out


def med(name, dose, freq, color, shape="Round", markings="-"):
    return {"name": name, "dose": dose, "freq": freq, "color": COLORS[color], "shape": shape, "markings": markings}


def event(kind, description, severity, minutes_ago):
    return {"type": kind, "description": description, "severity": severity, "minutes_ago": minutes_ago}


PATIENTS = [
    {
        "id": "P-00142", "name": "Arjun Mehta", "age": 58, "sex": "Male", "dob": "12 Mar 1968",
        "doctor": "Dr. Vedanth", "ward": "Endocrinology", "adherenceScore": 64,
        "adherenceCalendar": [True, False, True, True, False, True, False],
        "diagnosis": ["Type 2 Diabetes Mellitus with hyperglycaemia (E11.65)",
                      "Chronic Kidney Disease, stage 3a (N18.31)",
                      "Essential Hypertension (I10)",
                      "Paroxysmal Atrial Fibrillation (I48.0)"],
        "medications": [med("Metformin", "1000 mg", "Twice daily", "white", "Oblong", "G 1000"),
                        med("Empagliflozin", "10 mg", "Once daily", "yellow", "Oval", "S 10"),
                        med("Telmisartan", "40 mg", "Once daily", "white", "Oval", "T 40"),
                        med("Apixaban", "5 mg", "Twice daily", "pink", "Oval", "894 5"),
                        med("Atorvastatin", "40 mg", "At bedtime", "white", "Round", "A 40")],
        "labs": {"HbA1c": series(7.1, 9.4, noise=0.15, seed=1, shape="late"),
                 "Glucose": series(138, 212, noise=12, decimals=0, seed=2, shape="late"),
                 "Creatinine": series(1.0, 1.7, noise=0.05, decimals=2, seed=3),
                 "eGFR": series(82, 44, noise=3, decimals=0, seed=4),
                 "Potassium": series(4.3, 5.1, noise=0.12, decimals=1, seed=5),
                 "BP_Systolic": series(128, 146, noise=5, decimals=0, seed=6),
                 "LDL": series(124, 96, noise=6, decimals=0, seed=7, shape="early")},
        "consultBrief": "Glycaemic control deteriorating (HbA1c 9.4%) with declining eGFR. Review Metformin dose for "
                        "renal function, reinforce Apixaban adherence (2 missed evening doses this week).",
        "events": [event("Missed Dose", "Apixaban 5 mg evening dose missed on 2 of the last 7 days (PillGuard).", "HIGH", 38),
                   event("Patient Voice Report", "Reported in Hindi: fatigue and swelling in both feet since 3 days.", "MEDIUM", 142),
                   event("Data Ingest", "Discharge Summary processed by Intake AI: 4 diagnoses, 5 medications, 3 vitals extracted.", "INFO", 2950)],
    },
    {
        "id": "P-00399", "name": "Saraswathi Krishnan", "age": 72, "sex": "Female", "dob": "04 Aug 1954",
        "doctor": "Dr. Vedanth", "ward": "Cardiology", "adherenceScore": 78,
        "adherenceCalendar": [True, True, False, True, True, True, False],
        "diagnosis": ["Heart Failure with reduced Ejection Fraction, EF 32% (I50.22)",
                      "Chronic Kidney Disease, stage 3b (N18.32)",
                      "Type 2 Diabetes Mellitus (E11.9)"],
        "medications": [med("Sacubitril/Valsartan", "49/51 mg", "Twice daily", "purple", "Oval", "NVR LZ"),
                        med("Furosemide", "40 mg", "Once daily", "white", "Round", "F 40"),
                        med("Bisoprolol", "5 mg", "Once daily", "yellow", "Heart", "B 5"),
                        med("Spironolactone", "25 mg", "Once daily", "orange", "Round", "SY 25"),
                        med("Linagliptin", "5 mg", "Once daily", "red", "Round", "D5")],
        "labs": {"BNP": series(320, 880, noise=40, decimals=0, seed=11, shape="late"),
                 "Creatinine": series(1.4, 2.2, noise=0.06, decimals=2, seed=12, shape="late"),
                 "eGFR": series(40, 24, noise=2, decimals=0, seed=13, shape="late"),
                 "Potassium": series(4.4, 5.6, noise=0.1, decimals=1, seed=14, shape="late"),
                 "BP_Systolic": series(138, 112, noise=6, decimals=0, seed=15),
                 "HeartRate": series(76, 92, noise=4, decimals=0, seed=16, shape="late"),
                 "HbA1c": series(7.4, 7.0, noise=0.15, seed=17)},
        "consultBrief": "Signs of decompensation: BNP 880 pg/mL, weight gain 2.1 kg in 3 days, K+ 5.6 on "
                        "Spironolactone + ARNI. Consider diuretic up-titration and potassium review today.",
        "events": [event("Weight Gain Alert", "Home scale: +2.1 kg in 3 days. Possible fluid overload.", "HIGH", 22),
                   event("Data Ingest", "Echocardiogram report processed by Intake AI: EF 32%, moderate MR, 2 diagnoses confirmed.", "INFO", 1460)],
    },
    {
        "id": "P-00805", "name": "Venkatesh Rao", "age": 69, "sex": "Male", "dob": "19 Jan 1957",
        "doctor": "Dr. Vedanth", "ward": "Cardiology", "adherenceScore": 72,
        "adherenceCalendar": [True, True, True, False, False, True, True],
        "diagnosis": ["Coronary Artery Disease, post-PCI to LAD (I25.10)",
                      "Essential Hypertension (I10)", "Mixed Hyperlipidaemia (E78.2)"],
        "medications": [med("Aspirin", "75 mg", "Once daily", "white", "Round", "75"),
                        med("Clopidogrel", "75 mg", "Once daily", "pink", "Round", "C 75"),
                        med("Atorvastatin", "80 mg", "At bedtime", "white", "Oval", "A 80"),
                        med("Metoprolol Succinate", "50 mg", "Once daily", "white", "Round", "M 50"),
                        med("Ramipril", "5 mg", "Once daily", "red", "Capsule", "R 5")],
        "labs": {"LDL": series(142, 78, noise=6, decimals=0, seed=21, shape="early"),
                 "BP_Systolic": series(146, 126, noise=5, decimals=0, seed=22, shape="early"),
                 "HeartRate": series(78, 64, noise=3, decimals=0, seed=23),
                 "Creatinine": series(1.0, 1.1, noise=0.05, decimals=2, seed=24)},
        "consultBrief": "LDL at target on high-intensity statin. Dual antiplatelet therapy interrupted for 2 days, "
                        "high stent thrombosis risk within 12 months of PCI: counsel urgently.",
        "events": [event("Pill Mismatch", "PillGuard: Clopidogrel not confirmed for 2 consecutive days post-PCI.", "HIGH", 75)],
    },
    {
        "id": "P-00523", "name": "Lakshmi Narayanan", "age": 67, "sex": "Female", "dob": "23 Nov 1958",
        "doctor": "Dr. Vedanth", "ward": "Pulmonology", "adherenceScore": 82,
        "adherenceCalendar": [True, True, True, True, False, True, True],
        "diagnosis": ["Chronic Obstructive Pulmonary Disease, GOLD 3 (J44.1)", "Essential Hypertension (I10)"],
        "medications": [med("Tiotropium", "18 mcg", "Once daily", "green", "Capsule", "TI 01"),
                        med("Budesonide/Formoterol", "200/6 mcg", "Twice daily", "red", "Inhaler", "-"),
                        med("Losartan", "50 mg", "Once daily", "white", "Oval", "L 50")],
        "labs": {"FEV1": series(54, 44, noise=2, decimals=0, seed=31, spike_at=14, spike=-6),
                 "SpO2": series(95, 91, noise=0.8, decimals=0, seed=32),
                 "BP_Systolic": series(132, 138, noise=5, decimals=0, seed=33),
                 "HeartRate": series(82, 94, noise=3, decimals=0, seed=34)},
        "consultBrief": "Progressive airflow limitation (FEV1 44% predicted), resting SpO2 91%. One exacerbation "
                        "this year. Assess for pulmonary rehab and long-term oxygen.",
        "events": [event("Patient Voice Report", "Reported in Tamil: breathlessness while climbing stairs, worse at night.", "MEDIUM", 262)],
    },
    {
        "id": "P-00912", "name": "Fatima Sheikh", "age": 54, "sex": "Female", "dob": "07 Jun 1972",
        "doctor": "Dr. Vedanth", "ward": "Gastroenterology", "adherenceScore": 85,
        "adherenceCalendar": [True, True, True, True, True, False, True],
        "diagnosis": ["Non-alcoholic Fatty Liver Disease (K76.0)", "Type 2 Diabetes Mellitus (E11.9)", "Obesity, BMI 33 (E66.9)"],
        "medications": [med("Metformin", "1000 mg", "Twice daily", "white", "Oblong", "G 1000"),
                        med("Semaglutide", "0.5 mg", "Weekly", "blue", "Injection", "-"),
                        med("Vitamin E", "400 IU", "Once daily", "yellow", "Capsule", "-")],
        "labs": {"ALT": series(92, 118, noise=8, decimals=0, seed=41),
                 "AST": series(64, 81, noise=6, decimals=0, seed=42),
                 "HbA1c": series(8.1, 7.4, noise=0.15, seed=43, shape="early"),
                 "Glucose": series(168, 150, noise=10, decimals=0, seed=44)},
        "consultBrief": "Transaminases rising despite improving glycaemia. Fibroscan due to stage fibrosis; "
                        "continue GLP-1 RA and weight-loss programme.",
        "events": [event("Follow-up Due", "Fibroscan (liver stiffness) overdue by 3 weeks.", "LOW", 3100)],
    },
    {
        "id": "P-00284", "name": "Kavitha Rajan", "age": 46, "sex": "Female", "dob": "15 Sep 1980",
        "doctor": "Dr. Vedanth", "ward": "Rheumatology", "adherenceScore": 91,
        "adherenceCalendar": [True, True, True, True, True, True, True],
        "diagnosis": ["Rheumatoid Arthritis, seropositive (M05.79)", "Iron-deficiency Anaemia (D50.9)"],
        "medications": [med("Methotrexate", "15 mg", "Weekly", "yellow", "Round", "M 2.5"),
                        med("Folic Acid", "5 mg", "Weekly", "yellow", "Round", "F 5"),
                        med("Hydroxychloroquine", "200 mg", "Twice daily", "white", "Oval", "HCQ 200"),
                        med("Ferrous Sulfate", "200 mg", "Once daily", "red", "Round", "FS")],
        "labs": {"ESR": series(48, 18, noise=3, decimals=0, seed=51, shape="early"),
                 "CRP": series(24, 6, noise=1.5, decimals=1, seed=52, shape="early"),
                 "Hemoglobin": series(9.4, 11.6, noise=0.2, decimals=1, seed=53),
                 "ALT": series(28, 44, noise=4, decimals=0, seed=54)},
        "consultBrief": "Disease activity well controlled on Methotrexate (ESR 18). Haemoglobin recovering. "
                        "Monitor liver enzymes on Methotrexate.",
        "events": [event("Lab Due", "Methotrexate monitoring: LFT + CBC due this week.", "INFO", 1500),
                   event("Data Ingest", "Lab Report processed by Intake AI: ESR, CRP, haemoglobin and ALT extracted.", "INFO", 8650)],
    },
    {
        "id": "P-00611", "name": "Rohit Sharma", "age": 31, "sex": "Male", "dob": "02 Feb 1995",
        "doctor": "Dr. Vedanth", "ward": "Endocrinology", "adherenceScore": 88,
        "adherenceCalendar": [True, True, True, True, True, True, False],
        "diagnosis": ["Type 1 Diabetes Mellitus (E10.9)"],
        "medications": [med("Insulin Glargine", "22 units", "At bedtime", "purple", "Injection", "-"),
                        med("Insulin Aspart", "6 units", "Three times daily", "orange", "Injection", "-")],
        "labs": {"HbA1c": series(8.6, 7.2, noise=0.2, seed=61, shape="early"),
                 "Glucose": series(214, 152, noise=14, decimals=0, seed=62, shape="early")},
        "consultBrief": "Improving control after switch to basal-bolus regimen. Nocturnal hypoglycaemia overnight: "
                        "consider reducing Glargine by 10%.",
        "events": [event("Hypoglycaemia Event", "CGM: glucose 58 mg/dL at 03:10, self-treated.", "MEDIUM", 420)],
    },
    {
        "id": "P-00417", "name": "Mohammed Irfan", "age": 41, "sex": "Male", "dob": "28 Apr 1985",
        "doctor": "Dr. Vedanth", "ward": "Cardiology OPD", "adherenceScore": 94,
        "adherenceCalendar": [True, True, True, True, True, True, True],
        "diagnosis": ["Essential Hypertension (I10)", "Dyslipidaemia (E78.5)"],
        "medications": [med("Amlodipine", "5 mg", "Once daily", "white", "Round", "AML 5"),
                        med("Rosuvastatin", "10 mg", "Once daily", "pink", "Round", "R 10")],
        "labs": {"BP_Systolic": series(154, 126, noise=4, decimals=0, seed=71, shape="early"),
                 "LDL": series(168, 92, noise=6, decimals=0, seed=72, shape="early"),
                 "HeartRate": series(84, 72, noise=3, decimals=0, seed=73)},
        "consultBrief": "BP and LDL both at target. Routine 6-monthly review; continue current regimen.",
        "events": [],
    },
    {
        "id": "P-00738", "name": "Ananya Iyer", "age": 29, "sex": "Female", "dob": "11 Dec 1996",
        "doctor": "Dr. Vedanth", "ward": "Endocrinology OPD", "adherenceScore": 96,
        "adherenceCalendar": [True, True, True, True, True, True, True],
        "diagnosis": ["Primary Hypothyroidism (E03.9)", "Polycystic Ovary Syndrome (E28.2)"],
        "medications": [med("Levothyroxine", "75 mcg", "Once daily", "blue", "Round", "T 75"),
                        med("Metformin", "500 mg", "Twice daily", "white", "Round", "G 500")],
        "labs": {"TSH": series(9.8, 2.6, noise=0.4, decimals=1, seed=81, shape="early"),
                 "Hemoglobin": series(11.6, 12.7, noise=0.2, decimals=1, seed=82),
                 "Glucose": series(118, 102, noise=5, decimals=0, seed=83)},
        "consultBrief": "Euthyroid on current Levothyroxine dose. Stable; annual review.",
        "events": [],
    },
]

PILL_EVENTS = [
    {"id": 1, "status": "confirmed", "drug": "Metformin 1000 mg", "time": "08:02 AM", "patient": "Arjun Mehta"},
    {"id": 2, "status": "confirmed", "drug": "Sacubitril/Valsartan", "time": "08:15 AM", "patient": "Saraswathi Krishnan"},
    {"id": 3, "status": "wrong", "drug": "Aspirin 75 mg", "time": "08:31 AM", "expected": "Clopidogrel 75 mg", "patient": "Venkatesh Rao"},
    {"id": 4, "status": "confirmed", "drug": "Levothyroxine 75 mcg", "time": "07:10 AM", "patient": "Ananya Iyer"},
    {"id": 5, "status": "unconfirmed", "drug": "Apixaban 5 mg", "time": "09:00 PM", "patient": "Arjun Mehta"},
    {"id": 6, "status": "confirmed", "drug": "Tiotropium 18 mcg", "time": "09:05 AM", "patient": "Lakshmi Narayanan"},
]

INTERACTIONS = [
    {"drug_a": "Spironolactone", "drug_b": "Sacubitril/Valsartan", "severity": "high",
     "desc": "Additive hyperkalaemia risk; current K+ 5.6 mmol/L. Review dose."},
    {"drug_a": "Aspirin", "drug_b": "Clopidogrel", "severity": "medium",
     "desc": "Intended dual antiplatelet therapy; increased bleeding risk. Monitor for GI bleeding."},
    {"drug_a": "Apixaban", "drug_b": "Aspirin", "severity": "high",
     "desc": "Major bleeding risk if combined; avoid unless specifically indicated."},
    {"drug_a": "Metformin", "drug_b": "Empagliflozin", "severity": "low",
     "desc": "Complementary glucose lowering; monitor hydration and renal function."},
    {"drug_a": "Methotrexate", "drug_b": "Folic Acid", "severity": "none",
     "desc": "Beneficial: folic acid reduces methotrexate toxicity."},
    {"drug_a": "Telmisartan", "drug_b": "Empagliflozin", "severity": "low",
     "desc": "Additive BP lowering; watch for orthostatic hypotension and eGFR dip."},
]

CACHE_TABLES = ["forecast_cache", "comorbidity_web_cache", "organ_assessments", "alert_explanations", "second_opinions"]
CACHE_PREFIXES = ("FORECAST#", "COMORBIDITY#", "ORGAN#", "ALERT_EXPLAIN", "SECOND_OPINION#")


def build_patients() -> list:
    from services.clinical import enrich
    out = []
    for p in PATIENTS:
        p = json.loads(json.dumps(p))
        p["demo"] = True
        p["clinicalPatterns"] = p.pop("events")
        out.append(enrich(p))
    return out


def write_local(patients):
    with open(os.path.join(ROOT_DIR, "database.json"), "w") as f:
        json.dump({"patients": patients, "pill_events": PILL_EVENTS, "interactions": INTERACTIONS}, f, indent=2)
    db = os.path.join(ROOT_DIR, "cliniq.db")
    if os.path.exists(db):
        conn = sqlite3.connect(db)
        for t in CACHE_TABLES:
            conn.execute(f"DELETE FROM {t}")
        conn.commit()
        conn.close()
    print(f"local: wrote {len(patients)} patients, cleared AI caches")


def write_dynamodb(patients):
    from services.store import DynamoStore
    store = DynamoStore()
    ddb, table = store.ddb, store.table
    # Remove previous patients and AI caches so nothing references the old cohort
    stale, kwargs = [], {"TableName": table, "ProjectionExpression": "pk, sk"}
    while True:
        res = ddb.scan(**kwargs)
        stale += [i for i in res["Items"] if i["pk"]["S"] == "PATIENT" or i["pk"]["S"].startswith(CACHE_PREFIXES)]
        if "LastEvaluatedKey" not in res:
            break
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]
    for i in range(0, len(stale), 25):
        ddb.batch_write_item(RequestItems={table: [{"DeleteRequest": {"Key": k}} for k in stale[i:i + 25]]})
    for p in patients:
        ddb.put_item(TableName=table, Item={"pk": {"S": "PATIENT"}, "sk": {"S": p["id"]}, "data": {"S": json.dumps(p)}})
    store.put_meta("PILL_EVENTS", PILL_EVENTS)
    store.put_meta("INTERACTIONS", INTERACTIONS)
    print(f"dynamodb: removed {len(stale)} stale items, wrote {len(patients)} patients")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["local", "dynamodb"], default="local")
    args = ap.parse_args()
    if args.target == "dynamodb":
        os.environ["STORAGE_BACKEND"] = "dynamodb"
    cohort = build_patients()
    for p in sorted(cohort, key=lambda x: -x["riskScore"]):
        print(f"  {p['id']}  {p['name']:<20} risk {p['riskScore']:>2}  flags {p['bodyFlags']}  alerts {len(p['clinicalPatterns'])}")
    (write_dynamodb if args.target == "dynamodb" else write_local)(cohort)
