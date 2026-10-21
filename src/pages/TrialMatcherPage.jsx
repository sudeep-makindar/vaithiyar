import React, { useState, useEffect } from 'react';
import TopHeader from '../components/TopHeader';
import TrialMatcherPanel from '../components/PatientIntel/TrialMatcherPanel';
import { usePatientStore } from '../stores/patientStore';

const TrialMatcherPage = () => {
  const { patients, currentPatient, setCurrentPatient, cachedTrials, setCachedTrials } = usePatientStore();
  
  // Local state for search query
  const [searchQuery, setSearchQuery] = useState('');
  
  // Local state for selected patient ID (defaults to currentPatient if exists)
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (currentPatient && !selectedId) {
      setSelectedId(currentPatient.id);
    } else if (!currentPatient && patients.length > 0 && !selectedId) {
      setSelectedId(patients[0].id);
    }
  }, [currentPatient, patients]);

  const selectedPatient = patients.find(p => p.id === selectedId);

  // Filter patients based on search query
  const filteredPatients = patients.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.diagnosis && p.diagnosis.some(d => d.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  const handlePatientSelect = (p) => {
    setSelectedId(p.id);
    setCurrentPatient(p); // keeps the global active patient in sync
  };

  return (
    <div className="flex flex-col min-h-screen bg-transparent text-on-surface">
      <TopHeader />
      
      <div className="flex-grow px-4 md:px-8 pb-8 w-full max-w-[1600px] mx-auto font-sans">
        
        {/* Header Intro Card - EXACT TEXT PRESERVED */}
        <div className="mb-8 animate-fade-in-up">
          <h2 className="text-2xl md:text-[32px] font-extrabold text-brand-sidebar mb-2 tracking-tight leading-tight">
            AI Trial Matcher
          </h2>
          <p className="text-sm md:text-base text-gray-500 max-w-4xl leading-relaxed">
            Scan and evaluate matching active clinical trials from ClinicalTrials.gov. Patient clinical indicators, 
            biometrics, and history are cross-referenced using AI (Groq) to check eligibility and identify disqualifiers.
          </p>
        </div>

        {/* Layout Wrapper */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Side: Patient Selector (Full-width on mobile when no patient selected) */}
          <div className={`col-span-1 lg:col-span-4 bg-white/70 backdrop-blur-md border border-gray-150 rounded-[28px] p-6 shadow-sm flex flex-col lg:sticky lg:top-6 lg:h-[calc(100vh-140px)] min-h-[450px] ${
            selectedId ? 'hidden lg:flex' : 'flex'
          }`}>
            
            <div className="flex justify-between items-end mb-4">
              <h2 className="font-headline-card text-lg font-extrabold text-on-surface">Patient List</h2>
              <button className="flex items-center gap-1 text-on-surface-variant bg-surface-container-high px-3 py-1 rounded-full text-xs font-bold">
                Today <span className="material-symbols-outlined text-[16px]">expand_more</span>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative mb-6">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-[20px]">
                search
              </span>
              <input
                type="text"
                placeholder="Search patients, conditions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white border border-gray-200 focus:outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10 text-sm transition-all"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black font-extrabold text-sm"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Scrollable Patient List */}
            <div className="flex-grow overflow-y-auto pr-1 flex flex-col gap-3 custom-scrollbar">
              {filteredPatients.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <span className="material-symbols-outlined text-3xl mb-1.5 opacity-55">group_off</span>
                  <p className="text-xs font-bold">No patients match your search</p>
                </div>
              ) : (
                filteredPatients.map((p) => {
                  const isSelected = p.id === selectedId;
                  
                  // Vibrant Pro redesign mapping: uses alternate theme card layouts
                  let themeClass = isSelected 
                    ? 'bg-vibrant-pink/20 border-vibrant-pink/30 relative overflow-hidden group' 
                    : 'bg-card-bg hover:bg-surface-container-high hover:scale-[1.01] transition-all border border-gray-150';
                  
                  let avatarClass = isSelected
                    ? 'bg-white/50 text-vibrant-pink'
                    : 'bg-vibrant-blue/20 text-vibrant-blue';

                  return (
                    <div
                      key={p.id}
                      onClick={() => handlePatientSelect(p)}
                      className={`rounded-2xl p-4 flex items-center gap-4 cursor-pointer select-none transition-all ${themeClass}`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${avatarClass}`}>
                        <span className="material-symbols-outlined">person</span>
                      </div>
                      
                      <div className="flex-1 min-w-0 z-10">
                        <h3 className="font-label-bold text-[14px] font-extrabold text-on-surface truncate">{p.name}</h3>
                        <p className="font-label-sm text-[11px] text-on-surface-variant mt-0.5 truncate uppercase tracking-wider font-mono">
                          {p.diagnosis && p.diagnosis.length > 0 ? p.diagnosis[0] : 'Review Needed'}
                        </p>
                      </div>

                      <div className="bg-white/60 px-2.5 py-1 rounded-full text-[10px] font-extrabold text-on-surface z-10 shrink-0 border border-black/5">
                        {p.riskScore}% Risk
                      </div>
                      
                      {/* Decorative pink blob on active screen element */}
                      {isSelected && (
                        <div className="absolute -right-4 -bottom-4 w-16 h-16 bg-vibrant-pink/30 rounded-full opacity-50 pointer-events-none"></div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Side: Trial Matches Panel */}
          <div className={`col-span-1 lg:col-span-8 flex flex-col ${
            selectedId ? 'flex' : 'hidden lg:flex'
          }`}>
            {selectedPatient ? (
              <div className="flex flex-col h-full bg-transparent">
                
                {/* Mobile Back Button */}
                <div className="lg:hidden mb-4">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-150 text-brand-sidebar font-extrabold text-xs uppercase tracking-wider shadow-sm active:scale-95 transition-all"
                  >
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                    Back to Patient List
                  </button>
                </div>

                {/* Stitch Redesigned Hero Header Overview */}
                <div className="bg-vibrant-pink/10 rounded-3xl p-8 mb-6 relative overflow-hidden flex flex-col justify-between min-h-[200px] border border-vibrant-pink/15 shadow-sm animate-fade-in-up">
                  {/* Decorative Elements */}
                  <div className="absolute -right-12 -top-12 w-48 h-48 stitch-blob-pink opacity-40"></div>
                  <div className="absolute right-24 bottom-4 w-12 h-12 stitch-blob-star opacity-30"></div>
                  
                  <div className="z-10 flex flex-col md:flex-row justify-between items-start gap-4">
                    <div>
                      <p className="font-label-bold text-[10px] font-black text-on-surface-variant uppercase tracking-wider mb-2">Patient Details</p>
                      <h2 className="text-3xl font-extrabold text-on-surface tracking-tight">{selectedPatient.name}</h2>
                      <p className="font-body-sm text-sm text-on-surface-variant mt-1">
                        {selectedPatient.gender} • {selectedPatient.age} Years • ID: {selectedPatient.id}
                      </p>
                    </div>
                    
                    <div className="bg-white rounded-2xl p-3 shadow-sm flex items-center gap-3 border border-vibrant-pink/10 shrink-0">
                      <div className="w-12 h-12 rounded-full border-4 border-vibrant-pink flex items-center justify-center font-bold text-sm text-on-surface">
                        {selectedPatient.riskScore}%
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-on-surface-variant leading-none uppercase">Risk Score</p>
                        <p className="text-xs font-black text-on-surface mt-1 uppercase tracking-wider">
                          {selectedPatient.riskScore >= 70 ? 'High Alert' : 'Stable'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="z-10 mt-6 flex flex-wrap gap-2">
                    {(selectedPatient.diagnosis || []).map((diag, i) => (
                      <span key={i} className="bg-white px-3.5 py-1.5 rounded-full text-xs font-bold text-vibrant-pink border border-vibrant-pink/20 shadow-sm flex items-center gap-1.5 uppercase tracking-wide">
                        <span className="material-symbols-outlined text-[15px]">pill</span> {diag}
                      </span>
                    ))}
                    <span className="bg-white px-3.5 py-1.5 rounded-full text-xs font-bold text-vibrant-blue border border-vibrant-blue/20 shadow-sm flex items-center gap-1.5 uppercase tracking-wide">
                      <span className="material-symbols-outlined text-[15px]">bloodtype</span> Biomarker Checked
                    </span>
                  </div>
                </div>

                {/* Standalone Trial Match List */}
                <div className="w-full">
                  <TrialMatcherPanel 
                    patient={selectedPatient} 
                    cachedTrials={cachedTrials} 
                    setCachedTrials={setCachedTrials} 
                    isStandalone={true}
                  />
                </div>

              </div>
            ) : (
              // Glassmorphic Placeholder
              <div className="flex-grow flex items-center justify-center bg-white/40 backdrop-blur-md border border-gray-150 rounded-[28px] p-8 text-center h-full shadow-sm animate-fade-in-up">
                <div className="max-w-md p-8 flex flex-col items-center">
                  <div className="w-16 h-16 rounded-full bg-brand-blue/10 border border-brand-blue/15 flex items-center justify-center text-brand-blue mb-4 shadow-sm animate-pulse">
                    <span className="material-symbols-outlined text-[32px]">science</span>
                  </div>
                  <h3 className="text-xl font-extrabold text-brand-sidebar">AI Clinical Trial Scanner</h3>
                  <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                    Select a patient from the patient list to trigger live fetching and AI evaluation of matching clinical trials.
                  </p>
                </div>
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};

export default TrialMatcherPage;
