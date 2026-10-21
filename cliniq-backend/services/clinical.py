"""
Deterministic clinical engine: everything the dashboard shows is derived from lab data here,
never typed into the UI.

  enrich(patient)          -> riskScore, bodyFlags, lab-driven alerts (run on every write)
  present(patient)         -> relative times ("12 min ago"), lab month labels ending this month
  cohort_analytics(...)    -> diagnosis x biomarker matrix, cohort percentiles
  anomaly_timeline(...)    -> per-patient monthly deviation score with explanations
  schedule_for(...)        -> the physician's day, built from the real patient list
"""
import hashlib
import math
import statistics
from datetime import date, datetime, timedelta, timezone

# lab: (unit, normal_low, normal_high, critical_low, critical_high, organ on the body map)
REFERENCE = {
    "HbA1c":       ("%",      4.0,  5.6,  None, 11.0, None),
    "Glucose":     ("mg/dL", 70,   140,   45,   350,  None),
    "Creatinine":  ("mg/dL",  0.6,  1.2,  None,  4.0, "kidney"),
    "eGFR":        ("mL/min", 90,  None,  15,   None, "kidney"),
    "Potassium":   ("mmol/L", 3.5,  5.0,  2.8,   6.5, "kidney"),
    "BP_Systolic": ("mmHg",  90,   130,   75,   190,  "heart"),
    "HeartRate":   ("bpm",   60,   100,   40,   150,  "heart"),
    "BNP":         ("pg/mL", None, 100,  None, 1500,  "heart"),
    "LDL":         ("mg/dL", None, 100,  None,  220,  "heart"),
    "FEV1":        ("% pred", 80,  None,  30,   None, "lungs"),
    "SpO2":        ("%",     95,   100,   85,   None, "lungs"),
    "ESR":         ("mm/hr", None,  20,  None,  100,  None),
    "CRP":         ("mg/L",  None,   5,  None,  100,  None),
    "Hemoglobin":  ("g/dL",  12.0, 17.0,  7.0,  20.0, None),
    "TSH":         ("mIU/L",  0.4,  4.5,  0.05, 20.0, "brain"),
    "ALT":         ("U/L",   7,     56,  None,  300,  "liver"),
    "AST":         ("U/L",   10,    40,  None,  300,  "liver"),
}

SEVERITY_ORDER = {"HIGH": 3, "MEDIUM": 2, "LOW": 1, "INFO": 0}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def deviation(lab: str, value) -> float:
    """0 = inside the reference range, 1 = at or beyond the critical threshold."""
    ref = REFERENCE.get(lab)
    if ref is None or value is None:
        return 0.0
    _, low, high, crit_low, crit_high, _ = ref
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.0
    if high is not None and v > high:
        span = (crit_high - high) if crit_high else high
        return min(1.0, (v - high) / span)
    if low is not None and v < low:
        span = (low - crit_low) if crit_low is not None else low
        return min(1.0, (low - v) / span)
    return 0.0


def _range_text(lab: str) -> str:
    unit, low, high, *_ = REFERENCE[lab]
    if low is not None and high is not None:
        return f"{low}–{high} {unit}"
    return f"< {high} {unit}" if high is not None else f"> {low} {unit}"


def _stable_offset(*parts, lo: int, hi: int) -> int:
    """Deterministic pseudo-random minutes, so alert times don't jump on every refresh."""
    h = int(hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest(), 16)
    return lo + h % (hi - lo)


def _lab_alerts(patient: dict) -> list:
    alerts = []
    for lab, series in (patient.get("labs") or {}).items():
        if lab not in REFERENCE or not series:
            continue
        latest = series[-1]["val"]
        d = deviation(lab, latest)
        unit = REFERENCE[lab][0]
        past = series[-7]["val"] if len(series) >= 7 else series[0]["val"]
        worsening = deviation(lab, latest) - deviation(lab, past)
        if d <= 0 and worsening <= 0:
            continue
        severity = "HIGH" if d >= 0.5 else "MEDIUM" if d >= 0.15 else "LOW"
        trend = ""
        if len(series) > 1 and past != latest:
            direction = "rising" if latest > past else "falling"
            trend = f", {direction} from {past} over {min(6, len(series) - 1)} readings"
        alerts.append({
            "type": "Worsening Trend" if worsening > 0.1 else "Lab Alert",
            "description": f"{lab} {latest} {unit} (ref {_range_text(lab)}){trend}.",
            "severity": severity,
            "source": "lab_engine",
            "lab": lab,
            # HIGH alerts surface as recent; lower severities further back
            "minutes_ago": _stable_offset(patient.get("id"), lab,
                                          lo={"HIGH": 4, "MEDIUM": 45, "LOW": 300}[severity],
                                          hi={"HIGH": 180, "MEDIUM": 900, "LOW": 2600}[severity]),
        })
    alerts.sort(key=lambda a: -SEVERITY_ORDER[a["severity"]])
    return alerts


