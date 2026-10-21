# ClinIQ+ Website: What It Is and How It Works

**Live site:** https://dcngngptdqg14.cloudfront.net

## What is ClinIQ+?

ClinIQ+ is an **AI assistant for doctors** (a "Clinical Decision Support System"). It helps a doctor:

1. **See which patients need attention first**, using risk scores and alerts
2. **Avoid medication mistakes**, with pill checks and drug-interaction warnings
3. **Understand patients in their own language**, through voice in Hindi, Tamil and more
4. **Save time on paperwork**, because the AI reads medical documents automatically

**Important design rule:** safety-critical numbers (risk scores, lab alerts) are **calculated from real lab values by fixed rules**. The AI explains and summarises, but it never makes up the numbers.

---

## The pages (left sidebar)

### 1. Dashboard
The doctor's home screen.
- **Greeting** that follows the time of day ("Good afternoon, Dr. Vedanth")
- **Patients card:** total, critical and stable counts
- **Risk summary:** average, highest and lowest risk scores
- **Alerts (24 h):** real counts of critical alerts, warnings and info alerts, plus the latest alert
- **Patient list**, sorted **sickest first**
- **Visit details** for the selected patient: diagnoses, observation, prescription
- **Calendar:** today's real date and schedule (ward rounds, consults, telehealth); the doctor can add events, which are saved to the database
- **Bell icon:** live notifications; clicking one opens that patient

### 2. Patients (registry and patient page)
A list of all patients. Opening a patient shows:
- **Pre-consult brief:** key findings, red flags and suggested tests, built from the patient's alerts
- **Lab trend charts:** 24 months of results (HbA1c, creatinine, BP and others)
- **3D body map:** organs with problems are highlighted; clicking an organ runs an **AI organ assessment** with a risk score
- **Clinical pattern feed:** alerts such as *"eGFR 44 mL/min, falling from 56 over 6 readings · 1 h ago"*
- **Medications panel**
- **AI Opinion:** type a diagnosis idea (e.g. "acute heart failure"); the AI checks it against the record and returns a **verdict, confidence %, supporting evidence and gaps**
- **Ask the AI:** questions in plain English, such as "Why is this patient high risk?"
- **Trajectory preview:** a what-if simulator with treatment options suited to this patient
- **Trial matcher:** finds clinical trials the patient may qualify for
- **Download PDF** case summary
- **Patient voice mode:** the patient speaks in their language and the app replies aloud

### 3. Forecasts
- A **12-month AI prediction** of how each condition may progress, with confidence ranges
- **Key drivers** (which lab values matter most) and **milestones** (likely future events)
- **What-if simulator:** switch treatments on and off and watch the risk curve drop

### 4. Comorbidity Web
An interactive **graph of how a patient's diseases affect each other** (for example, diabetes worsening kidney disease), with the medical reason for each link.

### 5. Analytics
- **Patient cards** with mini lab charts
- **Cohort benchmarks:** how each value compares with the median and 90th percentile of all patients
- **Biomarker heatmap:** which lab values are most abnormal for each disease group
- **Anomaly history:** a monthly "how abnormal" score for a selected patient; click a red point to see the reason

### 6. Alerts
All alerts from all patients in one place: filter by severity, sort by urgency, mark as acknowledged, and ask the AI to **explain any alert** in simple words.

### 7. AI Intake
1. Upload a **discharge summary, lab report or photo**
2. The AI extracts **name, age, sex, diagnoses, medicines, vitals, follow-up date** (in about 4 seconds)
3. The doctor reviews and approves
4. The data is **added** to the patient's record (it never wipes old history), and the risk score updates automatically

The page also shows a **history of documents processed**.

### 8. PillGuard
- **Pill scanner:** photograph the front and back of a tablet; the AI identifies it (name, use, dosage, side effects)
- **Adherence calendar:** which days doses were taken or missed
- **Medication alert feed:** confirmed, wrong or missed doses
- **Missed-dose impact:** the AI explains what missing a particular medicine means for this patient

### 9. Trial Matches
Searches **ClinicalTrials.gov** and uses the AI to rate which trials the patient is likely eligible for.

---

## Voice features

| Feature | What happens |
|---|---|
| **Voice commands** | The doctor says "open PillGuard", and the app navigates there |
| **Consultation scribe** | Records the doctor-patient conversation and produces structured notes (complaint, symptoms, medicines, follow-up) |
| **Patient symptom report** | The patient speaks in Hindi, Tamil or another language; it is transcribed, translated, structured and given a severity score. Severity 7 or higher alerts the doctor |
| **Spoken replies** | Replies are read aloud in a natural Indian voice (Amazon Polly) |

---

## The demo patients

There are 9 realistic patients with 2 years of lab history ending this month. The main ones:

| Patient | Condition | Why they're interesting |
|---|---|---|
| **Arjun Mehta** (58) | Diabetes, kidney disease, AF | Rising HbA1c, falling kidney function, missed blood-thinner doses |
| **Saraswathi Krishnan** (72) | Heart failure, kidney disease | Signs of fluid overload, high potassium, a dangerous drug interaction |
| **Venkatesh Rao** (69) | Heart stent patient | Stopped his blood thinner, so high stent-clot risk |
| **Lakshmi Narayanan** (67) | COPD | Breathing getting worse; voice report in Tamil |
| **Fatima Sheikh** (54) | Fatty liver, diabetes | Rising liver enzymes |
| Rohit, Kavitha, Mohammed, Ananya | Type 1 diabetes, RA, hypertension, thyroid | Mostly stable, for contrast |

**Note:** the live site currently has only 3 of these 9 patients, because 7 were deleted through the website earlier. They can be restored with one command before the demo.

---

## The technology behind it

| Part | Technology |
|---|---|
| Frontend | React 19, Vite, TailwindCSS, Zustand, Recharts, D3.js, Three.js, Capacitor (Android app) |
| Backend | Python FastAPI |
| Main AI | **Groq**: GPT-OSS (reasoning), Qwen-VL (reading images), Whisper (speech-to-text) |
| Backup AI | **OpenRouter** (Llama 3.1 8B), then **Amazon Bedrock** (Nova) |
| Cloud | **AWS**: CloudFront, S3, Lambda, DynamoDB, SSM, Polly, SNS, Bedrock, CloudWatch (see `AWS_Services_Explained.md`) |

---

## Suggested 3-minute demo path

1. **Dashboard:** show the critical alerts and the sickest-first list
2. Open **Saraswathi Krishnan:** body map → click **Heart** → AI organ assessment
3. **AI Opinion:** type "Acute decompensated heart failure" → verdict and evidence
4. **Forecasts:** turn on an intervention and watch the risk drop
5. **AI Intake:** upload a discharge summary and see it read in about 4 seconds
6. **PillGuard:** scan a tablet photo
7. Finish on the **AWS architecture** slide

**Tip:** open the site once about 5 minutes before presenting, so the first load (about 6 seconds) is already done.
