import React, { useState, useEffect } from 'react';
import { T } from '../../tokens';
import GlassCard from '../ui/GlassCard';
import GlowBadge from '../ui/GlowBadge';
import StreamingText from '../ui/StreamingText';
import useSSEStream from '../../hooks/useSSEStream';
import { BASE_API } from '../../config.js';

const ORGANS = [
  { id: 'brain', name: 'Brain', cx: 50, cy: 22, color: '#A855F7', biomarkers: ['Cognition'] },
  { id: 'lungs', name: 'Lungs', cx: 50, cy: 52, color: '#3B82F6', biomarkers: ['FEV1'] },
  { id: 'heart', name: 'Heart', cx: 47, cy: 62, color: '#EF4444', biomarkers: ['BP_Systolic', 'HeartRate', 'BNP'] },
  { id: 'liver', name: 'Liver', cx: 55, cy: 72, color: '#F59E0B', biomarkers: ['AST', 'ALT'] },
  { id: 'kidney', name: 'Kidney', cx: 50, cy: 84, color: '#10B981', biomarkers: ['Creatinine', 'Potassium'] }
];

const BodyMapContext = ({ patient }) => {
  if (!patient) return null;

  const [selectedOrgan, setSelectedOrgan] = useState(null);
  const [organRisk, setOrganRisk] = useState(null);
  const [organSummary, setOrganSummary] = useState('');
  
  const organSSE = useSSEStream();

  const handleOrganClick = async (organ) => {
    setSelectedOrgan(organ);
    setOrganRisk(null);
    setOrganSummary('');
    organSSE.setData('');
    organSSE.setLoading(true);

    try {
      await organSSE.startStream(`${BASE_API}/patient/${patient.id}/organ-assessment`, {
        organ: organ.id
      });
    } catch (err) {
      console.error("Failed to stream organ assessment:", err);
    }
  };

  // Parse SSE data
  useEffect(() => {
    if (organSSE.data) {
      const fullText = organSSE.data;
      const firstLine = fullText.split('\n')[0];
      
      let risk = 50;
      let summary = fullText;

      if (firstLine.startsWith('[RISK:')) {
        try {
          risk = parseInt(firstLine.replace('[', '').replace(']', '').split(':')[1].trim()) || 50;
        } catch(e) {
          risk = 50;
        }
        summary = fullText.split('\n').slice(1).join('\n').trim();
      }

      setOrganRisk(risk);
      setOrganSummary(summary);
    }
  }, [organSSE.data]);

  const getLatestBiomarker = (name) => {
    const list = patient.labs?.[name];
    if (list && list.length > 0) {
      const latest = list[list.length - 1];
      return `${latest.val} (${latest.date})`;
    }
    return 'Not monitored';
  };

  return (
    <div className="bg-brand-blue rounded-card p-6 h-[560px] flex flex-col relative overflow-hidden transition-shadow duration-300 shadow-sm hover:shadow-md animate-fade-in-up">
      {/* Title */}
      <h3 className="font-headline-card text-[22px] font-extrabold text-on-surface mb-6 tracking-tight flex items-center gap-2">
        <span className="material-symbols-outlined text-[24px]">accessibility_new</span>
        Somatic Map
      </h3>

      <div className="flex-1 flex flex-col md:flex-row items-center gap-4 bg-black/5 rounded-2xl p-4 overflow-hidden backdrop-blur-sm border border-white/20 relative">
        {/* SVG Hologram Body outline */}
        <div className="relative w-36 h-72 flex-shrink-0 flex items-center justify-center">
          <svg width="100%" height="100%" viewBox="0 0 100 200" fill="none" className="opacity-80">
            {/* Silhouette */}
            <path 
              d="M 50 10 C 42 10 38 18 38 25 C 38 32 42 35 50 35 C 58 35 62 32 62 25 C 62 18 58 10 50 10 Z 
                 M 50 35 L 50 40 L 45 42 L 35 48 L 30 65 L 26 90 L 22 110 C 20 115 25 118 28 115 L 32 95 L 35 75 L 38 70 L 38 105 L 38 140 L 32 180 C 31 185 36 188 38 185 L 44 145 L 48 112 L 50 112 L 52 112 L 56 145 L 62 185 C 64 188 69 185 68 180 L 62 140 L 62 105 L 62 70 L 65 75 L 68 95 L 72 115 C 75 118 80 115 78 110 L 74 90 L 70 65 L 65 48 L 55 42 Z" 
              fill="rgba(26, 26, 26, 0.05)" 
              stroke="rgba(26, 26, 26, 0.25)" 
              strokeWidth="0.8" 
            />

            {/* Glowing Interactive Organs */}
            {ORGANS.map(organ => {
              const isSelected = selectedOrgan?.id === organ.id;
              const hasAlert = patient.bodyFlags?.some(f => f.toLowerCase() === organ.id);
              
              return (
                <g key={organ.id} className="cursor-pointer" onClick={() => handleOrganClick(organ)}>
                  {/* Pulse background */}
                  <circle
                    cx={organ.cx}
                    cy={organ.cy}
                    r={isSelected ? 6 : 4}
                    fill={organ.color}
                    className="animate-ping opacity-75"
                    style={{ animationDuration: hasAlert ? '1.5s' : '3s' }}
                  />
                  {/* Core Circle */}
                  <circle
                    cx={organ.cx}
                    cy={organ.cy}
                    r={isSelected ? 4.5 : 3.5}
                    fill={organ.color}
                    stroke="#ffffff"
                    strokeWidth={isSelected ? 1 : 0.5}
                    className="hover:scale-125 transition-transform"
                  />
                </g>
              );
            })}
          </svg>

          {/* Somatic labels list */}
          <div className="absolute top-0 left-0 flex flex-col gap-1 text-[9px] font-mono text-on-surface/60 uppercase">
            <span>SYS: SECURE</span>
            <span>HOLO: ACTIVE</span>
          </div>
        </div>

        {/* Floating AI Organ Health Summary Panel */}
        <div className="flex-1 flex flex-col gap-3 w-full self-stretch justify-center">
          {selectedOrgan ? (
            <div className="flex flex-col gap-2 p-3 bg-white/40 rounded-[12px] border border-white/30 flex-1 justify-center">
              <div className="flex justify-between items-start border-b border-black/10 pb-2 mb-1">
                <div>
                  <h4 className="text-xs font-extrabold text-on-surface uppercase">
                    {selectedOrgan.name} Assessment
                  </h4>
                  {/* Biomarkers */}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedOrgan.biomarkers.map(b => (
                      <span key={b} className="text-[9px] font-mono bg-black/5 px-1.5 py-0.5 rounded text-on-surface/70">
                        {b}: {getLatestBiomarker(b)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Risk score */}
                {organRisk !== null ? (
                  <GlowBadge 
                    label={`Risk: ${organRisk}%`} 
                    variant={organRisk > 60 ? 'critical' : organRisk > 30 ? 'warning' : 'good'} 
                  />
                ) : (
                  <span className="text-[10px] text-on-surface/80 animate-pulse font-bold">Running...</span>
                )}
              </div>

              {/* Streaming Summary */}
              <div className="text-[11px] text-on-surface/90 leading-relaxed bg-white/20 p-2.5 rounded border border-white/10 min-h-[120px] max-h-[160px] overflow-y-auto custom-scrollbar font-medium">
                <StreamingText text={organSummary || organSSE.data} active={organSSE.loading} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col justify-center items-center text-center p-4 border border-dashed border-black/20 rounded-[12px] flex-1 text-on-surface/70">
              <span className="text-2xl mb-2">🩺</span>
              <span className="text-xs font-extrabold">Somatic Analyzer</span>
              <span className="text-[10px] mt-1 opacity-80 leading-normal">Click glowing nodes on the somatic model to run organ-specific AI assessments.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BodyMapContext;
