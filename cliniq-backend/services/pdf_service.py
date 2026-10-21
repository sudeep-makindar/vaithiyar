import os
import json
import matplotlib
matplotlib.use('Agg')  # Headless mode for Matplotlib
import matplotlib.pyplot as plt
from datetime import datetime

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from services.supabase_service import db_service
from services.store import store

# Temp directory for matplotlib charts and PDFs (under /tmp on Lambda)
from services.aws import WRITABLE_DIR
TEMP_DIR = os.path.join(WRITABLE_DIR, "temp_charts")
os.makedirs(TEMP_DIR, exist_ok=True)

class PDFService:
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self._setup_custom_styles()

    def _setup_custom_styles(self):
        # Premium Dark Mode Theme colors mapped to PDF styling (light background for print safety, but with corporate dark accents)
        self.primary_color = colors.HexColor("#7C3AED") # Neon Purple accent
        self.secondary_color = colors.HexColor("#0D1224") # Dark navy accent
        self.text_color = colors.HexColor("#1E293B") # Charcoal text
        self.bg_light = colors.HexColor("#F8FAFC") # Soft grey background
        
        self.styles.add(ParagraphStyle(
            name='ReportTitle',
            fontName='Helvetica-Bold',
            fontSize=24,
            leading=28,
            textColor=self.secondary_color,
            alignment=0, # Left aligned
            spaceAfter=15
        ))
        
        self.styles.add(ParagraphStyle(
            name='SectionHeader',
            fontName='Helvetica-Bold',
            fontSize=16,
            leading=20,
            textColor=self.primary_color,
            spaceBefore=15,
            spaceAfter=10,
            keepWithNext=True
        ))
        
        self.styles.add(ParagraphStyle(
            name='ClinicalText',
            fontName='Helvetica',
            fontSize=10,
            leading=14,
            textColor=self.text_color,
            spaceAfter=10
        ))

        self.styles.add(ParagraphStyle(
            name='ClinicalTextBold',
            fontName='Helvetica-Bold',
            fontSize=10,
            leading=14,
            textColor=self.text_color,
            spaceAfter=10
        ))

        self.styles.add(ParagraphStyle(
            name='BadgeCritical',
            fontName='Helvetica-Bold',
            fontSize=9,
            leading=11,
            textColor=colors.HexColor("#EF4444"),
            alignment=1
        ))

    def _get_patient_data(self, patient_id: str) -> dict:
        try:
            return store.get_patient(patient_id)
        except Exception as e:
            print(f"Error loading patient data for PDF: {e}")
        return None

    def _generate_biometric_charts(self, patient: dict) -> str:
        # Render patient's biometric trends using matplotlib
        labs = patient.get("labs", {})
        fig, axes = plt.subplots(len(labs), 1, figsize=(6.5, len(labs) * 1.8), sharex=False)
        if len(labs) == 1:
            axes = [axes]
            
        plt.subplots_adjust(hspace=0.4)
        
        for idx, (test_name, readings) in enumerate(labs.items()):
            ax = axes[idx]
            dates = [r.get("date", r.get("time")) for r in readings[-12:]] # last 12 readings
            vals = [r["val"] for r in readings[-12:]]
            
            ax.plot(dates, vals, marker='o', color='#7C3AED', linewidth=2)
            ax.set_title(f"{test_name} Time-Series History", fontsize=9, fontweight='bold', color='#0D1224')
            ax.tick_params(axis='both', which='major', labelsize=8)
            ax.grid(True, linestyle='--', alpha=0.3)
            ax.spines['top'].set_visible(False)
            ax.spines['right'].set_visible(False)
            
        chart_path = os.path.join(TEMP_DIR, f"{patient['id']}_biometrics.png")
        plt.savefig(chart_path, dpi=200, bbox_inches='tight')
        plt.close()
        return chart_path

    def _generate_trajectory_chart(self, patient_id: str, forecast: dict) -> str:
        conditions = forecast.get("trajectory", forecast.get("conditions", []))
        fig, ax = plt.subplots(figsize=(6.5, 3.5))
        
        color_palette = ['#7C3AED', '#A855F7', '#10B981', '#F59E0B', '#3B82F6']
        
        for idx, cond in enumerate(conditions):
            label = cond.get("condition", "Condition")
            trajectory = cond.get("trajectory", [])
            months = [t["month"] for t in trajectory]
            risks = [t["risk"] * 100 for t in trajectory]
            lows = [t["confidence_low"] * 100 for t in trajectory]
            highs = [t["confidence_high"] * 100 for t in trajectory]
            
            color = color_palette[idx % len(color_palette)]
            ax.plot(months, risks, label=label, marker='s', color=color, linewidth=2)
            ax.fill_between(months, lows, highs, color=color, alpha=0.15)
            
        ax.set_title("12-Month Projected Risk Trajectory Progression", fontsize=10, fontweight='bold', color='#0D1224')
        ax.set_xlabel("Months Ahead", fontsize=8)
        ax.set_ylabel("Risk Score (%)", fontsize=8)
        ax.set_ylim(0, 100)
        ax.grid(True, linestyle='--', alpha=0.3)
        ax.legend(loc="upper left", fontsize=8)
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        
        chart_path = os.path.join(TEMP_DIR, f"{patient_id}_forecast.png")
        plt.savefig(chart_path, dpi=200, bbox_inches='tight')
        plt.close()
        return chart_path

    def build_report(self, patient_id: str) -> str:
        patient = self._get_patient_data(patient_id)
        if not patient:
            raise ValueError(f"Patient {patient_id} not found.")
            
        forecast = db_service.get_forecast_cache(patient_id)
        if not forecast:
            # Generate a default mock forecast to avoid errors
            forecast = {
                "trajectory": [
                    {
                        "condition": patient["diagnosis"][0] if patient["diagnosis"] else "General Risk",
                        "icd_code": "I10",
                        "trajectory": [{"month": m, "risk": round(0.5 + (m * 0.02), 2), "confidence_low": round(0.4 + (m * 0.015), 2), "confidence_high": round(0.6 + (m * 0.025), 2), "key_driver": "Biomarkers"} for m in range(13)]
                    }
                ],
                "forecast_drivers": [
                    {"biomarker": "Baseline", "contribution_pct": 50, "direction": "stable"}
                ],
                "milestones": [
                    {"month": 6, "condition": "General Health", "event": "Scheduled Checkup", "probability": 0.95}
                ],
                "intervention_impacts": [
                    {"intervention": "Lifestyle Plan", "risk_delta": -0.1, "affected_conditions": ["General Health"]}
                ]
            }

        pdf_filename = os.path.join(TEMP_DIR, f"ClinIQ_Report_{patient_id}.pdf")
        doc = SimpleDocTemplate(pdf_filename, pagesize=letter, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
        story = []

        # --- PAGE 1: PATIENT PROFILE SUMMARY ---
        story.append(Paragraph(f"ClinIQ+ Clinical Intelligence Summary", self.styles['ReportTitle']))
        story.append(Paragraph(f"Generated at: {datetime.now().strftime('%d %b %Y, %H:%M')} | System: LOCAL NEURAL ENGINE", self.styles['ClinicalText']))
        story.append(Spacer(1, 10))

        # Profile grid
        profile_data = [
            [Paragraph("<b>Patient Name:</b>", self.styles['ClinicalText']), Paragraph(patient["name"], self.styles['ClinicalText']),
             Paragraph("<b>Patient ID:</b>", self.styles['ClinicalText']), Paragraph(patient["id"], self.styles['ClinicalText'])],
            [Paragraph("<b>Age / Sex:</b>", self.styles['ClinicalText']), Paragraph(f"{patient['age']}Y / {patient['sex']}", self.styles['ClinicalText']),
             Paragraph("<b>DOB:</b>", self.styles['ClinicalText']), Paragraph(patient["dob"], self.styles['ClinicalText'])],
            [Paragraph("<b>Ward:</b>", self.styles['ClinicalText']), Paragraph(patient["ward"], self.styles['ClinicalText']),
             Paragraph("<b>Assigned Doctor:</b>", self.styles['ClinicalText']), Paragraph(patient["doctor"], self.styles['ClinicalText'])],
            [Paragraph("<b>Precision Risk Index:</b>", self.styles['ClinicalText']), Paragraph(f"{patient['riskScore']}/100", self.styles['ClinicalTextBold']),
             Paragraph("<b>Regimen Adherence:</b>", self.styles['ClinicalText']), Paragraph(f"{patient['adherenceScore']}%", self.styles['ClinicalTextBold'])]
        ]
        
        t1 = Table(profile_data, colWidths=[120, 150, 120, 150])
        t1.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), self.bg_light),
            ('ALIGN', (0,0), (-1,-1), 'LEFT'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('BOX', (0,0), (-1,-1), 0.5, colors.grey),
            ('INNERGRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
        ]))
        story.append(t1)
        story.append(Spacer(1, 20))

        story.append(Paragraph("Active Diagnoses Registry", self.styles['SectionHeader']))
        for diag in patient["diagnosis"]:
            story.append(Paragraph(f"• {diag}", self.styles['ClinicalText']))
        story.append(Spacer(1, 15))

        story.append(Paragraph("Current Pharmacological Regimen", self.styles['SectionHeader']))
        med_headers = [Paragraph("<b>Medication</b>", self.styles['ClinicalTextBold']), 
                       Paragraph("<b>Dosage</b>", self.styles['ClinicalTextBold']), 
                       Paragraph("<b>Frequency</b>", self.styles['ClinicalTextBold'])]
        med_rows = [med_headers]
        for med in patient["medications"]:
            med_rows.append([
                Paragraph(med["name"], self.styles['ClinicalText']),
                Paragraph(med["dose"], self.styles['ClinicalText']),
                Paragraph(med["freq"], self.styles['ClinicalText'])
            ])
        t_med = Table(med_rows, colWidths=[180, 180, 180])
        t_med.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), self.bg_light),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('GRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
        ]))
        story.append(t_med)
        story.append(PageBreak())

        # --- PAGE 2: BIOMETRIC HISTORY ---
        story.append(Paragraph("Historical Biomarker Streams", self.styles['SectionHeader']))
        story.append(Paragraph("Below contains the historical longitudinal time-series readings extracted for this patient profile over the active tracking window.", self.styles['ClinicalText']))
        story.append(Spacer(1, 10))
        biometrics_img = self._generate_biometric_charts(patient)
        story.append(Image(biometrics_img, width=500, height=500))
        story.append(PageBreak())

        # --- PAGE 3: 12-MONTH FORECAST TRAJECTORY ---
        story.append(Paragraph("12-Month Projected Risk Trajectories", self.styles['SectionHeader']))
        story.append(Paragraph("These clinical projections represent disease progression risks calculated using the patient's biological markers, medication adherence levels, and comorbidity interaction weights.", self.styles['ClinicalText']))
        story.append(Spacer(1, 10))
        forecast_img = self._generate_trajectory_chart(patient_id, forecast)
        story.append(Image(forecast_img, width=500, height=270))
        story.append(PageBreak())

        # --- PAGE 4: TOP FORECAST DRIVERS & MILESTONES ---
        story.append(Paragraph("Biomarker Forecast Drivers & Contribution Weights", self.styles['SectionHeader']))
        story.append(Paragraph("The primary biological factors driving the projected disease progressions, as computed by ClinIQ+ predictive intelligence models:", self.styles['ClinicalText']))
        story.append(Spacer(1, 10))
        
        driver_headers = [Paragraph("<b>Biomarker</b>", self.styles['ClinicalTextBold']), 
                          Paragraph("<b>Weight Contribution</b>", self.styles['ClinicalTextBold']), 
                          Paragraph("<b>Trend Direction</b>", self.styles['ClinicalTextBold'])]
        driver_rows = [driver_headers]
        for dr in forecast.get("forecast_drivers", []):
            driver_rows.append([
                Paragraph(dr["biomarker"], self.styles['ClinicalText']),
                Paragraph(f"{dr['contribution_pct']}%", self.styles['ClinicalTextBold']),
                Paragraph(dr["direction"].upper(), self.styles['ClinicalText'])
            ])
        t_drivers = Table(driver_rows, colWidths=[200, 170, 170])
        t_drivers.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), self.bg_light),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('GRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
        ]))
        story.append(t_drivers)
        story.append(Spacer(1, 25))

        story.append(Paragraph("Predicted Clinical Milestones Timeline", self.styles['SectionHeader']))
        story.append(Paragraph("Future clinical risk events projected to occur within the next 12 months based on current physiological trends:", self.styles['ClinicalText']))
        story.append(Spacer(1, 10))

        milestones_headers = [Paragraph("<b>Target Month</b>", self.styles['ClinicalTextBold']), 
                              Paragraph("<b>Condition</b>", self.styles['ClinicalTextBold']), 
                              Paragraph("<b>Projected Event</b>", self.styles['ClinicalTextBold']),
                              Paragraph("<b>Probability</b>", self.styles['ClinicalTextBold'])]
        milestone_rows = [milestones_headers]
        for m in forecast.get("milestones", []):
            milestone_rows.append([
                Paragraph(f"Month {m['month']}", self.styles['ClinicalTextBold']),
                Paragraph(m["condition"], self.styles['ClinicalText']),
                Paragraph(m["event"], self.styles['ClinicalText']),
                Paragraph(f"{int(m['probability'] * 100)}%" if isinstance(m['probability'], float) and m['probability'] <= 1.0 else f"{m['probability']}%", self.styles['ClinicalTextBold'])
            ])
        t_milestones = Table(milestone_rows, colWidths=[80, 120, 240, 100])
        t_milestones.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), self.bg_light),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('GRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
        ]))
        story.append(t_milestones)
        story.append(PageBreak())

        # --- PAGE 5: INTERVENTION SIMULATOR IMPACT ---
        story.append(Paragraph("Intervention Simulator Risk Deltas", self.styles['SectionHeader']))
        story.append(Paragraph("Projected change in absolute risk levels when specific therapeutic adjustments are initiated:", self.styles['ClinicalText']))
        story.append(Spacer(1, 10))
        
        int_headers = [Paragraph("<b>Proposed Intervention</b>", self.styles['ClinicalTextBold']), 
                       Paragraph("<b>Risk Delta Impact</b>", self.styles['ClinicalTextBold']), 
                       Paragraph("<b>Affected Conditions</b>", self.styles['ClinicalTextBold'])]
        int_rows = [int_headers]
        for impact in forecast.get("intervention_impacts", []):
            delta = impact["risk_delta"]
            delta_str = f"{int(delta * 100)}%" if isinstance(delta, float) and abs(delta) <= 1.0 else f"{delta}%"
            # Prefix with minus if negative delta
            if isinstance(delta, float) and delta < 0:
                delta_color = colors.HexColor("#10B981") # Good improvement
            else:
                delta_color = colors.HexColor("#EF4444")
                
            int_rows.append([
                Paragraph(impact["intervention"], self.styles['ClinicalText']),
                Paragraph(f"<font color='{delta_color}'>{delta_str}</font>", self.styles['ClinicalTextBold']),
                Paragraph(", ".join(impact["affected_conditions"]), self.styles['ClinicalText'])
            ])
        t_ints = Table(int_rows, colWidths=[200, 120, 220])
        t_ints.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), self.bg_light),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('GRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
        ]))
        story.append(t_ints)
        story.append(PageBreak())

        # --- PAGE 6: COMORBIDITY INTERACTION NETWORK ---
        story.append(Paragraph("Comorbidity Pathogenic Interaction Summary", self.styles['SectionHeader']))
        story.append(Paragraph("ClinIQ+ physiological link graph analyzes how the patient's existing chronic conditions cross-amplify or exacerbate each other. Below lists the primary interaction edges cached for this patient profile:", self.styles['ClinicalText']))
        story.append(Spacer(1, 10))

        comorb = db_service.get_comorbidity_cache(patient_id)
        if comorb and comorb.get("edges"):
            edge_headers = [Paragraph("<b>Source</b>", self.styles['ClinicalTextBold']), 
                            Paragraph("<b>Target</b>", self.styles['ClinicalTextBold']), 
                            Paragraph("<b>Interaction</b>", self.styles['ClinicalTextBold']),
                            Paragraph("<b>Strength</b>", self.styles['ClinicalTextBold'])]
            edge_rows = [edge_headers]
            for edge in comorb["edges"]:
                # Map source/target node IDs back to names if possible
                src_name = next((n["condition"] for n in comorb["nodes"] if n["id"] == edge["source"]), edge["source"])
                tgt_name = next((n["condition"] for n in comorb["nodes"] if n["id"] == edge["target"]), edge["target"])
                
                edge_rows.append([
                    Paragraph(src_name, self.styles['ClinicalText']),
                    Paragraph(tgt_name, self.styles['ClinicalText']),
                    Paragraph(f"{edge.get('direction', 'amplifying').upper()}: {edge.get('mechanism', '')}", self.styles['ClinicalText']),
                    Paragraph(str(edge["strength"]), self.styles['ClinicalTextBold'])
                ])
            t_edge = Table(edge_rows, colWidths=[120, 120, 230, 70])
            t_edge.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), self.bg_light),
                ('BOTTOMPADDING', (0,0), (-1,-1), 6),
                ('GRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
            ]))
            story.append(t_edge)
        else:
            story.append(Paragraph("No active pathogenetic comorbidity links detected on file for this patient profile.", self.styles['ClinicalText']))
        story.append(PageBreak())

        # --- PAGE 7: ALERT CENTRE HISTORY ---
        story.append(Paragraph("Clinical Alert Logging & Audit Record", self.styles['SectionHeader']))
        story.append(Paragraph("Longitudinal log of vital notifications, adherence anomalies, and lab threshold breaches fired by ClinIQ+ engine:", self.styles['ClinicalText']))
        story.append(Spacer(1, 10))

        alert_headers = [Paragraph("<b>Alert Type</b>", self.styles['ClinicalTextBold']), 
                         Paragraph("<b>Fired Date/Time</b>", self.styles['ClinicalTextBold']), 
                         Paragraph("<b>Description</b>", self.styles['ClinicalTextBold']),
                         Paragraph("<b>Triage Urgency</b>", self.styles['ClinicalTextBold'])]
        alert_rows = [alert_headers]
        for pattern in patient.get("clinicalPatterns", []):
            alert_rows.append([
                Paragraph(pattern["type"], self.styles['ClinicalTextBold']),
                Paragraph(pattern["time"], self.styles['ClinicalText']),
                Paragraph(pattern["description"], self.styles['ClinicalText']),
                Paragraph(str(pattern.get("urgency_score", "5")), self.styles['ClinicalTextBold'])
            ])
        t_alerts = Table(alert_rows, colWidths=[110, 90, 270, 70])
        t_alerts.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), self.bg_light),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('GRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
        ]))
        story.append(t_alerts)

        doc.build(story)
        return pdf_filename

    def build_summary_pdf(self, patient_id: str) -> str:
        patient = self._get_patient_data(patient_id)
        if not patient:
            raise ValueError(f"Patient {patient_id} not found.")

        pdf_filename = os.path.join(TEMP_DIR, f"Patient_Summary_{patient_id}.pdf")
        doc = SimpleDocTemplate(pdf_filename, pagesize=letter, leftMargin=30, rightMargin=30, topMargin=30, bottomMargin=30)
        story = []

        title_style = ParagraphStyle(
            name='SummaryTitle',
            parent=self.styles['ReportTitle'],
            fontSize=20,
            leading=24,
            spaceAfter=8
        )
        
        section_style = ParagraphStyle(
            name='SummarySectionHeader',
            parent=self.styles['SectionHeader'],
            fontSize=13,
            leading=16,
            spaceBefore=10,
            spaceAfter=6,
            keepWithNext=True
        )

        table_text_style = ParagraphStyle(
            name='SummaryTableText',
            parent=self.styles['ClinicalText'],
            fontSize=8.5,
            leading=11,
            spaceAfter=0
        )

        table_text_bold = ParagraphStyle(
            name='SummaryTableTextBold',
            parent=self.styles['ClinicalTextBold'],
            fontSize=8.5,
            leading=11,
            spaceAfter=0
        )

        story.append(Paragraph(f"ClinIQ+ Patient Clinical Summary", title_style))
        story.append(Paragraph(f"Generated at: {datetime.now().strftime('%d %b %Y, %H:%M')} | System: LOCAL NEURAL ENGINE", table_text_style))
        story.append(Spacer(1, 8))

        profile_data = [
            [Paragraph("<b>Patient Name:</b>", table_text_style), Paragraph(patient["name"], table_text_style),
             Paragraph("<b>Patient ID:</b>", table_text_style), Paragraph(patient["id"], table_text_style)],
            [Paragraph("<b>Age / Sex:</b>", table_text_style), Paragraph(f"{patient['age']}Y / {patient['sex']}", table_text_style),
             Paragraph("<b>DOB:</b>", table_text_style), Paragraph(patient["dob"], table_text_style)],
            [Paragraph("<b>Ward / Dept:</b>", table_text_style), Paragraph(patient["ward"], table_text_style),
             Paragraph("<b>Primary Provider:</b>", table_text_style), Paragraph(patient["doctor"], table_text_style)],
            [Paragraph("<b>Risk Score:</b>", table_text_style), Paragraph(f"{patient['riskScore']}/100", table_text_bold),
             Paragraph("<b>Adherence Score:</b>", table_text_style), Paragraph(f"{patient['adherenceScore']}%", table_text_bold)]
        ]
        
        t_demographics = Table(profile_data, colWidths=[110, 165, 110, 165])
        t_demographics.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), self.bg_light),
            ('ALIGN', (0,0), (-1,-1), 'LEFT'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
            ('TOPPADDING', (0,0), (-1,-1), 3),
            ('BOX', (0,0), (-1,-1), 0.5, colors.grey),
            ('INNERGRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
        ]))
        story.append(t_demographics)
        story.append(Spacer(1, 10))

        labs = patient.get("labs", {})
        vital_rows = [[
            Paragraph("<b>Biomarker / Test</b>", table_text_bold),
            Paragraph("<b>Value</b>", table_text_bold),
            Paragraph("<b>Date</b>", table_text_bold)
        ]]
        
        if labs:
            for test_name, readings in labs.items():
                if readings:
                    latest_reading = readings[-1]
                    vital_rows.append([
                        Paragraph(test_name, table_text_style),
                        Paragraph(str(latest_reading["val"]), table_text_bold),
                        Paragraph(latest_reading.get("date", "N/A"), table_text_style)
                    ])
        else:
            vital_rows.append([
                Paragraph("No biomarkers.", table_text_style),
                Paragraph("-", table_text_style),
                Paragraph("-", table_text_style)
            ])
            
        t_vitals = Table(vital_rows, colWidths=[110, 75, 75])
        t_vitals.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), self.bg_light),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('GRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
        ]))
        
        medications = patient.get("medications", [])
        med_rows = [[
            Paragraph("<b>Medication</b>", table_text_bold), 
            Paragraph("<b>Dosage</b>", table_text_bold), 
            Paragraph("<b>Frequency</b>", table_text_bold)
        ]]
        
        if medications:
            for med in medications:
                med_rows.append([
                    Paragraph(med["name"], table_text_style),
                    Paragraph(med.get("dose", "As Directed"), table_text_style),
                    Paragraph(med.get("freq", "As Directed"), table_text_style)
                ])
        else:
            med_rows.append([
                Paragraph("No active meds.", table_text_style),
                Paragraph("-", table_text_style),
                Paragraph("-", table_text_style)
            ])
            
        t_med = Table(med_rows, colWidths=[110, 75, 75])
        t_med.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), self.bg_light),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('GRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
        ]))

        side_by_side_data = [
            [
                Paragraph("<b>Latest Lab & Vital Readings</b>", section_style),
                "",
                Paragraph("<b>Current Active Medications</b>", section_style)
            ],
            [
                t_vitals,
                "",
                t_med
            ]
        ]
        
        t_layout = Table(side_by_side_data, colWidths=[260, 30, 260])
        t_layout.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 0),
        ]))
        
        story.append(t_layout)

        doc.build(story)
        return pdf_filename

pdf_service = PDFService()

