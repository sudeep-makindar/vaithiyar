import React, { useState } from 'react';
import useSSEStream from '../../hooks/useSSEStream';
import StreamingText from '../ui/StreamingText';
import { BASE_API } from '../../config.js';

const AlertCard = ({ alert, isAcknowledged, onAck, colorIndex }) => {
  const { data, loading, startStream } = useSSEStream();
  const [showExplain, setShowExplain] = useState(false);

  const handleExplain = async () => {
    setShowExplain(true);
    if (data) return;
    
    try {
      await startStream(`${BASE_API}/alerts/explain`, {
        alert_id: alert.id,
        patient_id: alert.patientId,
        description: alert.description
      });
    } catch (err) {
      console.error("Failed to fetch explanation:", err);
    }
  };

  // Cycle themes: 0=pink(HIGH), 1=yellow(MEDIUM), 2=blue(LOW)
  const cycledSeverity = colorIndex !== undefined
    ? ['HIGH', 'MEDIUM', 'LOW'][colorIndex % 3]
    : alert.severity;

  let theme = {
    bg: 'bg-[#a6d1e6]',
    border: 'border-[#8cb6cc]/60',
    text: 'text-[#0d47a1]',
    textLight: 'text-[#0d47a1]/80',
    tag: 'bg-white/40 text-[#0d47a1]',
    urgency: 'bg-[#0d47a1] text-[#a6d1e6]',
    dot: 'bg-[#0d47a1] shadow-[0_0_8px_rgba(13,71,161,0.4)]',
    descBg: 'bg-white/30 border-white/20 text-[#0d47a1]',
    ackBtn: 'bg-[#0d47a1] text-white hover:opacity-95',
    explainBtn: 'bg-white/40 text-[#0d47a1] border border-white/30 hover:bg-white/50 backdrop-blur-sm',
    blob: (
      <svg className="absolute -right-8 -bottom-8 w-60 h-60 opacity-20 text-[#0288d1] pointer-events-none fill-current z-0" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <path d="M51.9,-65.4C66.1,-54.3,75.4,-36.5,78.8,-18.2C82.2,0.1,79.7,18.9,71.1,34.8C62.5,50.7,47.8,63.7,31.2,71.2C14.6,78.7,-3.9,80.7,-21.2,76C-38.5,71.3,-54.6,59.9,-66.5,45C-78.4,30.1,-86.1,11.7,-85.4,-6.2C-84.7,-24.1,-75.6,-41.5,-61.7,-52.7C-47.8,-63.9,-29.1,-68.9,-11.4,-70.7C6.3,-72.5,23.9,-71.1,37.7,-66.6L51.9,-65.4Z" transform="translate(100 100)"></path>
      </svg>
    )
  };

  if (cycledSeverity === 'HIGH') {
    theme = {
      bg: 'bg-[#ffb0cc]',
      border: 'border-[#ff88b2]/60',
      text: 'text-[#39071f]',
      textLight: 'text-[#39071f]/80',
      tag: 'bg-white/40 text-[#39071f]',
      urgency: 'bg-[#39071f] text-white',
      dot: 'bg-[#39071f] shadow-[0_0_8px_rgba(57,7,31,0.4)]',
      descBg: 'bg-white/30 border-white/20 text-[#39071f]',
      ackBtn: 'bg-[#39071f] text-white hover:opacity-95',
      explainBtn: 'bg-white/40 text-[#39071f] border border-white/30 hover:bg-white/50 backdrop-blur-sm',
      blob: (
        <svg className="absolute -right-10 -bottom-10 w-64 h-64 opacity-20 text-[#e91e63] pointer-events-none fill-current z-0" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <path d="M42.7,-73.4C56.3,-65.4,69.1,-55.8,77.6,-43.3C86.1,-30.8,90.3,-15.4,89.5,-0.5C88.6,14.5,82.8,29,74.2,41.4C65.5,53.8,54.1,64.2,40.8,71.5C27.5,78.8,13.8,83.1,-0.6,84.1C-15.1,85.1,-30.2,82.8,-43.2,75.4C-56.2,67.9,-67.2,55.3,-75.4,40.9C-83.6,26.5,-89.1,10.3,-88.4,-5.4C-87.8,-21.2,-81.1,-36.5,-71.1,-48.9C-61.1,-61.2,-47.9,-70.6,-33.9,-77.8C-19.9,-85.1,-5,-90.3,8.7,-88.3C22.3,-86.3,44.7,-77.1,42.7,-73.4Z" transform="translate(100 100)"></path>
        </svg>
      )
    };
  } else if (cycledSeverity === 'MEDIUM') {
    theme = {
      bg: 'bg-[#fdcf49]',
      border: 'border-[#eec13c]/60',
      text: 'text-[#715800]',
      textLight: 'text-[#715800]/80',
      tag: 'bg-white/40 text-[#715800]',
      urgency: 'bg-[#715800] text-[#fdcf49]',
      dot: 'bg-[#715800] shadow-[0_0_8px_rgba(113,88,0,0.4)]',
      descBg: 'bg-white/30 border-white/20 text-[#715800]',
      ackBtn: 'bg-[#715800] text-white hover:opacity-95',
      explainBtn: 'bg-white/40 text-[#715800] border border-white/30 hover:bg-white/50 backdrop-blur-sm',
      blob: (
        <svg className="absolute -right-4 -top-10 w-56 h-56 opacity-20 text-[#ff9800] pointer-events-none fill-current z-0" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <path d="M46.4,-75.4C59.9,-67.2,70.5,-52.8,77.3,-37.2C84.1,-21.5,87.2,-4.5,84.1,11.3C80.9,27.1,71.5,41.7,59.2,52.9C46.8,64.1,31.6,71.9,15.6,76.5C-0.3,81.1,-16.9,82.5,-31.6,77.3C-46.3,72.1,-59,60.2,-68.8,46.5C-78.6,32.8,-85.4,17.2,-86,-0.3C-86.7,-17.8,-81.1,-35.6,-70.7,-48.9C-60.3,-62.2,-45.1,-71,-30.3,-76.3C-15.5,-81.6,-1.2,-83.4,14,-80.7C29.2,-78,44.4,-70.8,46.4,-75.4Z" transform="translate(100 100)"></path>
        </svg>
      )
    };
  }

  const urgency = alert.urgency_score || 5;

  return (
    <div 
      className={`transition-all duration-300 ${
        isAcknowledged ? 'opacity-40 scale-[0.99]' : 'scale-100'
      }`}
    >
      <div 
        className={`${theme.bg} border ${theme.border} rounded-[32px] p-8 relative overflow-hidden flex flex-col gap-5 shadow-sm hover:shadow-md transition-shadow`}
      >
        {/* Decorative Blob */}
        {theme.blob}

        {/* Top Header Row */}
        <div className="flex justify-between items-start gap-4 relative z-10">
          
          {/* Left info */}
          <div className="flex items-start gap-4">
            <div className={`w-3.5 h-3.5 rounded-full mt-2.5 shrink-0 ${theme.dot}`} />
            <div>
              <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                <h3 className={`text-[24px] font-bold ${theme.text} tracking-tight`}>{alert.patientName}</h3>
                <span className={`px-3 py-1 rounded-full font-label-bold text-[10px] uppercase tracking-wider font-bold ${theme.tag}`}>
                  {alert.type || 'Clinical'}
                </span>
              </div>
              <p className={`text-xs font-medium ${theme.textLight}`}>
                ID: {alert.patientId} • Outpatient
              </p>
            </div>
          </div>

          {/* Right urgency score */}
          <div className="flex flex-col items-end">
            <span className={`px-5 py-2 rounded-full font-display-metric text-[32px] font-extrabold tracking-tight shadow-sm ${theme.urgency}`}>
              {urgency}
            </span>
            <span className={`text-[10px] font-bold mt-1.5 ${theme.text}`}>
              Urgency Score
            </span>
          </div>

        </div>

        {/* Description Box */}
        <div className={`rounded-2xl p-5 border relative z-10 backdrop-blur-sm text-[16px] leading-relaxed font-medium ${theme.descBg}`}>
          {alert.description}
        </div>

        {/* Action Buttons */}
        {!isAcknowledged && (
          <div className="flex gap-4 mt-2 relative z-10">
            <button
              onClick={() => onAck(alert.id)}
              className={`px-8 py-3 rounded-full font-label-bold text-[13px] transition-all hover:-translate-y-0.5 hover:shadow-md flex-1 cursor-pointer ${theme.ackBtn}`}
            >
              Acknowledge
            </button>
            <button
              onClick={handleExplain}
              className={`px-8 py-3 rounded-full font-label-bold text-[13px] transition-all hover:-translate-y-0.5 hover:shadow-md flex-1 cursor-pointer ${theme.explainBtn}`}
            >
              {loading ? 'Analyzing...' : 'Explain AI Reasoning'}
            </button>
          </div>
        )}

        {isAcknowledged && (
          <div className={`text-xs font-black tracking-wider uppercase font-mono mt-1 flex items-center gap-1.5 relative z-10 ${theme.text}`}>
            <span className="material-symbols-outlined text-sm font-bold">check_circle</span>
            Archived Clinical Event
          </div>
        )}

        {/* Explain text drawer */}
        {showExplain && (
          <div className={`rounded-2xl p-5 border relative z-10 backdrop-blur-sm text-xs leading-relaxed mt-3 ${theme.descBg}`}>
            <div className="text-[9px] font-black tracking-wider uppercase font-mono mb-1.5 opacity-80">
              ClinIQ+ Diagnostic Inference
            </div>
            {data ? (
              <StreamingText text={data} active={loading} />
            ) : (
              <span className="animate-pulse font-bold">Querying clinical decision model...</span>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default AlertCard;
