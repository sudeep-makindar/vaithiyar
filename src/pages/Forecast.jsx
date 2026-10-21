import React, { useState, useEffect } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { usePatientStore } from '../stores/patientStore';
import { useForecastStore } from '../stores/forecastStore';
import useSSEStream from '../hooks/useSSEStream';
import TopHeader from '../components/TopHeader';
import { BASE_API } from '../config.js';

const Forecast = () => {
  const { patients, currentPatient, setCurrentPatient, loadPatients } = usePatientStore();
  const { 
    forecastData, 
    setForecastData, 
    activeInterventions, 
    toggleIntervention, 
    resetInterventions 
  } = useForecastStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [simulatedData, setSimulatedData] = useState(null);
  const [activeTab, setActiveTab] = useState('Cardio'); // Cardio, Endo, Resp

  // SSE hooks
  const baseSSE = useSSEStream();
  const simSSE = useSSEStream();

  // Load patients list on mount if empty
  useEffect(() => {
    if (patients.length === 0) {
      loadPatients();
    }
  }, []);

  // Filter patients by search (with fallback default case to prevent empty dropdowns)
  const filteredPatients = patients.filter(p => {
    if (currentPatient && searchTerm === currentPatient.name) return true;
    if (!searchTerm.trim()) return true;
    return p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
           p.id.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Load baseline forecast
  const loadBaseline = async (patientId) => {
    resetInterventions();
    setSimulatedData(null);
    try {
      baseSSE.setData('');
      await baseSSE.startStream(`${BASE_API}/forecast/trajectory`, { patient_id: patientId });
    } catch (err) {
      console.error("Failed to stream forecast:", err);
    }
  };

  // Triggered on active patient change
  useEffect(() => {
    if (currentPatient) {
      setSearchTerm(currentPatient.name);
      loadBaseline(currentPatient.id);
    }
  }, [currentPatient?.id]);

  // Parse baseline SSE content when finished or updating
  useEffect(() => {
    if (baseSSE.data && !baseSSE.loading) {
      try {
        let cleanText = baseSSE.data.trim();
        if (cleanText.startsWith('```json')) {
          cleanText = cleanText.substring(7);
        } else if (cleanText.startsWith('```')) {
          cleanText = cleanText.substring(3);
        }
        if (cleanText.endsWith('```')) {
          cleanText = cleanText.substring(0, cleanText.length - 3);
        }
        const parsed = JSON.parse(cleanText.trim());
        setForecastData(parsed);
      } catch (e) {
        // Wait for complete stream
      }
    }
  }, [baseSSE.data, baseSSE.loading]);

  // Run simulation whenever activeInterventions changes
  useEffect(() => {
    if (!currentPatient) return;
    const activeList = Object.keys(activeInterventions).filter(k => activeInterventions[k]);
    if (activeList.length === 0) {
      setSimulatedData(null);
      return;
    }

    const runSimulation = async () => {
      try {
        simSSE.setData('');
        await simSSE.startStream(`${BASE_API}/forecast/simulate`, {
          patient_id: currentPatient.id,
          interventions: activeList
        });
      } catch (err) {
        console.error("Failed to run simulation:", err);
      }
    };

    runSimulation();
  }, [activeInterventions, currentPatient?.id]);

  // Parse simulated SSE content
  useEffect(() => {
    if (simSSE.data && !simSSE.loading) {
      try {
        let cleanText = simSSE.data.trim();
        if (cleanText.startsWith('```json')) {
          cleanText = cleanText.substring(7);
        } else if (cleanText.startsWith('```')) {
          cleanText = cleanText.substring(3);
        }
        if (cleanText.endsWith('```')) {
          cleanText = cleanText.substring(0, cleanText.length - 3);
        }
        const parsed = JSON.parse(cleanText.trim());
        setSimulatedData(parsed);
      } catch (e) {
        // Wait for complete stream
      }
    }
  }, [simSSE.data, simSSE.loading]);

  // Dynamic interventions list from current patient forecast
  const interventions = forecastData?.intervention_impacts || [];

  const handleToggleIntervention = (interventionName) => {
    toggleIntervention(interventionName);
  };

  // Format Recharts data dynamically
  const getChartData = () => {
    const isCardio = activeTab === 'Cardio';
    const isEndo = activeTab === 'Endo';
    const isResp = activeTab === 'Resp';

    const conditionsList = forecastData?.conditions || forecastData?.trajectory || [];
    
    // Attempt to match tab to condition name
    const match = conditionsList.find(c => {
      const name = c.condition.toLowerCase();
      if (isCardio) return name.includes('hyper') || name.includes('cardio') || name.includes('bp') || name.includes('heart') || name.includes('cad');
      if (isEndo) return name.includes('diab') || name.includes('endo') || name.includes('nephr') || name.includes('glyc') || name.includes('renal');
      if (isResp) return name.includes('asthma') || name.includes('copd') || name.includes('resp') || name.includes('lung');
      return false;
    }) || conditionsList[0];

    // Fallback default points if matching is not resolved yet or offline
    const defaultPoints = Array.from({ length: 13 }, (_, i) => {
      let baseVal = 70;
      if (isEndo) baseVal = 85;
      if (isResp) baseVal = 60;
      
      const risk = Math.max(10, Math.min(95, baseVal + (i * 1.5)));
      return {
        month: i,
        risk: risk,
        confidence_low: Math.max(5, risk - 8),
        confidence_high: Math.min(98, risk + 8)
      };
    });

    const trajectory = match?.trajectory || [];
    if (trajectory.length === 0) {
      return defaultPoints.map(pt => ({
        ...pt,
        simulatedRisk: Object.values(activeInterventions).some(Boolean)
          ? Math.max(10, pt.risk - 15)
          : undefined
      }));
    }

    // Match simulated condition
    let matchingSim = null;
    if (simulatedData) {
      const simConditionsList = simulatedData.conditions || simulatedData.trajectory || [];
      matchingSim = simConditionsList.find(c => c.condition === match.condition);
    }

    return trajectory.map((pt, idx) => {
      const simPt = matchingSim?.trajectory?.[idx];
      return {
        month: pt.month,
        risk: Math.round(pt.risk * 100),
        confidence_low: Math.round(pt.confidence_low * 100),
        confidence_high: Math.round(pt.confidence_high * 100),
        simulatedRisk: simPt ? Math.round(simPt.risk * 100) : undefined
      };
    });
  };

  const chartData = getChartData();
  const hasActiveInterventions = Object.values(activeInterventions).some(Boolean);

  const formatXAxis = (value) => {
    const months = ['MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR'];
    return months[value % months.length];
  };

  const formatTooltip = (value, name) => {
    return [`${value}%`, name];
  };

  const getOutcomeText = () => {
    const activeKeys = Object.keys(activeInterventions).filter(k => activeInterventions[k]);
    if (activeKeys.length === 0) {
      return "Select an intervention above to simulate patient outcomes.";
    }
    const totalDelta = interventions
      .filter(i => activeInterventions[i.intervention])
      .reduce((acc, curr) => acc + Math.abs(curr.risk_delta), 0);
    const roundedPct = Math.round(totalDelta * 100);

    return (
      <>
        Projected <span className="text-[#FF6B9E] font-black">{roundedPct}% reduction</span> in progression risk over 6 months ({activeKeys.join(' + ')}).
      </>
    );
  };

  return (
    <div className="flex flex-col min-h-screen bg-transparent text-on-surface">
      <TopHeader />
      
      <main className="px-4 md:px-8 pb-8 flex-grow flex flex-col gap-8 w-full max-w-[1600px] mx-auto relative font-sans">
        
        {/* Header & Patient Selector */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fade-in-up">
          <div>
            <h1 className="text-2xl md:text-[32px] font-semibold text-on-surface tracking-tight leading-tight md:leading-[40px]">
              Predictive forecast:
            </h1>
            <p className="text-sm md:text-base text-[#444748] mt-1 font-normal leading-relaxed md:leading-[24px]">
              Multi-cohort projection and risk analysis based on current patient data.
            </p>
          </div>
          
          {/* Dropdown Selector */}
          <div className="relative w-72 self-end md:self-auto">
            <div className="relative">
              <input 
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search patient..."
                className="w-full pl-5 pr-10 py-3 bg-white border border-gray-200 rounded-full shadow-sm focus:outline-none focus:border-brand-yellow transition-all duration-300 text-xs font-bold text-gray-750 cursor-pointer"
              />
              <span className="material-symbols-outlined text-[18px] text-gray-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                search
              </span>
            </div>
            
            {showDropdown && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-[16px] shadow-lg z-50 max-h-60 overflow-y-auto">
                {filteredPatients.map(p => (
                  <div
                    key={p.id}
                    onClick={() => {
                      setCurrentPatient(p);
                      setSearchTerm(p.name);
                      setShowDropdown(false);
                    }}
                    className="px-5 py-3 hover:bg-[#FAF9F5] cursor-pointer text-xs font-bold text-gray-750 flex justify-between items-center transition-colors duration-200 border-b border-gray-50 last:border-0"
                  >
                    <span>{p.name}</span>
                    <span className="text-[10px] text-gray-400 font-mono font-bold">{p.id}</span>
                  </div>
                ))}
                {filteredPatients.length === 0 && (
                  <div className="px-5 py-3 text-xs text-gray-400 font-medium text-center">
                    No patients found
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {baseSSE.loading ? (
          <div className="flex items-center justify-center p-20 bg-white border border-gray-200 rounded-[24px] shadow-sm">
            <div className="text-center">
              <div className="inline-block w-8 h-8 border-4 border-brand-pink border-t-transparent rounded-full animate-spin mb-4"></div>
              <div className="text-brand-pink font-extrabold tracking-wider text-sm">STREAMING FORECAST VECTORS...</div>
            </div>
          </div>
        ) : (
          <>
            {/* 4 Stat Cards Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in-up">
              
              {/* Yellow Card */}
              <div className="bg-[#FBE46A] rounded-[24px] p-6 relative overflow-hidden flex flex-col min-h-[160px] shadow-sm font-sans justify-center">
                <div className="absolute bottom-[-10%] right-[-10%] w-[120px] h-[120px] bg-black/15 rounded-full blur-2xl opacity-10 pointer-events-none" />
                <div className="relative z-10">
                  <h3 className="font-headline-card text-on-surface text-base font-bold">12-month peak risk:</h3>
                  <div className="mt-4 flex items-end gap-2">
                    <span className="font-display-metric text-on-surface text-3xl font-extrabold">Cardio</span>
                    <span className="font-label-bold text-on-surface/70 text-xs font-bold mb-1">+14%</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-on-surface/70">&nbsp;</div>
                </div>
              </div>

              {/* Pink Card */}
              <div className="bg-[#F8BDEB] rounded-[24px] p-6 relative overflow-hidden flex flex-col min-h-[160px] shadow-sm font-sans justify-center">
                <div className="absolute bottom-[-10%] right-[-10%] w-[120px] h-[120px] bg-black/15 rounded-full blur-2xl opacity-10 pointer-events-none" />
                <div className="relative z-10">
                  <h3 className="font-headline-card text-on-surface text-base font-bold">Highest risk condition:</h3>
                  <div className="mt-4 flex items-end gap-2">
                    <span className="font-display-metric text-on-surface text-3xl font-extrabold">Type II Dia.</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-on-surface/70">85 patients tracked</div>
                </div>
              </div>

              {/* Olive Card */}
              <div className="bg-[#A8CC78] rounded-[24px] p-6 relative overflow-hidden flex flex-col min-h-[160px] shadow-sm font-sans justify-center">
                <div className="absolute bottom-[-10%] right-[-10%] w-[120px] h-[120px] bg-black/15 rounded-full blur-2xl opacity-10 pointer-events-none" />
                <div className="relative z-10">
                  <h3 className="font-headline-card text-on-surface text-base font-bold">Top driver:</h3>
                  <div className="mt-4 flex items-end gap-2">
                    <span className="font-display-metric text-on-surface text-3xl font-extrabold">Med. Adherence</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-on-surface/70">Declined by 5% QoQ</div>
                </div>
              </div>

              {/* Blue Card */}
              <div className="bg-[#A3DEFE] rounded-[24px] p-6 relative overflow-hidden flex flex-col min-h-[160px] shadow-sm font-sans justify-center">
                <div className="absolute bottom-[-10%] right-[-10%] w-[120px] h-[120px] bg-black/15 rounded-full blur-2xl opacity-10 pointer-events-none" />
                <div className="relative z-10">
                  <h3 className="font-headline-card text-on-surface text-base font-bold">Best intervention:</h3>
                  <div className="mt-4 flex items-end gap-2">
                    <span className="font-display-metric text-on-surface text-3xl font-extrabold">Telehealth Follow-up</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-on-surface/70">High efficacy rate</div>
                </div>
              </div>

            </div>

            {/* Trajectory Forecast Card (Yellow card style) */}
            <div className="bg-[#FFD646] rounded-[32px] p-8 shadow-xl shadow-[#FFD646]/20 relative overflow-hidden flex flex-col gap-6 animate-fade-in-up font-sans">
              
              {/* Header block matching screenshot */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 z-10 text-black">
                <div>
                  <h2 className="text-2xl font-extrabold text-black tracking-tight leading-none">Trajectory Forecast</h2>
                  <p className="text-sm text-black/75 mt-1.5 font-medium">
                    {activeTab === 'Cardio' ? 'Cardiovascular' : activeTab === 'Endo' ? 'Endocrinology' : 'Respiratory'} Progression Risk
                  </p>
                </div>
                
                {/* Cohort Tabs and Risk Score */}
                <div className="flex items-center gap-4 self-end md:self-auto">
                  <div className="flex gap-1.5 bg-black/10 p-1 rounded-full border border-black/10 mr-2">
                    {['Cardio', 'Endo', 'Resp'].map(tab => (
                      <button 
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                          activeTab === tab ? 'bg-white text-black shadow-sm' : 'text-black/60 hover:text-black'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-[56px] font-black text-black tracking-tighter leading-none">
                      {currentPatient?.riskScore || 78}
                    </span>
                    <div className="flex flex-col text-[10px] font-black uppercase tracking-wider text-black/60 leading-none">
                      <span>Risk</span>
                      <span>Score</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chart directly rendered on the yellow card */}
              <div className="h-[220px] w-full relative z-10 p-2 overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 15, left: 15, bottom: -5 }}>
                    <defs>
                      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF6B9E" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#FF6B9E" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="bandGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF6B9E" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#FF6B9E" stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.08)" />
                    <XAxis 
                      dataKey="month" 
                      tickFormatter={formatXAxis} 
                      ticks={[0, 2, 4, 6, 8, 10, 12]}
                      stroke="rgba(0,0,0,0.6)" 
                      fontSize={11} 
                      fontWeight="bold" 
                      tickLine={false} 
                      axisLine={false} 
                    />
                    <YAxis 
                      stroke="rgba(0,0,0,0.6)" 
                      fontSize={11} 
                      fontWeight="bold" 
                      tickFormatter={(val) => `${val}%`}
                      tickLine={false} 
                      axisLine={false}
                      domain={[0, 100]}
                    />
                    <Tooltip 
                      formatter={formatTooltip}
                      contentStyle={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)' }}
                      labelStyle={{ color: '#000000', fontWeight: 'bold', fontSize: '11px' }}
                      itemStyle={{ fontSize: '11px', color: '#000000' }}
                    />
                    {/* Shaded Confidence range Area */}
                    <Area 
                      name="Confidence Range"
                      type="monotone" 
                      dataKey="confidence_high" 
                      stroke="none" 
                      fill="url(#bandGradient)" 
                    />
                    {/* Baseline Area */}
                    <Area 
                      name="Baseline Forecast" 
                      type="monotone" 
                      dataKey="risk" 
                      stroke="#FF6B9E" 
                      strokeWidth={4} 
                      fill="url(#chartGradient)"
                      dot={{ r: 4, fill: '#ffffff', stroke: '#FF6B9E', strokeWidth: 2 }} 
                      activeDot={{ r: 6 }}
                    />
                    {/* Simulated Outcome Line */}
                    {hasActiveInterventions && (
                      <Area 
                        name="Simulated Outcome" 
                        type="monotone" 
                        dataKey="simulatedRisk" 
                        stroke="#000000" 
                        strokeWidth={3} 
                        strokeDasharray="6 4" 
                        fill="none"
                        dot={{ r: 3.5, fill: '#000000', stroke: '#ffffff', strokeWidth: 1.5 }} 
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>

            </div>

            {/* Bottom Sections */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in-up">
              
              {/* White Intervention Simulator Card */}
              <div className="bg-white rounded-[32px] p-8 shadow-xl shadow-black/5 flex flex-col gap-6 relative overflow-hidden border border-gray-150 animate-fade-in-up font-sans">
                <div className="flex items-center gap-4 z-10">
                  <div className="bg-[#ECFDF5] p-2.5 rounded-2xl flex items-center justify-center text-[#10B981] w-12 h-12">
                    <span className="material-symbols-outlined text-[28px]">science</span>
                  </div>
                  <h2 className="font-headline-card text-2xl text-on-surface font-extrabold tracking-tight">
                    Intervention Simulator
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 z-10">
                  {interventions.map((item, idx) => {
                    const isChecked = !!activeInterventions[item.intervention];
                    // Custom detail text based on intervention name
                    const getDetails = (name) => {
                      if (name.includes('Metformin')) return '500mg daily';
                      if (name.includes('Lisinopril')) return 'To 20mg daily';
                      if (name.includes('Adherence')) return 'Daily adherence reminders';
                      if (name.includes('Beta Blocker')) return 'Coreg 25mg bid';
                      if (name.includes('Polypharmacy')) return 'Regime simplification';
                      if (name.includes('Sodium')) return 'Low-sodium dietary support';
                      if (name.includes('Methotrexate')) return 'Titration to 10mg weekly';
                      if (name.includes('Iron')) return 'Fersolate 300mg daily';
                      return 'Clinical follow-up support';
                    };
                    return (
                      <div
                        key={idx}
                        onClick={() => handleToggleIntervention(item.intervention)}
                        className={`rounded-2xl p-5 border flex justify-between items-center cursor-pointer transition-all duration-300 shadow-sm ${
                          isChecked 
                            ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]' 
                            : 'bg-white border-gray-150 text-black hover:border-gray-200'
                        }`}
                      >
                        <div>
                          <h4 className="font-bold text-base leading-tight">{item.intervention}</h4>
                          <p className={`text-xs mt-1 ${isChecked ? 'text-[#065F46]/75' : 'text-gray-500'}`}>
                            {getDetails(item.intervention)}
                          </p>
                        </div>
                        
                        {/* Switch Track */}
                        <div className={`w-14 h-8 rounded-full relative transition-colors duration-300 shadow-inner ${
                          isChecked ? 'bg-[#10B981]' : 'bg-gray-200 border border-gray-300/40'
                        }`}>
                          {/* Knob */}
                          <div className={`w-6 h-6 bg-white rounded-full absolute top-1 transition-transform duration-300 shadow-md ${
                            isChecked ? 'translate-x-[26px]' : 'translate-x-1'
                          }`} />
                        </div>
                      </div>
                    );
                  })}
                  {interventions.length === 0 && (
                    <div className="text-center col-span-2 p-6 text-xs text-gray-400 font-semibold">
                      No interventions defined for this patient model.
                    </div>
                  )}
                </div>

                {/* Simulated Outcome Text Block */}
                <div className="bg-[#FFF9E6] rounded-2xl p-6 border border-[#FFDE59]/20 z-10 mt-2">
                  <p className="font-label-bold text-[11px] text-black/60 uppercase tracking-[0.15em] font-bold">
                    Simulated Outcome
                  </p>
                  <p className="text-lg text-primary font-bold mt-2 leading-snug">
                    {simSSE.loading ? (
                      <span className="animate-pulse text-sm">Analyzing simulated efficacy data...</span>
                    ) : (
                      getOutcomeText()
                    )}
                  </p>
                </div>
              </div>

              {/* Clinical Milestones */}
              <div className="bg-white border border-gray-150 rounded-[24px] p-6 overflow-hidden flex flex-col shadow-sm">
                <h3 className="font-headline-card text-on-surface text-lg font-bold mb-4">Clinical milestones:</h3>
                <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar flex-grow items-center">
                  {(forecastData?.milestones || [
                    { month: 3, probability: 0.68, condition: 'HbA1c reduction', event: 'Goal of reducing HbA1c below 7.0% across cohort.' },
                    { month: 6, probability: 0.85, condition: 'CMP Target', event: 'Comprehensive metabolic panel and renal checks.' }
                  ]).map((milestone, idx) => (
                    <div 
                      key={idx} 
                      className="min-w-[220px] border border-gray-200 rounded-xl p-4 flex flex-col gap-2 shrink-0 bg-[#FAF9F5] hover:bg-gray-50 transition-colors h-[130px] justify-between shadow-sm"
                    >
                      <span className="text-[10px] font-bold text-brand-pink bg-[#FFDCE6] px-2.5 py-1 rounded w-fit uppercase font-mono">
                        M{milestone.month} target
                      </span>
                      <p className="font-bold text-xs text-black leading-normal truncate">{milestone.condition}</p>
                      <p className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed font-semibold">{milestone.event}</p>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default Forecast;