def risk_score(patient: dict) -> int:
    labs = patient.get("labs") or {}
    devs = [deviation(lab, s[-1]["val"]) for lab, s in labs.items() if s]
    combined = 1.0
    for d in devs:
        combined *= (1 - 0.7 * d)
    lab_component = 100 * (1 - combined)

    trend_component = 0.0
    for lab, s in labs.items():
        if len(s) >= 4:
            trend_component += max(0.0, deviation(lab, s[-1]["val"]) - deviation(lab, s[-4]["val"])) * 10

    age = patient.get("age") or 50
    conditions = len(patient.get("diagnosis") or [])
    adherence = patient.get("adherenceScore", 85)
    # Non-lab clinical events (missed doses, weight gain, voice reports) also raise risk
    event_weight = {"HIGH": 20, "MEDIUM": 6, "LOW": 2}
    event_component = min(25, sum(event_weight.get(e.get("severity"), 0)
                                  for e in patient.get("clinicalPatterns") or [] if e.get("source") != "lab_engine"))
    score = (lab_component * 0.6 + min(trend_component, 8) + max(0, age - 45) * 0.35
             + conditions * 3 + max(0, 90 - adherence) * 0.25 + event_component)
    # Saturating curve: risk climbs steeply at first, then flattens near the top (never hits 100)
    return int(max(3, min(98, round(100 * (1 - math.exp(-score / 60))))))


def enrich(patient: dict) -> dict:
    """Recompute everything derived from labs. Called on every write."""
    patient["riskScore"] = risk_score(patient)
    flags = {REFERENCE[lab][5] for lab, s in (patient.get("labs") or {}).items()
             if lab in REFERENCE and s and REFERENCE[lab][5] and deviation(lab, s[-1]["val"]) > 0.05}
    patient["bodyFlags"] = sorted(f.capitalize() for f in flags)
    manual = [p for p in patient.get("clinicalPatterns") or [] if p.get("source") != "lab_engine"]
    patient["clinicalPatterns"] = _lab_alerts(patient) + manual
    return patient


# --- presentation ---------------------------------------------------------------------

def _relative(ts: datetime, now: datetime) -> str:
    secs = (now - ts).total_seconds()
    if secs < 90:
        return "Just now"
    if secs < 3600:
        return f"{int(secs // 60)} min ago"
    if secs < 6 * 3600:
        return f"{int(secs // 3600)} h ago"
    local = ts.astimezone(IST)
    today = now.astimezone(IST).date()
    if local.date() == today:
        return f"Today, {local:%H:%M}"
    if local.date() == today - timedelta(days=1):
        return f"Yesterday, {local:%H:%M}"
    return f"{local:%d %b}, {local:%H:%M}"


IST = timezone(timedelta(hours=5, minutes=30))


def _month_label(anchor: date, months_back: int) -> str:
    y, m = anchor.year, anchor.month - months_back
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1).strftime("%b %y")


def present(patient: dict, now: datetime | None = None) -> dict:
    """Shape a stored patient for the UI: relative alert times, demo lab months ending now."""
    now = now or _utcnow()
    p = dict(patient)
    patterns = []
    for pat in p.get("clinicalPatterns") or []:
        pat = dict(pat)
        if "minutes_ago" in pat:
            ts = now - timedelta(minutes=pat["minutes_ago"])
        elif pat.get("timestamp"):
            ts = datetime.fromisoformat(pat["timestamp"])
        else:
            patterns.append(pat)
            continue
        pat["timestamp"] = ts.isoformat()
        pat["time"] = _relative(ts, now)
        patterns.append(pat)
    patterns.sort(key=lambda x: (x.get("timestamp") or ""), reverse=True)
    p["clinicalPatterns"] = patterns

    # Demo series are stored as "N months ago", so charts always end at the current month
    if p.get("demo"):
        anchor = now.astimezone(IST).date()
        p["labs"] = {
            lab: [{**r, "date": r.get("date") if r.get("fixed") else _month_label(anchor, len(s) - 1 - i)}
                  for i, r in enumerate(s)]
            for lab, s in (p.get("labs") or {}).items()
        }
    return p


# --- analytics ------------------------------------------------------------------------

DIAGNOSIS_GROUPS = {
    "Type 2 Diabetes": ["type 2 diabetes", "t2dm", "diabetes mellitus type 2"],
    "Type 1 Diabetes": ["type 1 diabetes", "t1dm"],
    "Hypertension": ["hypertension", "htn"],
    "CKD": ["chronic kidney", "ckd", "nephropathy"],
    "Heart Failure": ["heart failure", "chf", "hfref", "hfpef"],
    "Coronary Disease": ["coronary", "myocardial", "cad", "angina"],
    "COPD / Asthma": ["copd", "asthma", "pulmonary"],
    "Rheumatoid Arthritis": ["rheumatoid"],
    "Liver Disease": ["fatty liver", "nafld", "hepat", "cirrhosis"],
    "Thyroid": ["thyroid"],
    "Anaemia": ["anaemia", "anemia"],
}


