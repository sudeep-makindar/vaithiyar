import React, { useState } from 'react';
import TopHeader from '../components/TopHeader';
import VisionScanner from '../components/PillGuard/VisionScanner';
import PillAnalysisResult from '../components/PillGuard/PillAnalysisResult';
import AdherenceCalendar from '../components/PillGuard/AdherenceCalendar';
import PrescriptionReference from '../components/PillGuard/PrescriptionReference';
import DrugInteractionGraph from '../components/charts/DrugInteractionGraph';
import useSSEStream from '../hooks/useSSEStream';
import { BASE_API } from '../config.js';

const PillGuard = ({ patient }) => {
  const [analysisResult, setAnalysisResult] = useState(null);
  const [missedCellInfo, setMissedCellInfo] = useState({ drugName: 'Lisinopril' });
  const missedSSE = useSSEStream();

  if (!patient) {
    return (
      <div className="flex flex-col min-h-screen bg-transparent text-on-surface">
        <TopHeader />
        <div className="flex-grow flex items-center justify-center min-h-[500px] font-sans">
          <div className="text-center p-8 bg-white border border-gray-200 rounded-card max-w-sm shadow-sm">
            <span className="material-symbols-outlined text-4xl text-brand-pink mb-4 animate-pulse">medication</span>
            <h3 className="text-lg font-bold text-brand-sidebar">PillGuard Scanner</h3>
            <p className="text-xs text-gray-500 font-medium mt-1">
              Select a patient from the registry or dashboard to initialize their medication verification and adherence log.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const handleNewScanResult = (result) => {
    setAnalysisResult(result);
  };

  const handleSelectMissedCell = async (drugName) => {
    setMissedCellInfo({ drugName });
    missedSSE.setData('');
    try {
      await missedSSE.startStream(`${BASE_API}/pillguard/missed-dose-impact`, {
        patient_id: patient.id,
        drug_name: drugName
      });
    } catch (err) {
      console.error("Failed to run missed dose forecast:", err);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-transparent text-on-surface">
      <TopHeader />
      
      <div className="flex-grow flex flex-col xl:flex-row gap-6 w-full max-w-[1600px] mx-auto pb-8 relative font-sans">
        
        {/* Left & Center Content (Bento Grid) */}
        <div className="flex-grow flex flex-col gap-8 px-4 md:px-8 min-w-0">
          
          {/* Header */}
          <div>
            <h2 className="font-headline-lg text-2xl md:text-[32px] font-semibold text-on-surface mb-2 tracking-tight leading-tight md:leading-[40px]">
              PillGuard Analysis
            </h2>
            <p className="font-body-md text-sm md:text-base text-[#444748] max-w-3xl leading-relaxed md:leading-[24px]">
              Intelligent medication verification and adherence tracking for Dr. Vedanth's current patient load. Real-time scanning ensures accurate dosage and prevents interaction risks.
            </p>
          </div>

          {/* Bento grid layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Left Bento Column */}
            <div className="flex flex-col gap-6">
              {/* PillGuard Scanner Card */}
              <VisionScanner patient={patient} onScanResult={handleNewScanResult} />
              
              {/* Drug Interactions Card (Blue background) */}
              <div className="bg-blue rounded-2xl p-6 relative overflow-hidden h-[300px] flex flex-col shadow-sm">
                {/* Decorative Blob */}
                <svg className="absolute -right-8 -bottom-8 w-44 h-44 fill-white opacity-20 pointer-events-none" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                  <path d="M45.7,-76.3C58.9,-69.3,68.8,-55.5,77.5,-41.2C86.2,-26.9,93.7,-12.1,91.8,1.9C89.9,15.9,78.6,29.1,68.2,41.4C57.8,53.7,48.3,65.1,35.6,72.4C22.9,79.7,7,82.9,-7.5,82.2C-22,81.5,-35.1,76.9,-48.3,70C-61.5,63.1,-74.8,53.9,-82.7,41.2C-90.6,28.5,-93.1,12.3,-91.2,-3.1C-89.3,-18.5,-83.1,-33,-73.4,-44.6C-63.7,-56.2,-50.5,-64.9,-37.2,-71.9C-23.9,-78.9,-10.5,-84.2,2.8,-87.4C16.1,-90.6,32.5,-83.3,45.7,-76.3Z" transform="translate(100 100)"></path>
                </svg>

                <div className="relative z-10 flex-grow flex flex-col justify-between h-full">
                  <h3 className="font-headline-card text-on-surface mb-4 flex items-center gap-2.5 font-bold text-lg">
                    <span className="material-symbols-outlined">hub</span>
                    Drug interactions
                  </h3>
                  
                  {/* Graph Area */}
                  <div className="flex-grow min-h-0 py-1">
                    <DrugInteractionGraph patient={patient} />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Bento Column */}
            <div className="flex flex-col gap-6">
              {/* Adherence Calendar Card */}
              <AdherenceCalendar patient={patient} onSelectMissedCell={handleSelectMissedCell} />
              
              {/* Missed Dose Impact Card (Yellow background) */}
              <div className="bg-yellow rounded-2xl p-6 relative overflow-hidden h-[250px] flex flex-col shadow-sm">
                {/* Decorative Blob */}
                <svg className="absolute -right-8 -bottom-8 w-44 h-44 fill-white opacity-20 pointer-events-none" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                  <path d="M42.7,-73.4C56.6,-66.9,70.1,-57.4,78.8,-44.5C87.5,-31.6,91.4,-15.8,90.2,-0.7C89,14.4,82.7,28.8,73.4,41.2C64.1,53.6,51.8,64,37.8,71.4C23.8,78.8,8.1,83.2,-6.6,81.4C-21.3,79.6,-35,-71.6,-48.2,-62.4C-61.4,-53.2,-74.1,-42.8,-82.2,-29.3C-90.3,-15.8,-93.8,-0.8,-90.6,13.2C-87.4,27.2,-77.5,40.2,-65.4,50.4C-53.3,60.6,-39,68,-24.5,72.6C-10,77.2,4.7,79,18.1,75.4Z" transform="translate(100 100)"></path>
                </svg>

                <div className="relative z-10 flex-grow flex flex-col justify-between h-full">
                  <h3 className="font-headline-card text-on-surface mb-4 flex items-center gap-2.5 font-bold text-lg">
                    <span className="material-symbols-outlined">auto_awesome</span>
                    Missed dose impact
                  </h3>
                  
                  {/* Forecast Text Grid */}
                  <div className="bg-on-primary/40 rounded-xl p-4 backdrop-blur-sm flex-1 flex flex-col">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                      <span className="font-label-bold text-label-sm text-on-surface/70 uppercase tracking-wider font-mono">
                        AI Streaming Analysis
                      </span>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface flex-1 leading-relaxed font-bold">
                      {missedSSE.data || (missedSSE.loading ? (
                        <span className="animate-pulse">Analyzing simulated pharmacology impact...</span>
                      ) : (
                        <span>
                          Missing the Thursday morning dose of {missedCellInfo?.drugName || 'Lisinopril'} temporarily elevated blood pressure markers. However, normal baseline was re-established within 24 hours of the subsequent dose. No long-term vascular impact projected. Patient reminded via SMS.
                        </span>
                      ))}
                      <span className="inline-block w-1.5 h-4 bg-on-surface align-middle animate-pulse ml-1"></span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* Right Sidebar Panel (Prescription Reference Sidebar) */}
        <div className="px-4 md:px-8 xl:px-0 xl:pr-8 shrink-0">
          <PrescriptionReference patient={patient} />
        </div>

      </div>

      {analysisResult && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-8 animate-fade-in-up">
          <div className="max-w-[700px] w-full bg-white border border-gray-200 rounded-[32px] p-6 shadow-2xl relative">
            <PillAnalysisResult result={analysisResult} onDismiss={() => setAnalysisResult(null)} />
          </div>
        </div>
      )}
    </div>
  );
};

export default PillGuard;
