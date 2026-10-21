import React, { useState, useEffect } from 'react';
import { useUserStore } from '../stores/userStore';
import { useNavigate } from 'react-router-dom';
import TopHeader from '../components/TopHeader';
import { usePatientStore } from '../stores/patientStore';
import CalendarSidebar from '../components/CalendarSidebar';
import { fetchDashboardSummary } from '../api';
import { greeting } from '../utils/time';

const Overview = () => {
  const navigate = useNavigate();
  const { doctorName } = useUserStore();
  const { patients, currentPatient, setCurrentPatient } = usePatientStore();
  const [selectedPatientId, setSelectedPatientId] = useState(
    currentPatient ? currentPatient.id : (patients[0] ? patients[0].id : null)
  );

  const activePatient = patients.find(p => p.id === selectedPatientId) || patients[0] || null;

  // Live summary computed by the backend from patient alerts and the physician's schedule
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetchDashboardSummary().then(s => alive && s && setSummary(s));
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [patients]);
  const sev = summary?.alerts_by_severity || {};
  const eventsToday = summary?.events_today ?? 0;
  const nextEvent = summary?.next_event;

  // Highest-risk patients first, as a clinician would triage
  const triagedPatients = [...patients].sort((a, b) => b.riskScore - a.riskScore);
  const rowLabel = (p) => {
    const top = (p.clinicalPatterns || []).find(a => a.severity === 'HIGH');
    if (p.riskScore >= 70) return top ? top.type : 'Critical Review';
    if (p.riskScore > 50) return 'Follow-up Due';
    return 'Routine Check-Up';
  };

  const handlePatientSelect = (patient) => {
    setSelectedPatientId(patient.id);
    setCurrentPatient(patient);
  };

  const handlePatientNavigate = (patientId) => {
    navigate(`/patient/${patientId}`);
  };

  // Compute stats
  const totalPatients = patients.length;
  const criticalPatients = patients.filter(p => p.riskScore >= 70).length;
  const stablePatients = patients.filter(p => p.riskScore <= 50).length;
  const fairPatients = totalPatients - criticalPatients - stablePatients;

  const avgRisk = totalPatients > 0 
    ? Math.round(patients.reduce((sum, p) => sum + p.riskScore, 0) / totalPatients) 
    : 0;
  const maxRisk = totalPatients > 0 ? Math.max(...patients.map(p => p.riskScore)) : 0;
  const minRisk = totalPatients > 0 ? Math.min(...patients.map(p => p.riskScore)) : 0;

  return (
    <div className="flex flex-col min-h-screen bg-transparent">
      <TopHeader />

      <div className="flex-1 px-4 md:px-8 pb-8 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto">
          
          {/* Hero Header */}
          <div className="mb-8 animate-fade-in-up">
            <h1 className="text-3xl md:text-[40px] font-extrabold text-brand-sidebar tracking-tight leading-tight md:leading-none">
              {greeting()}, {doctorName}
            </h1>
            <p className="text-sm md:text-base text-gray-500 max-w-2xl mt-2 font-medium">
              {totalPatients} patients under your care, {criticalPatients} need urgent review. {summary ? `${summary.alerts_24h} new alerts in the last 24 hours and ${eventsToday} ${eventsToday === 1 ? 'event' : 'events'} on today's schedule${nextEvent ? ` (next: ${nextEvent.time} ${nextEvent.title})` : ''}.` : 'Syncing live alerts…'}
            </p>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            
            {/* Left/Center Column (8/12) */}
            <div className="xl:col-span-8 flex flex-col gap-6">
              
              {/* 2x2 Metric Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Card 1: Patients (Yellow) */}
                <div className="bg-brand-yellow rounded-card p-6 relative overflow-hidden h-64 flex flex-col flat-look animate-fade-in-up">
                  <h3 className="font-extrabold text-2xl text-brand-sidebar mb-6 z-10">Patients:</h3>
                  <div className="flex gap-8 mb-auto z-10">
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-[40px] block text-brand-sidebar tracking-tight leading-none">
                        {totalPatients} <span className="text-lg font-bold">pers</span>
                      </span>
                      <span className="text-[10px] opacity-70 tracking-wider mt-1 uppercase font-bold">Current</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-[40px] block text-brand-sidebar tracking-tight leading-none">
                        {criticalPatients} <span className="text-lg font-bold">pers</span>
                      </span>
                      <span className="text-[10px] opacity-70 tracking-wider mt-1 uppercase font-bold">Critical</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-[40px] block text-brand-sidebar tracking-tight leading-none">
                        {stablePatients} <span className="text-lg font-bold">pers</span>
                      </span>
                      <span className="text-[10px] opacity-70 tracking-wider mt-1 uppercase font-bold">Stable</span>
                    </div>
                  </div>
                  {/* Styled Bar Chart Minimal */}
                  <div className="flex items-end gap-3 h-20 z-10 mt-4 px-2">
                    <div className="w-3 bg-black rounded-full h-[40%]"></div>
                    <div className="w-3 bg-black rounded-full h-[70%]"></div>
                    <div className="w-3 bg-black rounded-full h-[30%]"></div>
                    <div className="w-3 bg-black rounded-full h-[90%]"></div>
                    <div className="w-3 bg-black rounded-full h-[50%]"></div>
                    <div className="w-3 bg-black rounded-full h-[80%]"></div>
                    <div className="w-3 bg-black rounded-full h-[60%]"></div>
                  </div>
                  {/* Decorative Cross Blob */}
                  <svg className="absolute blob-shape w-48 h-48 -top-8 -right-8 opacity-20" fill="black" viewBox="0 0 100 100">
                    <path d="M40 20 h20 v20 h20 v20 h-20 v20 h-20 v-20 h-20 v-20 h20 z" rx="4" ry="4"></path>
                  </svg>
                </div>

                {/* Card 2: Risk Summary (Pink) */}
                <div className="bg-brand-pink rounded-card p-6 relative overflow-hidden h-64 flex flex-col flat-look animate-fade-in-up">
                  <div className="flex justify-between items-start z-10 mb-6">
                    <h3 className="font-extrabold text-2xl text-brand-sidebar">Risk summary:</h3>
                    <span className="text-xs font-bold cursor-pointer hover:opacity-70 transition-opacity">Show all ...</span>
                  </div>
                  <div className="flex gap-8 mb-auto z-10">
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-[40px] block text-brand-sidebar tracking-tight leading-none">
                        {avgRisk}% <span className="text-lg font-bold">avg</span>
                      </span>
                      <span className="text-[10px] opacity-70 tracking-wider mt-1 uppercase font-bold">Average</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-[40px] block text-brand-sidebar tracking-tight leading-none">
                        {maxRisk} <span className="text-lg font-bold">max</span>
                      </span>
                      <span className="text-[10px] opacity-70 tracking-wider mt-1 uppercase font-bold">Maximum</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-[40px] block text-brand-sidebar tracking-tight leading-none">
                        {minRisk} <span className="text-lg font-bold">min</span>
                      </span>
                      <span className="text-[10px] opacity-70 tracking-wider mt-1 uppercase font-bold">Minimum</span>
                    </div>
                  </div>
                  {/* Smooth Sparkline Minimal */}
                  <div className="w-full h-20 z-10 mt-4 relative">
                    <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 40">
                      <path d="M0,30 C20,25 30,35 50,20 C70,5 80,15 100,25" fill="none" stroke="black" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                      <circle cx="50" cy="20" fill="black" r="3"></circle>
                      <circle cx="100" cy="25" fill="black" r="3"></circle>
                    </svg>
                  </div>
                  {/* Decorative Heart Blob */}
                  <svg className="absolute blob-shape w-32 h-32 right-0 top-10 opacity-20" fill="black" viewBox="0 0 100 100">
                    <path d="M50 80 C 10 50, 10 20, 30 10 C 45 5, 50 20, 50 20 C 50 20, 55 5, 70 10 C 90 20, 90 50, 50 80 Z"></path>
                  </svg>
                </div>

                {/* Card 3: By Condition (Olive) */}
                <div className="bg-brand-green rounded-card p-6 relative overflow-hidden h-40 flex flex-col justify-center flat-look animate-fade-in-up">
                  <h3 className="font-extrabold text-2xl text-brand-sidebar mb-4 z-10">By condition:</h3>
                  <div className="flex gap-10 z-10">
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-2xl block text-brand-sidebar tracking-tight leading-none">{stablePatients} pers</span>
                      <span className="text-[10px] font-bold opacity-70 uppercase tracking-wider mt-1">Stable</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-2xl block text-brand-sidebar tracking-tight leading-none">{fairPatients} pers</span>
                      <span className="text-[10px] font-bold opacity-70 uppercase tracking-wider mt-1">Fair</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-2xl block text-brand-sidebar tracking-tight leading-none">{criticalPatients} pers</span>
                      <span className="text-[10px] font-bold opacity-70 uppercase tracking-wider mt-1">Critical</span>
                    </div>
                  </div>
                  {/* Decorative Triangle Blob */}
                  <svg className="absolute blob-shape w-32 h-32 right-4 top-4 opacity-20" fill="black" viewBox="0 0 100 100">
                    <polygon points="50,10 90,90 10,90"></polygon>
                  </svg>
                </div>

                {/* Card 4: Alerts Today (Blue) */}
                <div className="bg-brand-blue rounded-card p-6 relative overflow-hidden h-40 flex flex-col justify-center flat-look animate-fade-in-up">
                  <h3 className="font-extrabold text-2xl text-brand-sidebar mb-4 z-10">Alerts (24 h):</h3>
                  <div className="flex gap-10 z-10">
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-2xl block text-brand-sidebar tracking-tight leading-none">{sev.HIGH ?? '–'}</span>
                      <span className="text-[10px] font-bold opacity-70 uppercase tracking-wider mt-1">Critical</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-2xl block text-brand-sidebar tracking-tight leading-none">{sev.MEDIUM ?? '–'}</span>
                      <span className="text-[10px] font-bold opacity-70 uppercase tracking-wider mt-1">Warnings</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="font-extrabold text-2xl block text-brand-sidebar tracking-tight leading-none">{summary ? (sev.LOW || 0) + (sev.INFO || 0) : '–'}</span>
                      <span className="text-[10px] font-bold opacity-70 uppercase tracking-wider mt-1">Info</span>
                    </div>
                  </div>
                  {summary?.latest_alert && (
                    <p className="text-[10px] font-bold text-brand-sidebar/70 mt-3 z-10 truncate">
                      Latest: {summary.latest_alert.patient} · {summary.latest_alert.type} · {summary.latest_alert.time}
                    </p>
                  )}
                  {/* Decorative Star Blob */}
                  <svg className="absolute blob-shape w-32 h-32 right-0 top-4 opacity-20" fill="black" viewBox="0 0 100 100">
                    <polygon points="50,10 61,40 95,40 68,60 79,90 50,70 21,90 32,60 5,40 39,40"></polygon>
                  </svg>
                </div>
              </div>

              {/* Patient's List & Details Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                
                {/* List Column */}
                <div className="animate-fade-in-up">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-extrabold text-xl text-brand-sidebar">Patient's list</h3>
                    <button className="bg-black text-white px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 flat-look">
                      Today <span className="material-symbols-outlined text-[16px]">expand_more</span>
                    </button>
                  </div>
                  <div className="flex flex-col gap-3">
                    {triagedPatients.map((p) => {
                      const isSelected = selectedPatientId === p.id;
                      const isCritical = p.riskScore >= 70;
                      const rowBg = isSelected ? 'bg-brand-pink-light border-none' : 'bg-white hover:bg-gray-50 border border-gray-200/60';
                      
                      return (
                        <div
                          key={p.id}
                          onClick={() => handlePatientSelect(p)}
                          className={`rounded-full py-3.5 px-5 flex items-center justify-between cursor-pointer transition-all ${rowBg} flat-look`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isCritical ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'}`}>
                              <span className="material-symbols-outlined">
                                {isCritical ? 'emergency' : 'stethoscope'}
                              </span>
                            </div>
                            <div>
                              <h4 className="font-extrabold text-sm text-brand-sidebar">{p.name}</h4>
                              <span className="text-xs text-gray-500 font-medium">
                                {rowLabel(p)}
                              </span>
                            </div>
                          </div>
                          <div className="bg-white px-3 py-1 rounded-full text-xs font-extrabold flat-look text-gray-700 border border-gray-200/50">
                            Risk {p.riskScore}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Details Column */}
                <div className="animate-fade-in-up">
                  <h3 className="font-extrabold text-xl text-brand-sidebar mb-6">Visit details</h3>
                  {activePatient ? (
                    <div className="bg-brand-pink-light rounded-card p-6 h-[calc(100%-44px)] flex flex-col border-none flat-look relative">
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <span 
                            onClick={() => handlePatientNavigate(activePatient.id)}
                            className="font-extrabold text-lg text-blue-700 underline decoration-1 underline-offset-4 mb-1 block cursor-pointer hover:text-blue-900"
                          >
                            {activePatient.name}
                          </span>
                          <span className="text-xs text-gray-600 font-bold block">{activePatient.sex} - {activePatient.age} Years</span>
                        </div>
                        <span className="bg-white px-3 py-1 rounded-full text-xs font-bold text-gray-600 flat-look border border-gray-100">
                          ID: {activePatient.id}
                        </span>
                      </div>
                      
                      <div className="flex flex-wrap gap-2 mb-6">
                        {activePatient.diagnosis.map((d, i) => (
                          <span key={i} className="bg-brand-pink text-white px-3 py-1 rounded-full text-[10px] font-bold flat-look">
                            {d}
                          </span>
                        ))}
                      </div>

                      <div className="space-y-4 text-xs flex-1 font-medium text-gray-700">
                        <div className="grid grid-cols-4 gap-2 border-b border-white/40 pb-2">
                          <span className="text-gray-500 font-bold">Last Checked</span>
                          <div className="col-span-3">
                            <p className="font-extrabold text-gray-800">{activePatient.doctor || 'Dr. Priya Nair'}</p>
                            <span className="text-blue-600 font-bold mt-0.5 inline-block cursor-pointer">Prescription #{activePatient.id.replace('P-', 'RX-')}/{activePatient.medications?.length || 0}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 border-b border-white/40 pb-2">
                          <span className="text-gray-500 font-bold">Observation</span>
                          <div className="col-span-3">
                            <p className="font-semibold text-gray-700 leading-relaxed">
                              {activePatient.consultBrief || 'Patient showing elevated blood pressure. Needs titration.'}
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <span className="text-gray-500 font-bold">Prescription</span>
                          <div className="col-span-3">
                            <p className="font-semibold text-gray-700 leading-relaxed">
                              {activePatient.medications?.map(m => `${m.name} ${m.dose}`).join(', ') || 'No medications listed.'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-card p-6 h-[calc(100%-44px)] flex items-center justify-center border border-gray-200">
                      <span className="text-gray-400 font-medium">Select a patient to see visit details.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column (4/12) */}
            <CalendarSidebar showGreeting={false} isSidebar={false} className="xl:col-span-4 bg-transparent flex flex-col h-full animate-fade-in-up" />

          </div>

        </div>
      </div>
    </div>
  );
};

export default Overview;
