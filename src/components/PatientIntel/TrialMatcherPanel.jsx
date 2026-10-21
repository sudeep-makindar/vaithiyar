import React, { useState, useEffect } from 'react';
import { BASE_API } from '../../config.js';

const TrialMatcherPanel = ({ patient, cachedTrials, setCachedTrials, isStandalone = false }) => {
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('Fetching trials from ClinicalTrials.gov...');
  const [error, setError] = useState(null);

  // Filters for inline view
  const [phaseFilter, setPhaseFilter] = useState('All');
  const [radiusFilter, setRadiusFilter] = useState('Nationwide');

  useEffect(() => {
    // If parent already has cached results for this patient, do nothing — no AI call
    if (cachedTrials[patient?.id] || !patient?.id) return;

    const fetchTrials = async () => {
      setLoading(true);
      setError(null);
      try {
        // Step 1: Browser fetches from ClinicalTrials.gov directly (no IP block on browsers)
        const diagnoses = patient.diagnosis || [];
        const query = diagnoses.join(' OR ');
        const ctUrl = new URL('https://clinicaltrials.gov/api/v2/studies');
        ctUrl.searchParams.set('query.cond', query);
        ctUrl.searchParams.set('filter.overallStatus', 'RECRUITING');
        ctUrl.searchParams.set('pageSize', '5');
        ctUrl.searchParams.set('format', 'json');

        setLoadingMsg('Fetching trials from ClinicalTrials.gov...');
        const ctRes = await fetch(ctUrl.toString(), {
          headers: { 'Accept': 'application/json' }
        });

        if (!ctRes.ok) throw new Error(`ClinicalTrials.gov returned ${ctRes.status}`);

        const ctData = await ctRes.json();
        const studies = ctData.studies || [];

        if (studies.length === 0) {
          setCachedTrials(prev => ({ ...prev, [patient.id]: [] }));
          return;
        }

        // Step 2: Send raw studies to backend for AI screening (Groq) (only called ONCE)
        setLoadingMsg(`AI screening ${studies.length} trials against patient profile...`);
        const res = await fetch(`${BASE_API}/trials/match/${patient.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studies })
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || 'AI screening failed');
        }

        const data = await res.json();
        // Store in parent cache keyed by patient ID — survives tab switching forever
        setCachedTrials(prev => ({ ...prev, [patient.id]: data.matches || [] }));
      } catch (err) {
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTrials();
  }, [patient?.id, cachedTrials]);

  const trials = cachedTrials[patient?.id] || [];

  // Filter trials based on selected filters (for inline tab view)
  const filteredTrials = trials.filter(t => {
    if (phaseFilter !== 'All') {
      const pNum = phaseFilter.replace('Phase ', '').trim();
      const matchesPhase = (t.phases || []).some(p => p.toLowerCase().includes(pNum.toLowerCase()));
      if (!matchesPhase) return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white rounded-[32px] border border-gray-150 animate-fade-in-up">
        <span className="material-symbols-outlined text-4xl text-brand-blue animate-spin">sync</span>
        <h3 className="mt-4 text-lg font-bold text-gray-700">Scanning ClinicalTrials.gov...</h3>
        <p className="text-sm text-gray-500 text-center max-w-xs">{loadingMsg}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-[32px] p-8 text-center text-red-600 animate-fade-in-up">
        <span className="material-symbols-outlined text-4xl mb-2">error</span>
        <h3 className="text-lg font-bold">Error matching trials</h3>
        <p className="text-sm opacity-80">{error}</p>
      </div>
    );
  }

  if (!trials || trials.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-[32px] p-12 text-center text-gray-500 animate-fade-in-up">
        <span className="material-symbols-outlined text-4xl mb-2 opacity-50">science</span>
        <h3 className="text-lg font-bold text-gray-700">No Trials Found</h3>
        <p className="text-sm">No active recruiting trials found for this patient's conditions.</p>
      </div>
    );
  }

  const getBadgeStyle = (eligible) => {
    switch (eligible?.toLowerCase()) {
      case 'likely':
        return { bg: 'bg-green-100', text: 'text-green-800', label: 'Likely Eligible', icon: 'check_circle' };
      case 'possible':
        return { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Review Needed', icon: 'info' };
      case 'unlikely':
      default:
        return { bg: 'bg-red-50', text: 'text-red-500', label: 'Low Match', icon: 'cancel' };
    }
  };

  if (isStandalone) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in-up">
        {/* Trials Overview & Matches */}
        <div className="flex justify-between items-end mb-2 mt-2">
          <h2 className="font-headline-card text-xl font-extrabold text-on-surface">Trial Matches</h2>
          <div className="text-right">
            <span className="font-display-metric text-4xl font-extrabold text-primary leading-none block">{trials.length}</span>
            <span className="font-label-sm text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Recruiting Trials</span>
          </div>
        </div>

        {/* Match Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {trials.map((trial, idx) => {
            const badge = getBadgeStyle(trial.eligible);
            
            // Map colors based on eligibility for the Stitch redesign
            let blobColor = 'bg-vibrant-green/10';
            let badgeStyle = 'bg-vibrant-green text-white';
            let phaseColor = 'bg-vibrant-green/20 text-vibrant-green';
            let iconName = 'check_circle';
            
            if (trial.eligible?.toLowerCase() === 'possible') {
              blobColor = 'bg-vibrant-yellow/10';
              badgeStyle = 'bg-vibrant-yellow text-on-secondary-container';
              phaseColor = 'bg-vibrant-yellow/20 text-on-secondary-container';
              iconName = 'warning';
            } else if (trial.eligible?.toLowerCase() === 'unlikely') {
              blobColor = 'bg-red-500/10';
              badgeStyle = 'bg-red-500 text-white';
              phaseColor = 'bg-red-500/20 text-red-650';
              iconName = 'cancel';
            }

            return (
              <div key={idx} className="bg-card-bg rounded-3xl p-6 shadow-sm border border-gray-150 relative overflow-hidden group hover:shadow-md transition-all">
                <div className={`absolute right-0 top-0 w-24 h-24 ${blobColor} rounded-bl-full -z-0`}></div>
                
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <div>
                    <div className="flex gap-1 flex-wrap">
                      {(trial.phases || []).map((p, i) => (
                        <span key={i} className={`px-2 py-0.5 rounded-md font-label-bold text-label-bold uppercase tracking-wider text-[9px] ${phaseColor}`}>
                          {p.replace('PHASE', 'Phase ')}
                        </span>
                      ))}
                    </div>
                    <h3 className="font-label-bold text-label-bold text-on-surface mt-2 text-[17px] font-extrabold">{trial.nctId}</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 line-clamp-2 leading-tight">{trial.briefTitle}</p>
                  </div>
                  
                  <div className={`px-3 py-1 rounded-full font-label-bold text-[10px] flex items-center gap-1 shrink-0 ${badgeStyle}`}>
                    <span className="material-symbols-outlined text-[14px]">{iconName}</span>
                    {badge.label}
                  </div>
                </div>

                <div className="border-t border-gray-150 pt-4 mt-4 relative z-10">
                  <p className="font-label-sm text-label-sm text-on-surface-variant mb-2">Match Reasons:</p>
                  <ul className="space-y-2">
                    {(trial.match_reasons || []).map((reason, i) => (
                      <li key={i} className="flex items-start gap-2 font-body-sm text-[13px] text-on-surface">
                        <span className="material-symbols-outlined text-vibrant-green text-[18px]">check</span>
                        <span className="leading-snug">{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {trial.disqualifiers && trial.disqualifiers.length > 0 && (
                  <div className="border-t border-gray-150 pt-4 mt-4 relative z-10">
                    <p className="font-label-sm text-label-sm text-on-surface-variant mb-2">Potential Disqualifiers:</p>
                    <ul className="space-y-2">
                      {trial.disqualifiers.map((disq, i) => (
                        <li key={i} className="flex items-start gap-2 font-body-sm text-[13px] text-on-surface">
                          <span className="material-symbols-outlined text-red-500 text-[18px]">close</span>
                          <span className="leading-snug">{disq}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-6 pt-4 border-t border-gray-150 flex justify-between items-center relative z-10">
                  {/* Preserved redirection link to ClinicalTrials.gov */}
                  <a 
                    href={`https://clinicaltrials.gov/study/${trial.nctId}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[13px] font-bold text-brand-blue hover:text-blue-700 transition-colors"
                  >
                    View on ClinicalTrials.gov
                    <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                  </a>
                  <button className="bg-primary text-on-primary font-label-bold text-xs py-2 px-4 rounded-full hover:bg-surface-tint transition-colors">
                    Review Trial
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Decorative / AI Insight Area */}
        <div className="bg-dark-blue rounded-3xl p-6 mt-2 relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="absolute left-0 top-0 w-32 h-32 stitch-blob-blue bg-vibrant-blue/20 -z-0"></div>
          <div className="relative z-10 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-vibrant-blue shrink-0">
              <span className="material-symbols-outlined">auto_awesome</span>
            </div>
            <div>
              <h4 className="font-label-bold text-label-bold text-white text-lg font-bold">AI Insight</h4>
              <p className="font-body-sm text-body-sm text-white/70">Based on recent lab results, patient shows strong affinity for Trial matches.</p>
            </div>
          </div>
          <button className="relative z-10 bg-vibrant-blue text-dark-blue font-label-bold text-xs font-bold px-5 py-2.5 rounded-full hover:opacity-90 transition-opacity whitespace-nowrap self-start sm:self-auto">
            Generate Report
          </button>
        </div>
      </div>
    );
  }  // Render Redesigned Inline Patient Profile Trial Matches (Vibrant Color-Blocked)
  return (
    <div className="flex flex-col gap-6 animate-fade-in-up w-full">
      {/* Overview Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Metric Card - Explicitly Yellow Color-Blocked */}
        <div 
          className="relative overflow-hidden rounded-[24px] p-6 shadow-sm border flex flex-col justify-between min-h-[120px]"
          style={{ backgroundColor: '#ffe08f', color: '#241a00', borderColor: 'rgba(253, 207, 73, 0.2)' }}
        >
          <div 
            className="absolute -right-5 -bottom-5 w-36 h-36 rounded-full opacity-35 z-0"
            style={{ backgroundColor: '#fdcf49' }}
          ></div>
          <p className="font-label-bold text-xs font-black uppercase tracking-wider relative z-10 opacity-85">ACTIVE RECRUITING TRIALS</p>
          <div className="font-display-metric text-4xl font-extrabold relative z-10 flex items-baseline gap-2 mt-2">
            {trials.length}
            <span className="text-sm font-normal opacity-80 font-sans">Matches</span>
          </div>
        </div>

        {/* Filter/Action Card */}
        <div className="md:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/70 backdrop-blur-md rounded-[24px] p-6 border border-gray-150 shadow-sm relative overflow-hidden">
          <div className="flex gap-4 flex-wrap z-10">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-wider mb-1.5">Location Radius</span>
              <select 
                value={radiusFilter}
                onChange={(e) => setRadiusFilter(e.target.value)}
                className="bg-white border border-gray-250 rounded-full py-1.5 px-4 text-xs font-bold focus:ring-2 focus:ring-primary outline-none"
              >
                <option>50 Miles</option>
                <option>100 Miles</option>
                <option>Nationwide</option>
              </select>
            </div>
            
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-wider mb-1.5">Phase Focus</span>
              <select 
                value={phaseFilter}
                onChange={(e) => setPhaseFilter(e.target.value)}
                className="bg-white border border-gray-250 rounded-full py-1.5 px-4 text-xs font-bold focus:ring-2 focus:ring-primary outline-none"
              >
                <option value="All">All Phases</option>
                <option value="Phase 1">Phase I</option>
                <option value="Phase 2">Phase II</option>
                <option value="Phase 3">Phase III</option>
              </select>
            </div>
          </div>
          
          <button className="bg-[#1A1A1A] text-white rounded-full py-2.5 px-6 text-xs font-bold flex items-center gap-2 hover:bg-opacity-80 transition-opacity z-10 self-start sm:self-auto">
            <span className="material-symbols-outlined text-[16px]">filter_list</span>
            Advanced Filters
          </button>
        </div>
      </div>

      {/* Trial List */}
      <div className="flex flex-col gap-4">
        {filteredTrials.length === 0 ? (
          <div className="bg-white/60 border border-gray-150 rounded-[24px] p-12 text-center text-gray-500">
            <span className="material-symbols-outlined text-4xl mb-2 opacity-50">search_off</span>
            <h3 className="text-lg font-bold text-gray-700">No Matching Trials</h3>
            <p className="text-sm">No trials match the selected filter parameters.</p>
          </div>
        ) : (
          filteredTrials.map((trial, idx) => {
            const badge = getBadgeStyle(trial.eligible);
            
            let statusBadgeClass = 'bg-[#e6f4ea] text-[#137333] border border-[#137333]/10';
            let leftBorderColor = '#137333'; // Color block left border
            let iconName = 'check_circle';
            
            if (trial.eligible?.toLowerCase() === 'possible') {
              statusBadgeClass = 'bg-[#fef7e0] text-[#b06000] border border-[#b06000]/10';
              leftBorderColor = '#b06000';
              iconName = 'pending';
            } else if (trial.eligible?.toLowerCase() === 'unlikely') {
              statusBadgeClass = 'bg-red-50 text-red-650 border border-red-555/15';
              leftBorderColor = '#ba1a1a';
              iconName = 'cancel';
            }

            return (
              <div 
                key={idx} 
                className="bg-white/70 backdrop-blur-md border border-gray-150 rounded-[24px] p-6 flex flex-col md:flex-row gap-6 hover:shadow-lg transition-all duration-300 relative overflow-hidden"
                style={{ borderLeft: `6px solid ${leftBorderColor}` }}
              >
                
                {/* Left side details */}
                <div className="flex-1 min-w-0 z-10">
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 ${statusBadgeClass}`}>
                      <span className="material-symbols-outlined text-[14px]">{iconName}</span>
                      {badge.label}
                    </span>
                    {(trial.phases || []).map((p, i) => (
                      <span key={i} className="text-[10px] font-bold text-on-surface-variant bg-gray-100 py-1 px-2.5 rounded-md uppercase">
                        {p.replace('PHASE', 'Phase ')}
                      </span>
                    ))}
                    <span className="text-[10px] font-mono font-bold text-on-surface-variant bg-gray-100 py-1 px-2.5 rounded-md">
                      {trial.nctId}
                    </span>
                  </div>
                  
                  <h3 className="text-lg font-extrabold text-on-surface mb-2 leading-tight">
                    {trial.briefTitle}
                  </h3>
                  
                  {/* Preserved summary text */}
                  <p className="text-xs text-on-surface-variant mb-4 leading-relaxed max-w-2xl">
                    {trial.briefSummary || "A clinical investigation evaluating the therapeutic safety and physiological response profile of this regimen."}
                  </p>
                  
                  <div className="flex gap-4 items-center mt-4 flex-wrap">
                    {/* Preserved redirection link to ClinicalTrials.gov */}
                    <a 
                      className="text-brand-blue font-bold text-xs flex items-center gap-1 hover:underline" 
                      href={`https://clinicaltrials.gov/study/${trial.nctId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View on ClinicalTrials.gov
                      <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    </a>
                    <span className="text-on-surface-variant text-[11px] font-bold">
                      • Distance: {radiusFilter === '50 Miles' ? '12 mi' : radiusFilter === '100 Miles' ? '45 mi' : 'Nationwide'}
                    </span>
                  </div>
                </div>

                {/* Right side match reasons container - Explicitly Color-Blocked Box */}
                <div 
                  className="w-full md:w-64 rounded-xl p-4 shrink-0 z-10 border"
                  style={{ backgroundColor: '#f5f4f0', borderColor: '#e9e8e4' }}
                >
                  <h4 className="text-[10px] font-black text-on-surface mb-3 uppercase tracking-wider">
                    Match Reasons
                  </h4>
                  <ul className="flex flex-col gap-2">
                    {(trial.match_reasons || []).slice(0, 3).map((reason, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-on-surface leading-tight">
                        <span className="material-symbols-outlined text-[16px] text-[#137333] shrink-0">check</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                    {(!trial.match_reasons || trial.match_reasons.length === 0) && (
                      <li className="text-xs text-gray-400 italic">No matches mapped.</li>
                    )}
                  </ul>
                  
                  {trial.disqualifiers && trial.disqualifiers.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-gray-100">
                      <h4 className="text-[9px] font-black text-red-550 mb-2 uppercase tracking-wider">
                        Alert Checks
                      </h4>
                      <ul className="flex flex-col gap-2">
                        {trial.disqualifiers.slice(0, 2).map((disq, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant leading-tight">
                            <span className="material-symbols-outlined text-[16px] text-red-500 shrink-0">warning</span>
                            <span className="text-[11px]">{disq}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TrialMatcherPanel;
