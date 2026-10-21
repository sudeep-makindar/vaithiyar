"""Turns the Intake AI's free-text fields into structured patient records."""
import re

PILL_COLORS = ["#1a6bff", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"]
_EMPTY = {"", "not mentioned", "none", "n/a", "na", "not available", "-", "—"}

_FREQ = [
    (r"\b(bd|bid|twice (a )?daily|twice a day|1-0-1)\b", "Twice daily"),
    (r"\b(tds|tid|thrice daily|three times (a )?day|1-1-1)\b", "Three times daily"),
    (r"\b(od|once (a )?daily|once a day|daily|1-0-0|0-0-1)\b", "Once daily"),
    (r"\b(hs|at night|at bedtime)\b", "At bedtime"),
    (r"\b(sos|prn|as needed)\b", "As needed"),
    (r"\b(weekly|once a week)\b", "Weekly"),
]


def _items(text: str) -> list[str]:
    if not text:
        return []
    parts = re.split(r"\n|;|(?:,\s*(?=\d+\.\s))|(?:^|\s)\d+\.\s", text)
    cleaned = [re.sub(r"^\s*\d+[.)]\s*", "", p).strip(" ,.-•*") for p in parts if p]
    return [p for p in cleaned if p.lower() not in _EMPTY]


_DOSE = re.compile(r"\d+(\.\d+)?\s?(mg|mcg|µg|g|ml|iu|units?)\b", re.I)


def _split_med_entries(text: str) -> list[str]:
    """Split on commas too, re-attaching fragments without a dose ("Twice Daily") to the
    medication before them."""
    entries = []
    for item in _items(text):
        for frag in (f.strip() for f in item.split(",")):
            if not frag:
                continue
            if entries and not _DOSE.search(frag):
                entries[-1] += f", {frag}"
            else:
                entries.append(frag)
    return entries


def parse_medications(text: str) -> list[dict]:
    meds = []
    for i, item in enumerate(_split_med_entries(text)):
        dose_match = _DOSE.search(item)
        name = item[:dose_match.start()].strip(" ,-:") if dose_match else re.split(r",|\(", item)[0].strip()
        freq = next((label for pat, label in _FREQ if re.search(pat, item, re.I)), "As directed")
        meds.append({
            "name": (name or item)[:40],
            "dose": dose_match.group(0) if dose_match else "As prescribed",
            "freq": freq,
            "color": PILL_COLORS[i % len(PILL_COLORS)],
            "shape": "Round",
            "markings": "-",
        })
    return meds


def parse_diagnoses(text: str) -> list[str]:
    # Split on newlines / semicolons, and on commas that are not inside parentheses
    out, depth, cur = [], 0, ""
    for ch in (text or "").replace(";", "\n"):
        depth += (ch == "(") - (ch == ")")
        if ch == "\n" or (ch == "," and depth == 0):
            out.append(cur); cur = ""
        else:
            cur += ch
    out.append(cur)
    cleaned = [re.sub(r"^\s*\d+\.\s*", "", d).strip(" ,.-•*") for d in out]
    return [d for d in cleaned if d and d.lower() not in _EMPTY]


def _num(v):
    m = re.search(r"\d+(\.\d+)?", str(v or ""))
    return float(m.group(0)) if m else None


def parse_vitals(v: dict) -> dict:
    vitals = {}
    if not isinstance(v, dict):
        return vitals
    bp = str(v.get("bp") or "")
    m = re.search(r"(\d{2,3})\s*/\s*(\d{2,3})", bp)
    if m:
        vitals["BP_Systolic"] = int(m.group(1))
    hr = _num(v.get("hr"))
    if hr:
        vitals["HeartRate"] = int(hr)
    glucose = _num(v.get("glucose"))
    if glucose:
        vitals["Glucose"] = int(glucose)
    return vitals


def parse_age_sex(data: dict) -> tuple[int | None, str]:
    age = _num((data.get("age") or {}).get("value") if isinstance(data.get("age"), dict) else data.get("age"))
    sex_raw = str((data.get("sex") or {}).get("value") if isinstance(data.get("sex"), dict) else data.get("sex") or "").lower()
    sex = "Female" if sex_raw.startswith(("f", "w")) else "Male" if sex_raw.startswith("m") else "Not recorded"
    return (int(age) if age and 0 < age < 120 else None), sex
