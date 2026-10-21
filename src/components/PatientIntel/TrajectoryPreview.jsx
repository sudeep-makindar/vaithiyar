import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, CartesianGrid } from 'recharts';

const TrajectoryPreview = ({ patient }) => {
  const navigate = useNavigate();
  const [activeInterventions, setActiveInterventions] = useState({});
  const [chartData, setChartData] = useState([]);
  const [primaryCondition, setPrimaryCondition] = useState('');

  // Evidence-based intervention options derived from the patient's own problem list
  const getInterventions = () => {
    const dx = (patient.diagnosis || []).join(' ').toLowerCase();
    const has = (...keys) => keys.some(k => dx.includes(k));
    const options = [];
    if (has('heart failure', 'hfref', 'chf')) options.push({ label: 'Optimise diuretic dose', delta: -0.22, cond: 'Heart Failure', details: 'Furosemide +20 mg, daily weights' });
    if (has('coronary', 'pci', 'myocardial')) options.push({ label: 'Reinforce DAPT adherence', delta: -0.2, cond: 'Coronary Disease', details: 'PillGuard reminders + counselling' });
    if (has('type 2 diabetes')) options.push({ label: 'Add / up-titrate SGLT2 inhibitor', delta: -0.18, cond: 'Type 2 Diabetes', details: 'Empagliflozin 10 → 25 mg' });
    if (has('type 1 diabetes')) options.push({ label: 'Adjust basal insulin', delta: -0.12, cond: 'Type 1 Diabetes', details: 'Glargine −10% (nocturnal hypos)' });
    if (has('copd', 'asthma')) options.push({ label: 'Pulmonary rehabilitation', delta: -0.15, cond: 'COPD', details: '8-week supervised programme' });
    if (has('kidney', 'ckd')) options.push({ label: 'Renal-dose medication review', delta: -0.1, cond: 'CKD', details: 'Adjust for current eGFR' });
    if (has('hypertension')) options.push({ label: 'Up-titrate antihypertensive', delta: -0.12, cond: 'Hypertension', details: 'Target SBP < 130 mmHg' });
    if (has('liver', 'nafld')) options.push({ label: 'Structured weight-loss plan', delta: -0.15, cond: 'NAFLD', details: '7–10% body-weight target' });
    if (has('lipid', 'cholesterol')) options.push({ label: 'High-intensity statin', delta: -0.08, cond: 'Dyslipidaemia', details: 'LDL target < 70 mg/dL' });
    if (has('rheumatoid')) options.push({ label: 'Continue DMARD + monitoring', delta: -0.08, cond: 'Rheumatoid Arthritis', details: 'Methotrexate, LFT every 8 weeks' });
    if (has('thyroid')) options.push({ label: 'Levothyroxine dose check', delta: -0.05, cond: 'Hypothyroidism', details: 'Repeat TSH in 6 weeks' });
    if ((patient.adherenceScore ?? 100) < 80) options.push({ label: 'Adherence programme', delta: -0.12, cond: 'Adherence', details: `Current adherence ${patient.adherenceScore}%` });
    return options.slice(0, 3);
  };

  useEffect(() => {
    if (!patient) return;
    const first = getInterventions()[0];
    setPrimaryCondition(first?.cond === 'Adherence' ? (patient.diagnosis?.[0] || 'General') : (first?.cond || patient.diagnosis?.[0] || 'General'));
    setActiveInterventions({});
  }, [patient?.id]);

  useEffect(() => {
    if (!patient) return;

    const isStable = patient.riskScore < 50;
    const baseRisk = patient.riskScore;

    const data = [];
    for (let m = 0; m <= 6; m++) {
      let riskVal = isStable 
        ? baseRisk - (m * 2.5) 
        : baseRisk + (m * 2.8);
      
      riskVal = Math.max(10, Math.min(98, riskVal));

      // Calculate simulated risk by applying delta from ALL active interventions
      let simVal = riskVal;
      const factor = m / 6.0;
      
      const interventionsList = getInterventions();
      interventionsList.forEach(item => {
        if (activeInterventions[item.label]) {
          const deltaAmt = (item.delta * 100) * factor;
          simVal += deltaAmt;
        }
      });
      simVal = Math.max(10, Math.min(98, simVal));

      data.push({
        month: `Month ${m}`,
        risk: Math.round(riskVal),
        simulatedRisk: Math.round(simVal)
      });
    }
    setChartData(data);
  }, [patient?.id, activeInterventions]);

  const handleToggle = (item) => {
    setActiveInterventions(prev => ({
      ...prev,
      [item.label]: !prev[item.label]
    }));
  };

  const interventions = getInterventions();
  const hasActiveInterventions = Object.values(activeInterventions).some(Boolean);

  // Format month names for XAxis
  const formatMonth = (value) => {
    const index = parseInt(value.replace('Month ', ''));
    const d = new Date();
    d.setMonth(d.getMonth() + index);
    return d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  };

  const getSimulatedOutcomeText = () => {
    const activeKeys = Object.keys(activeInterventions).filter(k => activeInterventions[k]);
    if (activeKeys.length === 0) {
      return "Select an intervention above to simulate patient outcomes.";
    }
    const end = chartData[chartData.length - 1];
    const drop = end ? end.risk - end.simulatedRisk : 0;
    return (
      <>
        Projected risk score <span className="text-[#FF6B9E] font-black">{end?.simulatedRisk}</span> at 6 months
        vs {end?.risk} without intervention (<span className="text-[#FF6B9E] font-black">−{drop} points</span>), driven by {activeKeys.join(' + ')}.
      </>
    );
  };

  return (
    <div className="flex flex-col w-full gap-6">
      {/* 1. Yellow Trajectory Forecast Card */}
      <div className="bg-[#FFD646] rounded-[32px] p-8 shadow-2xl shadow-[#FFD646]/20 relative overflow-hidden flex flex-col gap-6 animate-fade-in-up">
        {/* Header */}
        <div className="flex justify-between items-start z-10 text-black">
          <div>
            <h2 className="font-headline-card text-[28px] text-black tracking-tight font-black font-sans">Trajectory Forecast</h2>
            <p className="font-body-sm text-[15px] text-black/75 mt-1 font-medium font-sans">
              {primaryCondition} Progression Risk
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[72px] font-black text-black tracking-tighter leading-none">{patient.riskScore}</span>
            <div className="flex flex-col text-[10px] font-black uppercase tracking-wider text-black/60 leading-none">
              <span>Risk</span>
              <span>Score</span>
            </div>
          </div>
        </div>

        {/* Chart directly rendered on the yellow card */}
        <div className="h-[220px] w-full relative z-10 p-4 pb-6 overflow-hidden">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 15, left: 15, bottom: -5 }}>
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#FF6B9E" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#FF6B9E" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
              <XAxis 
                dataKey="month" 
                stroke="rgba(0,0,0,0.6)" 
                fontSize={11} 
                fontWeight="bold" 
                tickFormatter={formatMonth} 
                tickLine={false} 
                axisLine={false} 
              />
              <Tooltip 
                contentStyle={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)' }}
                labelStyle={{ color: '#000000', fontWeight: 'bold', fontSize: '11px', fontFamily: 'sans-serif' }}
                itemStyle={{ fontSize: '11px', color: '#000000', fontFamily: 'sans-serif' }}
              />
              <Area 
                name="Baseline Forecast" 
                type="monotone" 
                dataKey="risk" 
                stroke="#FF6B9E" 
                strokeWidth={4} 
                fill="url(#chartGradient)"
                dot={{ r: 4, fill: '#FF6B9E', stroke: '#fff', strokeWidth: 2 }} 
                activeDot={{ r: 6 }}
              />
              {hasActiveInterventions && (
                <Area 
                  name="Simulated Outcome" 
                  type="monotone" 
                  dataKey="simulatedRisk" 
                  stroke="#000000" 
                  strokeWidth={3} 
                  strokeDasharray="6 4" 
                  fill="none"
                  dot={{ r: 3, fill: '#000000' }} 
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2. White Intervention Simulator Card */}
      <div className="bg-white rounded-[32px] p-8 shadow-xl shadow-black/5 flex flex-col gap-6 relative overflow-hidden border border-gray-100 animate-fade-in-up">
        <div className="flex items-center gap-4 z-10">
          <div className="bg-[#A7F3D0]/30 p-2.5 rounded-2xl flex items-center justify-center text-[#10B981] w-12 h-12">
            <span className="material-symbols-outlined text-[28px]">science</span>
          </div>
          <h2 className="font-headline-card text-[24px] text-primary font-extrabold tracking-tight font-sans">
            Intervention Simulator
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 z-10">
          {interventions.map((item, idx) => {
            const isSelected = !!activeInterventions[item.label];
            return (
              <div
                key={idx}
                onClick={() => handleToggle(item)}
                className={`rounded-2xl p-5 border flex justify-between items-center cursor-pointer transition-all duration-300 shadow-sm ${
                  isSelected 
                    ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]' 
                    : 'bg-white border-gray-100 text-black hover:border-gray-200'
                }`}
              >
                <div>
                  <h4 className="font-bold text-[16px] text-primary leading-tight font-sans">{item.label}</h4>
                  <p className={`text-sm mt-1 font-sans ${isSelected ? 'text-[#065F46]/75' : 'text-gray-500'}`}>{item.details}</p>
                </div>
                
                {/* Switch Track */}
                <div className={`w-14 h-8 rounded-full relative transition-colors duration-300 shadow-inner ${
                  isSelected ? 'bg-[#10B981]' : 'bg-gray-250 border border-gray-300/40'
                }`}>
                  {/* Knob */}
                  <div className={`w-6 h-6 bg-white rounded-full absolute top-1 transition-transform duration-300 shadow-md ${
                    isSelected ? 'translate-x-[24px]' : 'translate-x-1'
                  }`} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-[#FFF9E6] rounded-2xl p-6 border border-[#FFDE59]/20 z-10">
          <p className="font-label-bold text-[11px] text-black/60 uppercase tracking-[0.15em] font-bold font-sans">
            Simulated Outcome
          </p>
          <p className="text-[18px] text-primary font-bold mt-2 leading-snug font-sans">
            {getSimulatedOutcomeText()}
          </p>
        </div>
      </div>
    </div>
  );
};

export default TrajectoryPreview;