def diagnosis_groups(patient: dict) -> set:
    text = " ".join(patient.get("diagnosis") or []).lower()
    return {g for g, keys in DIAGNOSIS_GROUPS.items() if any(k in text for k in keys)}


def cohort_analytics(patients: list) -> dict:
    labs_present = sorted({lab for p in patients for lab in (p.get("labs") or {}) if lab in REFERENCE},
                          key=lambda l: -sum(1 for p in patients if l in (p.get("labs") or {})))
    cols = labs_present[:6]
    group_members = {}
    for p in patients:
        for g in diagnosis_groups(p):
            group_members.setdefault(g, []).append(p)
    rows = sorted(group_members, key=lambda g: -len(group_members[g]))[:5]

    cells = {}
    for g in rows:
        for lab in cols:
            vals = [deviation(lab, p["labs"][lab][-1]["val"]) for p in group_members[g]
                    if p.get("labs", {}).get(lab)]
            if not vals:
                cells[f"{g}-{lab}"] = {"val": 0.0, "text": f"No {lab} measurements in this group.", "n": 0}
                continue
            mean = round(statistics.mean(vals), 2)
            cells[f"{g}-{lab}"] = {
                "val": mean,
                "n": len(vals),
                "text": (f"{len(vals)} patient(s) with {g}: mean {lab} deviation {mean:.2f} from reference "
                         f"({_range_text(lab)}). " + ("Strong association in this cohort." if mean >= 0.5 else
                                                       "Moderate association." if mean >= 0.2 else
                                                       "Largely within range.")),
            }

    benchmarks = {}
    for lab in labs_present:
        vals = sorted(r["val"] for p in patients for r in (p.get("labs") or {}).get(lab, []))
        if len(vals) >= 5:
            benchmarks[lab] = {"median": round(statistics.median(vals), 2),
                               "p90": round(vals[int(0.9 * (len(vals) - 1))], 2)}
    return {"rows": rows, "cols": cols, "cells": cells, "benchmarks": benchmarks,
            "patients_analysed": len(patients)}


def anomaly_timeline(patient: dict, months: int = 24) -> list:
    labs = {lab: s for lab, s in (patient.get("labs") or {}).items() if lab in REFERENCE and len(s) >= 2}
    if not labs:
        return []
    length = min(months, max(len(s) for s in labs.values()))
    points = []
    for i in range(length):
        drivers = []
        for lab, s in labs.items():
            idx = len(s) - length + i
            if idx < 0:
                continue
            d = deviation(lab, s[idx]["val"])
            if d > 0:
                drivers.append((d, lab, s[idx]["val"], s[idx].get("date")))
        drivers.sort(reverse=True)
        score = int(round(100 * (1 - _prod(1 - 0.8 * d for d, *_ in drivers)))) if drivers else 0
        month = next((s[len(s) - length + i].get("date") for s in labs.values() if len(s) - length + i >= 0), "")
        unit = lambda l: REFERENCE[l][0]  # noqa: E731
        desc = ("; ".join(f"{lab} {val} {unit(lab)}" for _, lab, val, _ in drivers[:3]) + " outside reference."
                if drivers else "All tracked biomarkers within reference range.")
        points.append({"month": month, "score": min(score, 100), "desc": desc})
    return points


def _prod(xs):
    out = 1.0
    for x in xs:
        out *= x
    return out


# --- physician schedule -----------------------------------------------------------------

def schedule_for(day: date, patients: list) -> list:
    """A believable clinic day built from the real patient list (deterministic per date)."""
    if not patients:
        return []
    ranked = sorted(patients, key=lambda p: -p.get("riskScore", 0))
    rot = day.toordinal() % len(patients)
    rotated = patients[rot:] + patients[:rot]
    ds = day.isoformat()
    events = []
    if day.weekday() < 6:
        events.append({"time": "08:30", "title": "Ward rounds", "description": f"{ranked[0].get('ward', 'General')} ward, bed review", "type": "consult"})
        for slot, p in zip(["10:00", "10:40", "11:20"], rotated[:3]):
            events.append({"time": slot, "title": f"Consult: {p['name']}",
                           "description": f"{p['id']} · {(p.get('diagnosis') or ['Review'])[0][:40]}", "type": "consult"})
        if len(rotated) > 3:
            events.append({"time": "15:00", "title": f"Telehealth: {rotated[3]['name']}",
                           "description": "Video follow-up, medication review", "type": "video"})
    if ranked[0].get("riskScore", 0) >= 75 and day.weekday() in (0, 2, 4):
        events.append({"time": "07:45", "title": f"Urgent review: {ranked[0]['name']}",
                       "description": f"Risk score {ranked[0]['riskScore']} · escalate per protocol", "type": "emergency"})
    if day.weekday() in (1, 3):
        events.append({"time": "16:30", "title": "MDT case conference", "description": f"Complex cases: {ranked[0]['name']}, {ranked[1]['name'] if len(ranked) > 1 else ''}".rstrip(", "), "type": "consult"})
    for i, e in enumerate(events):
        e.update({"id": f"sched-{ds}-{i}", "date": ds, "generated": True})
    return events
