"""
Pre-generates the AI views (forecast, comorbidity web, organ assessments) for every patient,
so the live demo opens instantly. Results are cached for 24 h (DynamoDB TTL).

Paced for Groq's free tier (~8k tokens/minute per model).

Usage:  .venv/bin/python scripts/warm_demo.py https://<your-cloudfront-domain>
"""
import json
import sys
import time

import httpx

ORGANS = {"Heart": "heart", "Kidney": "kidney", "Lungs": "lungs", "Liver": "liver", "Brain": "brain"}


def stream(client, path, body):
    text = ""
    with client.stream("POST", path, json=body, timeout=150) as r:
        for line in r.iter_lines():
            if line.startswith("data: ") and line != "data: [DONE]":
                try:
                    text += json.loads(line[6:])
                except json.JSONDecodeError:
                    text += line[6:]
    return text


def ok_json(text):
    try:
        json.loads(text)
        return True
    except json.JSONDecodeError:
        return False


def main(base):
    client = httpx.Client(base_url=base.rstrip("/"))
    patients = sorted(client.get("/api/patients", timeout=60).json(), key=lambda p: -p["riskScore"])
    print(f"Warming {len(patients)} patients on {base}")
    for p in patients:
        for name, path, body, check in [
            ("forecast", "/api/forecast/trajectory", {"patient_id": p["id"]}, ok_json),
            ("comorbidity", "/api/comorbidity/web", {"patient_id": p["id"]}, ok_json),
        ] + [(f"organ:{o}", f"/api/patient/{p['id']}/organ-assessment", {"organ": ORGANS[o]},
              lambda t: t.startswith("[RISK"))
             for o in p.get("bodyFlags", []) if o in ORGANS]:
            for attempt in range(3):
                start = time.time()
                try:
                    out = stream(client, path, body)
                except httpx.HTTPError as e:
                    out = f"error {e}"
                good = check(out)
                print(f"  {p['name']:<20} {name:<14} {'ok' if good else 'retry'}  {time.time() - start:4.1f}s")
                if good:
                    break
                time.sleep(20)
            time.sleep(8)  # stay under the per-minute token budget


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000")
