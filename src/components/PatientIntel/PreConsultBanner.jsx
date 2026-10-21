import React from 'react';
import { useNavigate } from 'react-router-dom';
import { T } from '../../tokens';

const PreConsultBanner = ({ patient, setCurrentView }) => {
  const navigate = useNavigate();
  if (!patient) return null;

  const riskColor = patient.riskScore > 60 ? T.red : T.green;

  // Derived from the patient's live alerts and abnormal labs
  const alerts = patient.clinicalPatterns || [];
  const labAlerts = alerts.filter(a => a.source === 'lab_engine');
  const keyFindings = [patient.consultBrief, ...labAlerts.slice(0, 2).map(a => a.description)].filter(Boolean);
  const high = alerts.filter(a => a.severity === 'HIGH');
  const redFlags = (high.length ? high : alerts.filter(a => a.severity === 'MEDIUM'))
    .slice(0, 3).map(a => a.description);
  if (!redFlags.length) redFlags.push('No red flags in recent monitoring.');
  const TESTS = {
    HbA1c: 'HbA1c (3-monthly)', Glucose: 'Fasting glucose / CGM review', Creatinine: 'Renal function + electrolytes',
    eGFR: 'Renal function + electrolytes', Potassium: 'Renal function + electrolytes', BNP: 'NT-proBNP + echocardiogram',
    LDL: 'Fasting lipid panel', FEV1: 'Spirometry', SpO2: 'Arterial blood gas', ALT: 'LFT + FibroScan', AST: 'LFT + FibroScan',
    ESR: 'ESR / CRP', CRP: 'ESR / CRP', TSH: 'Thyroid function', Hemoglobin: 'CBC + iron studies',
    BP_Systolic: '24-h ambulatory BP', HeartRate: '12-lead ECG',
  };
  const suggestedTests = [...new Set(labAlerts.map(a => TESTS[a.lab]).filter(Boolean))].slice(0, 3);
  if (!suggestedTests.length) suggestedTests.push('Routine annual blood work');
  const dxCount = patient.diagnosis?.length || 0;
  const comorbidityPairs = (dxCount * (dxCount - 1)) / 2;

  return (
    <div className="fadeIn" style={{
      background: 'linear-gradient(135deg, rgba(115, 65, 234, 0.08) 0%, rgba(255, 255, 255, 0.5) 100%)',
      border: '1px solid rgba(115, 65, 234, 0.2)',
      borderRadius: '20px',
      padding: '24px 32px',
      marginBottom: '24px',
      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3), inset 0 0 20px rgba(115, 65, 234, 0.05)'
    }}>
      {/* Top Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        {/* LEFT */}
        <div>
          <div style={{
            fontSize: '10px',
            color: T.teal,
            fontWeight: '800',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            marginBottom: '10px',
            fontFamily: T.fontMono,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div className="live-dot" style={{ width: '6px', height: '6px' }} /> AI PRE-CONSULTATION STREAM
          </div>
          <div style={{
            fontSize: '24px',
            fontWeight: '800',
            color: T.textPrimary,
            marginBottom: '6px',
            fontFamily: T.fontDisplay,
            letterSpacing: '-0.02em'
          }}>
            {patient.name} <span style={{ fontSize: '18px', fontWeight: '500', color: T.textSecondary, opacity: 0.8 }}>— {patient.consultBrief}</span>
          </div>
          <div style={{ fontSize: '11px', color: T.textSecondary, fontFamily: T.fontMono, fontWeight: '700', opacity: 0.6 }}>
            {patient.id} • {patient.age}Y • PHYSICIAN: {patient.doctor.toUpperCase()}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <button
            onClick={() => setCurrentView('intake')}
            style={{
              backgroundColor: 'rgba(115, 65, 234, 0.1)',
              color: T.teal,
              border: `1px solid ${T.teal}`,
              padding: '12px 24px',
              borderRadius: '10px',
              fontSize: '12px',
              fontWeight: '800',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              transition: 'all 0.3s ease',
              fontFamily: T.fontMono,
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
            onMouseOver={e => {
              e.target.style.background = 'rgba(115, 65, 234, 0.2)';
              e.target.style.boxShadow = '0 0 20px rgba(115, 65, 234, 0.2)';
            }}
            onMouseOut={e => {
              e.target.style.background = 'rgba(115, 65, 234, 0.1)';
              e.target.style.boxShadow = 'none';
            }}
          >
            <span>↑</span> INTEL INGESTION
          </button>

          {/* Comorbidity Interaction Score Badge */}
          <div 
            onClick={() => navigate('/comorbidity')}
            style={{ 
              textAlign: 'right', 
              cursor: 'pointer',
              background: 'rgba(168, 85, 247, 0.15)',
              border: '1px solid rgba(168, 85, 247, 0.3)',
              borderRadius: '10px',
              padding: '6px 14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              transition: 'all 0.3s'
            }}
            onMouseOver={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.25)'}
            onMouseOut={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)'}
          >
            <div style={{ fontSize: '8px', color: '#A855F7', fontWeight: '800', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: T.fontMono }}>
              COMORBIDITY
            </div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: '#A855F7', fontFamily: T.fontDisplay }}>
              {comorbidityPairs} <span style={{ fontSize: '10px', fontWeight: '500', opacity: 0.8 }}>pairs</span>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '9px', color: T.textSecondary, fontWeight: '800', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '4px', fontFamily: T.fontMono }}>
              PRECISION RISK
            </div>
            <div style={{
              fontSize: '48px',
              fontWeight: '800',
              color: riskColor,
              lineHeight: 1,
              fontFamily: T.fontDisplay,
              textShadow: `0 0 15px ${riskColor}44`
            }}>
              {patient.riskScore}<span style={{ fontSize: '20px', opacity: 0.6 }}>%</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3-Column Sub-grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '32px', borderTop: `1px solid rgba(115, 65, 234, 0.1)`, paddingTop: '20px' }}>

        {/* Col 1 */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: '800', color: T.teal, marginBottom: '12px', fontFamily: T.fontMono, textTransform: 'uppercase', letterSpacing: '0.05em' }}>KEY FINDINGS</div>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: T.textSecondary, lineHeight: 1.6, fontWeight: '500' }}>
            {keyFindings.map((f, i) => <li key={`f-${i}`} style={{ marginBottom: '4px' }}>{f}</li>)}
          </ul>
        </div>

        {/* Col 2 */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: '800', color: T.red, marginBottom: '12px', fontFamily: T.fontMono, textTransform: 'uppercase', letterSpacing: '0.05em' }}>CRITICAL ANOMALIES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {redFlags.map((rf, i) => (
              <div key={`rf-${i}`} style={{ fontSize: '13px', color: '#FCA5A5', display: 'flex', gap: '8px', fontWeight: '500' }}>
                <span style={{ color: T.red }}>⚑</span><span>{rf}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Col 3 */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: '800', color: '#34D399', marginBottom: '12px', fontFamily: T.fontMono, textTransform: 'uppercase', letterSpacing: '0.05em' }}>CLINICAL DIRECTIVES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {suggestedTests.map((st, i) => (
              <div key={`st-${i}`} style={{ fontSize: '13px', color: T.green, display: 'flex', gap: '8px', fontWeight: '500' }}>
                <span style={{ color: T.green }}>+</span><span>{st}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default PreConsultBanner;
