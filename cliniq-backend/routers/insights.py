"""Dashboard, analytics and calendar endpoints: all computed from stored patient data."""
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import clinical
from services.store import store

router = APIRouter(prefix="/api", tags=["insights"])

USER_EVENTS = "CALENDAR_EVENTS"


class CalendarEvent(BaseModel):
    time: str
    title: str
    description: str = ""
    type: str = "consult"
    date: str


def _today() -> date:
    return datetime.now(clinical.IST).date()


@router.get("/dashboard/summary")
def dashboard_summary():
    patients = store.list_patients()
    now = datetime.now(timezone.utc)
    recent = [
        (p, a) for p in patients for a in p.get("clinicalPatterns", [])
        if a.get("timestamp") and now - datetime.fromisoformat(a["timestamp"]) <= timedelta(hours=24)
    ]
    by_sev = {s: sum(1 for _, a in recent if a.get("severity") == s) for s in ("HIGH", "MEDIUM", "LOW", "INFO")}
    latest = max(recent, key=lambda pa: pa[1]["timestamp"], default=None)
    events = _events_for(_today(), 1, patients)
    upcoming = sorted((e for e in events if e["time"] >= datetime.now(clinical.IST).strftime("%H:%M")),
                      key=lambda e: e["time"])
    return {
        "alerts_24h": len(recent),
        "alerts_by_severity": by_sev,
        "latest_alert": {"patient": latest[0]["name"], "patient_id": latest[0]["id"], **latest[1]} if latest else None,
        "events_today": len(events),
        "next_event": upcoming[0] if upcoming else None,
        "server_time": now.isoformat(),
    }


@router.get("/analytics/cohort")
def cohort():
    return clinical.cohort_analytics(store.list_patients())


@router.get("/analytics/anomaly/{patient_id}")
def anomaly(patient_id: str):
    patient = store.get_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return {"patient_id": patient_id, "name": patient["name"], "timeline": clinical.anomaly_timeline(patient)}


def _events_for(start: date, days: int, patients: list | None = None) -> list:
    patients = patients if patients is not None else store.list_patients()
    stored = store.get_meta(USER_EVENTS, []) or []
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        out += clinical.schedule_for(d, patients)
        out += [e for e in stored if e.get("date") == d.isoformat()]
    return out


@router.get("/calendar/events")
def calendar_events(start: str | None = None, days: int = 42):
    begin = date.fromisoformat(start) if start else _today() - timedelta(days=_today().day + 6)
    return {"today": _today().isoformat(), "events": _events_for(begin, min(max(days, 1), 120))}


@router.post("/calendar/events")
def add_calendar_event(event: CalendarEvent):
    stored = store.get_meta(USER_EVENTS, []) or []
    new = {**event.model_dump(), "id": f"evt-{uuid.uuid4().hex[:8]}"}
    store.put_meta(USER_EVENTS, (stored + [new])[-200:])
    return new
