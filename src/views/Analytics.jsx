import React, { useState, useMemo, useEffect } from 'react';
import { T } from '../tokens';
import TopHeader from '../components/TopHeader';
import PatientAnalyticsCard from '../components/Analytics/PatientAnalyticsCard';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import CalendarSidebar from '../components/CalendarSidebar';
import { fetchCohortAnalytics, fetchAnomalyTimeline } from '../api';

const Analytics = ({ patients = [] }) => {
  const [cohortMode, setCohortMode] = useState(false); // false = Personal Baseline, true = Age/Gender/BMI Cohort
  const [activeCell, setActiveCell] = useState(null);
  const [selectedAnomaly, setSelectedAnomaly] = useState(null);

  // Cohort matrix + percentile benchmarks, computed server-side from every patient's labs
  const [cohort, setCohort] = useState(null);
  useEffect(() => { fetchCohortAnalytics().then(setCohort); }, [patients]);
  const cohortData = cohort?.benchmarks || {};
  const HEATMAP_ROWS = cohort?.rows || [];
  const HEATMAP_COLS = cohort?.cols || [];
  const getHeatmapCell = (row, col) =>
    cohort?.cells?.[`${row}-${col}`] || { val: 0, text: 'No measurements for this combination.' };

  // Per-patient anomaly history (default: highest-risk patient)
  const ranked = useMemo(() => [...patients].sort((a, b) => b.riskScore - a.riskScore), [patients]);
  const [anomalyPatientId, setAnomalyPatientId] = useState(null);
  const activeAnomalyId = anomalyPatientId || ranked[0]?.id;
  const [anomalyTimeline, setAnomalyTimeline] = useState([]);
  useEffect(() => {
    if (!activeAnomalyId) return;
    setSelectedAnomaly(null);
    fetchAnomalyTimeline(activeAnomalyId).then(r => setAnomalyTimeline(r?.timeline || []));
  }, [activeAnomalyId]);

  return (
    <div className="flex flex-col min-h-screen bg-transparent text-on-surface">
      <TopHeader />

      <div className="flex-grow flex flex-col xl:flex-row gap-6 w-full max-w-[1600px] mx-auto pb-8 relative">
        
        {/* Left Column (Main content) */}
        <div className="flex-1 flex flex-col gap-6">
          
          {/* Page Header & Benchmarking Toggle */}
          <div className="flex justify-between items-center flex-wrap gap-4 px-4 md:px-8 mb-2">
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-brand-sidebar tracking-tight">Clinical analytics:</h1>
              <p className="text-sm text-gray-500 font-medium mt-1">Detailed biometric tracking and correlative analysis across your active patient cohort.</p>
            </div>

            {/* Benchmarking Toggle */}
            <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-full px-4 py-2 shadow-sm">
              <span className={`text-[10px] font-black uppercase tracking-wider font-mono ${!cohortMode ? 'text-brand-pink' : 'text-gray-400'}`}>
                Personal Baseline
              </span>
              <div 
                onClick={() => setCohortMode(!cohortMode)}
                className={`w-9 h-5 rounded-full p-0.5 cursor-pointer transition-colors ${cohortMode ? 'bg-brand-pink' : 'bg-gray-200'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${cohortMode ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
              <span className={`text-[10px] font-black uppercase tracking-wider font-mono ${cohortMode ? 'text-brand-pink' : 'text-gray-400'}`}>
                Cohort Benchmarks
              </span>
            </div>
          </div>

          {/* Cohort active info banner */}
          {cohortMode && (
            <div className="mx-4 md:mx-8 p-4 bg-brand-pink/10 border border-brand-pink/35 rounded-xl text-xs font-bold text-[#39071f] leading-normal animate-fade-in-up">
              Cohort Mode Active: Reference values show the 50th percentile (Median) and 90th percentile benchmarking lines based on matching Age, Gender, and BMI patient groups.
            </div>
          )}

          {/* Dynamic Patient Cards */}
          <div className="flex flex-col gap-6 px-4 md:px-8">
            {patients.map((p, idx) => (
              <div key={p.id} className="flex flex-col">
                <PatientAnalyticsCard patient={p} index={idx} />
                
                {/* Cohort Stats Display under each card when active */}
                {cohortMode && (
                  <div className="mt-3 bg-white border border-gray-200/80 rounded-[20px] p-4 flex flex-col gap-3 shadow-sm animate-fade-in-up">
                    <span className="text-[10px] font-black text-brand-pink tracking-wider uppercase font-mono">
                      Cohort Percentile Benchmarks
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {Object.keys(p.labs).map(lab => {
                        const ref = cohortData[lab];
                        if (!ref) return null;
                        const readings = p.labs[lab];
                        const latest = readings[readings.length - 1].val;
                        const isHigh = latest > ref.p90;
                        const pctStr = isHigh ? '>90th (High)' : latest > ref.median ? '50th-90th' : '<50th (Low)';
                        return (
                          <div key={lab} className="bg-brand-bg border border-gray-200 rounded-xl p-3 flex flex-col justify-between h-[80px]">
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider font-mono">{lab}</span>
                            <div className="flex justify-between items-baseline mt-1">
                              <span className={`text-base font-black ${isHigh ? 'text-red-650 font-black' : 'text-brand-sidebar'}`}>{latest}</span>
                              <span className={`text-[9px] font-black uppercase tracking-wider ${isHigh ? 'text-red-500' : 'text-gray-400'}`}>{pctStr}</span>
                            </div>
                            <span className="text-[9px] font-bold text-gray-400 block">Ref: Median {ref.median} | P90 {ref.p90}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Heatmap & Anomaly score timeline side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-4 md:px-8 mt-2">
            
            {/* 1. Biometric Interaction Heatmap (Olive Card) */}
            <div className="bg-brand-green rounded-[32px] p-6 relative overflow-hidden flex flex-col h-[400px] shadow-sm">
              {/* Decorative DOTS Pattern Background */}
              <div className="absolute inset-0 text-brand-sidebar/5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(currentColor 1.5px, transparent 1.5px)', backgroundSize: '16px 16px' }} />
              
              <div className="relative z-10 flex-1 flex flex-col justify-between">
                <div className="mb-4">
                  <h3 className="font-extrabold text-lg text-brand-sidebar">Biomarker correlations:</h3>
                  <p className="text-[10px] text-brand-sidebar/70 font-bold mt-0.5">Mean biomarker deviation from reference range, by condition, across {cohort?.patients_analysed ?? '…'} patients. Hover for interpretation.</p>
                </div>

                {/* Heatmap Grid */}
                <div className="flex-1 flex flex-col gap-1.5 justify-center py-2">
                  {/* Header row */}
                  <div className="flex items-center">
                    <div className="w-[100px] text-[8px] font-black text-brand-sidebar/65 uppercase tracking-wider font-mono">Diagnosis</div>
                    <div className="flex-1 flex gap-1.5">
                      {HEATMAP_COLS.map(col => (
                        <div key={col} className="flex-1 text-center text-[8px] font-black text-brand-sidebar/65 uppercase tracking-wider font-mono">{col}</div>
                      ))}
                    </div>
                  </div>

                  {/* Rows */}
                  {HEATMAP_ROWS.map(row => (
                    <div key={row} className="flex items-center">
                      <div className="w-[100px] text-xs font-black text-brand-sidebar truncate pr-2">{row}</div>
                      <div className="flex-1 flex gap-1.5">
                        {HEATMAP_COLS.map(col => {
                          const cell = getHeatmapCell(row, col);
                          const opacity = cell.val;
                          // Map strength (0 to 1) to opacity of purple/black
                          const cellBg = `rgba(27, 28, 26, ${opacity})`;
                          
                          return (
                            <div
                              key={col}
                              onMouseEnter={() => setActiveCell({ row, col, val: cell.val, text: cell.text })}
                              onMouseLeave={() => setActiveCell(null)}
                              className="flex-1 h-7 rounded flex items-center justify-center cursor-pointer text-[9px] font-black transition-all hover:scale-105"
                              style={{
                                background: cellBg,
                                color: opacity > 0.55 ? '#FFFFFF' : '#1B1C1A',
                                border: '1px solid rgba(27, 28, 26, 0.1)'
                              }}
                            >
                              {cell.val.toFixed(2)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tooltip feedback box */}
                <div className="mt-3 bg-white/40 rounded-xl p-3 border border-brand-sidebar/10 min-h-[56px] flex flex-col justify-center">
                  {activeCell ? (
                    <div>
                      <div className="text-[10px] font-black text-brand-sidebar uppercase tracking-wider font-mono">
                        {activeCell.row} × {activeCell.col} (Deviation index: {activeCell.val.toFixed(2)})
                      </div>
                      <div className="text-[11px] text-brand-sidebar/85 font-medium mt-0.5 leading-tight">
                        {activeCell.text}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-brand-sidebar/60 font-bold text-center">
                      Hover over matrix cells to query clinical feedback and coefficient interpretations.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Anomaly Score Timeline (Pink Card) */}
            <div className="bg-brand-pink rounded-[32px] p-6 relative overflow-hidden flex flex-col h-[400px] shadow-sm">
              <div className="relative z-10 flex-1 flex flex-col justify-between">
                <div className="mb-4">
                  <div className="flex justify-between items-center gap-2">
                    <h3 className="font-extrabold text-lg text-[#39071f]">Anomaly history:</h3>
                    <select
                      value={activeAnomalyId || ''}
                      onChange={(e) => setAnomalyPatientId(e.target.value)}
                      className="bg-white/60 border border-[#39071f]/20 rounded-full px-3 py-1 text-[11px] font-bold text-[#39071f] cursor-pointer"
                    >
                      {ranked.map(p => <option key={p.id} value={p.id}>{p.name} (risk {p.riskScore})</option>)}
                    </select>
                  </div>
                  <p className="text-[10px] text-[#b56f89] font-bold mt-0.5">Monthly deviation score across all tracked biomarkers. Click red points (score above 70) for details.</p>
                </div>

                {/* Anomaly Timeline Line Chart */}
                <div className="w-full h-44 relative mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={anomalyTimeline} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <XAxis dataKey="month" stroke="#b56f89" fontSize={9} tickLine={false} />
                      <YAxis stroke="#b56f89" fontSize={9} domain={[0, 100]} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ background: '#FAF9F5', border: '1px solid #C4C7C7', borderRadius: '12px' }}
                        labelStyle={{ color: '#1B1C1A', fontSize: '10px', fontWeight: 'bold' }}
                        itemStyle={{ fontSize: '10px', color: '#444748' }}
                      />
                      <ReferenceLine y={70} stroke="rgba(186, 26, 26, 0.4)" strokeDasharray="3 3" />
                      <Line 
                        type="monotone" 
                        dataKey="score" 
                        stroke="#39071f" 
                        strokeWidth={2}
                        dot={(props) => {
                          const { cx, cy, payload } = props;
                          const isSpike = payload.score > 70;
                          if (isSpike) {
                            return (
                              <circle
                                key={payload.month}
                                cx={cx}
                                cy={cy}
                                r={6}
                                fill="#ba1a1a"
                                stroke="#ffffff"
                                strokeWidth={1.5}
                                style={{ cursor: 'pointer', filter: 'drop-shadow(0 0 4px rgba(186, 26, 26, 0.5))' }}
                                onClick={() => setSelectedAnomaly(payload)}
                              />
                            );
                          }
                          return (
                            <circle
                              key={payload.month}
                              cx={cx}
                              cy={cy}
                              r={3}
                              fill="#39071f"
                              stroke="none"
                            />
                          );
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Anomaly diagnostics drawer */}
                <div className="mt-3 min-h-[70px] flex flex-col justify-center">
                  {selectedAnomaly ? (
                    <div className="bg-[#ba1a1a]/15 border border-[#ba1a1a]/30 rounded-xl p-3 flex flex-col relative animate-fade-in-up">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-red-750 font-mono tracking-wider uppercase">
                          Anomalous Deviation ({selectedAnomaly.score}%)
                        </span>
                        <button 
                          onClick={() => setSelectedAnomaly(null)}
                          className="text-[#39071f] hover:opacity-75 text-[11px] font-black cursor-pointer"
                        >
                          Close ✕
                        </button>
                      </div>
                      <div className="text-[11px] font-black text-[#39071f] mt-1">
                        Date: {selectedAnomaly.month}
                      </div>
                      <p className="text-[10px] text-[#39071f]/85 mt-0.5 leading-normal font-medium">
                        {selectedAnomaly.desc}
                      </p>
                    </div>
                  ) : (
                    <div className="border border-dashed border-[#39071f]/20 rounded-xl p-3 flex items-center justify-center text-center">
                      <span className="text-[10px] font-bold text-[#b56f89]">Click on a red spike point above to read the anomaly diagnostics brief.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* Right Sidebar Panel: Calendar & Timeline */}
        <CalendarSidebar />

      </div>
    </div>
  );
};

export default Analytics;
