import React, { useState } from 'react';
import { T } from '../tokens';
import TopHeader from '../components/TopHeader';
import FileUpload from '../components/IntakeEngine/FileUpload';
import ExtractionResults from '../components/IntakeEngine/ExtractionResults';
import PdfViewer from '../components/IntakeEngine/PdfViewer';
import { BASE_API } from '../config.js';

const Intake = ({ patient, patients = [], setCurrentPatient, refreshPatients, setCurrentView }) => {
  const [fileData, setFileData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [extraction, setExtraction] = useState(null);

  // Real intake history: every document the AI has processed, newest first
  const intakeHistory = patients
    .flatMap(p => (p.clinicalPatterns || []).filter(a => a.type === 'Data Ingest' && a.timestamp)
      .map(a => ({ ...a, patientName: p.name })))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const [error, setError] = useState(null);
  const [documentType, setDocumentType] = useState('discharge_summary');

  const handleUpload = async (fileInfo) => {
    setFileData(fileInfo);
    setLoading(true);
    setError(null);
    setExtraction(null);

    try {
      const response = await fetch(`${BASE_API}/intake/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_base64: fileInfo.base64,
          file_type: fileInfo.type,
          expected_patient_name: patient?.name,
          is_new_patient: !patient,
          document_type: documentType
        })
      });

      if (!response.ok) throw new Error('Failed to extract data');

      const result = await response.json();
      if (result.error) throw new Error(result.error);

      setExtraction(result);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const [isSaved, setIsSaved] = useState(false);

  const handleApprove = async (finalData) => {
    setLoading(true);
    try {
      const payload = { ...finalData, patient_id: patient?.id };
      const response = await fetch(`${BASE_API}/intake/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('Failed to save data');
      const result = await response.json();

      const updatedPatients = await refreshPatients();
      if (result.patient_id) {
        const newPatient = updatedPatients.find(p => p.id === result.patient_id);
        if (newPatient) {
          setCurrentPatient(newPatient);
          setCurrentView('patient');
        }
      }

      setIsSaved(true);
      setExtraction(null);
      setFileData(null);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (updatedData) => {
    setExtraction(updatedData);
  };

  return (
    <div className="flex flex-col min-h-screen bg-transparent">
      <TopHeader />

      <div className="fadeIn px-4 md:px-8 pb-8 flex-grow flex flex-col max-w-[1400px] mx-auto w-full">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-[16px] text-red-600 text-sm mb-6 flex justify-between items-center shadow-sm animate-fade-in-up">
            <span className="font-bold">Error: {error}</span>
            <button
              onClick={() => { setFileData(null); setError(null); }}
              className="text-red-700 font-extrabold underline hover:no-underline cursor-pointer"
            >
              Try Again
            </button>
          </div>
        )}

        {!fileData && !extraction ? (
          <div className="flex-grow flex flex-col">
            {/* Page Header */}
            <div className="mb-8 animate-fade-in-up">
              <h2 className="text-2xl md:text-[32px] text-brand-sidebar font-extrabold tracking-tight mb-2">AI Intake Engine</h2>
              <p className="text-gray-505 max-w-3xl text-sm md:text-base">
                Upload unstructured clinical notes, lab results, or imaging reports. Our AI will automatically parse, structure, and route the data.
              </p>
            </div>

            {/* Bento Grid */}
            <div className="grid grid-cols-12 gap-6 pb-8 flex-grow animate-fade-in-up">
              {/* Left Column (8/12) */}
              <div className="col-span-12 xl:col-span-8 flex flex-col gap-6">
                {/* Document Upload Container */}
                <div className="bg-white rounded-[24px] p-8 border border-gray-200/80 shadow-sm relative overflow-hidden flex-grow flex flex-col min-h-[360px]">
                  <div className="absolute bottom-[-30px] right-[-30px] w-[180px] h-[180px] bg-brand-pink/10 rounded-full blur-3xl opacity-40 pointer-events-none" />
                  <div className="relative z-10 flex-grow flex flex-col justify-between h-full">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-extrabold text-black">Document Upload</h3>
                      <button className="text-gray-400 hover:text-black font-extrabold text-xs transition-colors cursor-pointer">
                        View History
                      </button>
                    </div>
                    <FileUpload onUpload={handleUpload} loading={loading} />
                  </div>
                </div>

                {/* Settings Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Target Patient */}
                  <div className="bg-[#FFECA1] border border-[#F8D664] rounded-[24px] p-6 relative overflow-hidden flex flex-col justify-center min-h-[120px] shadow-sm">
                    <div className="absolute bottom-[-20px] right-[-20px] w-[120px] h-[120px] bg-brand-yellow rounded-full blur-2xl opacity-15 pointer-events-none" />
                    <div className="relative z-10">
                      <label className="text-[10px] text-gray-700 font-extrabold mb-2.5 block uppercase tracking-wider">Target Patient</label>
                      <div className="relative">
                        <select
                          value={patient ? patient.id : 'NEW'}
                          onChange={(e) => {
                            if (e.target.value === 'NEW') {
                              setCurrentPatient(null);
                            } else {
                              const selected = patients.find(p => p.id === e.target.value);
                              setCurrentPatient(selected);
                            }
                          }}
                          className="w-full bg-white/60 border border-gray-200/40 rounded-xl py-2.5 pl-3 pr-10 text-sm font-bold text-black appearance-none focus:ring-2 focus:ring-brand-yellow cursor-pointer"
                        >
                          <option value="NEW">✨ Create New Patient Profile</option>
                          {patients.map(p => (
                            <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                          ))}
                        </select>
                        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-black font-bold">expand_more</span>
                      </div>
                    </div>
                  </div>

                  {/* Document Type Override */}
                  <div className="bg-[#efeeea] border border-[#c4c7c7] rounded-[24px] p-6 relative overflow-hidden flex flex-col justify-center min-h-[120px] shadow-sm">
                    <div className="relative z-10">
                      <label className="text-[10px] text-gray-655 font-extrabold mb-2.5 block uppercase tracking-wider">Document Type Override</label>
                      <div className="relative">
                        <select
                          value={documentType}
                          onChange={(e) => setDocumentType(e.target.value)}
                          className="w-full bg-white border border-gray-250 rounded-xl py-2.5 pl-3 pr-10 text-sm font-bold text-black appearance-none focus:ring-2 focus:ring-black cursor-pointer"
                        >
                          <option value="discharge_summary">📄 Prescription / Discharge Summary</option>
                          <option value="imaging">☢️ Imaging (X-Ray / MRI / CT)</option>
                        </select>
                        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-600 font-bold">expand_more</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column (4/12) */}
              <div className="col-span-12 xl:col-span-4 flex flex-col gap-6">
                {/* Processing Queue */}
                <div className="bg-white border border-gray-200 rounded-[24px] p-6 flex-grow flex flex-col shadow-sm">
                  <h3 className="text-xl font-extrabold text-black mb-6">Processing Queue</h3>
                  <div className="space-y-4 flex-grow overflow-y-auto pr-1">
                    {loading && (
                      <div className="bg-[#FAF9F5] border border-gray-150 p-4 rounded-xl flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#FFDCE6] flex items-center justify-center text-[#b56f89] shrink-0">
                          <span className="material-symbols-outlined animate-spin">progress_activity</span>
                        </div>
                        <div className="flex-grow min-w-0">
                          <p className="text-xs font-bold text-black truncate">{fileData?.name || 'Document'}</p>
                          <p className="text-[10px] font-extrabold text-[#b56f89] mt-1">AI extraction in progress…</p>
                        </div>
                      </div>
                    )}
                    {intakeHistory.length === 0 && !loading && (
                      <p className="text-xs text-gray-500 font-semibold">No documents processed yet. Upload one to start.</p>
                    )}
                    {intakeHistory.slice(0, 5).map((h, i) => (
                      <div key={i} className="bg-[#FAF9F5] border border-gray-150 p-4 rounded-xl flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#FFECA1] flex items-center justify-center text-[#8C6D14] shrink-0">
                          <span className="material-symbols-outlined">check_circle</span>
                        </div>
                        <div className="flex-grow min-w-0">
                          <p className="text-xs font-bold text-black truncate">{h.patientName}</p>
                          <p className="text-[10px] font-semibold text-gray-500 mt-0.5 line-clamp-2">{h.description}</p>
                          <p className="text-[10px] font-extrabold text-brand-green mt-1">Parsed &amp; Structured · {h.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI Insights Snippet (Dark Card) */}
                <div className="bg-brand-sidebar text-white rounded-[24px] p-6 relative overflow-hidden h-48 shadow-sm flex flex-col justify-between shrink-0">
                  <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-white/5 rounded-full blur-xl pointer-events-none"></div>
                  <div className="relative z-10 flex flex-col h-full justify-between">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="material-symbols-outlined text-[#FBE46A] fill-icon">psychology</span>
                      <h4 className="text-sm font-extrabold">Engine Status</h4>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Vision + text extraction on Groq (Qwen-VL, GPT-OSS). Source documents are archived to Amazon S3; structured data lands in DynamoDB.
                    </p>
                    <div className="flex justify-between items-end mt-2">
                      <div>
                        <span className="block text-[9px] text-gray-500 uppercase tracking-wider mb-0.5 font-bold">Documents (7 days)</span>
                        <span className="text-2xl font-black text-white">{intakeHistory.filter(h => Date.now() - new Date(h.timestamp).getTime() < 7 * 86400000).length}</span>
                      </div>
                      <div className="w-16 h-8 bg-white/10 rounded-full flex items-center justify-center px-1">
                        <svg className="w-12 h-4" fill="none" viewBox="0 0 48 16">
                          <path d="M2 14L12 8L22 12L34 4L46 10" stroke="#FBE46A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-grow flex flex-col min-h-0">
            {/* Header when file is active */}
            <div className="mb-4 flex justify-between items-center shrink-0">
              <div>
                <h1 className="text-xl md:text-2xl font-extrabold text-brand-sidebar tracking-tight">
                  Multimodal AI Intake Review
                </h1>
                <p className="text-xs text-gray-505 mt-0.5">
                  Target: {patient ? `${patient.name} (${patient.id})` : 'New Patient Profile'}
                </p>
              </div>
              <button
                onClick={() => { setFileData(null); setExtraction(null); }}
                className="text-xs font-bold text-gray-500 bg-white border border-gray-200 px-4 py-2 rounded-full hover:bg-gray-50 transition-colors shadow-sm cursor-pointer"
              >
                Cancel Review
              </button>
            </div>

            {loading && fileData && (
              <div className="flex-grow flex flex-col lg:flex-row gap-6 lg:h-[calc(100vh-200px)]">
                <div className="flex-1 bg-white border border-gray-200 rounded-[24px] p-4 flex min-h-[300px] lg:min-h-0 overflow-hidden">
                  <PdfViewer fileData={fileData} />
                </div>
                <div className="flex-1 flex items-center justify-center bg-white border border-gray-200 rounded-[24px] p-6 shadow-sm min-h-[200px] lg:min-h-0">
                  <div className="text-center">
                    <div className="w-12 h-12 rounded-full border-4 border-brand-pink border-t-transparent animate-spin mb-4 mx-auto"></div>
                    <div className="text-brand-pink font-extrabold tracking-wider text-sm">AI ANALYZING DOCUMENT...</div>
                  </div>
                </div>
              </div>
            )}

            {extraction && (
              <div className="flex flex-col lg:flex-row gap-6 min-h-0 flex-grow lg:h-[calc(100vh-200px)] pb-16 lg:pb-0">
                {/* Left: PDF Viewer */}
                <div className="flex-[1.2] bg-white border border-gray-200 rounded-[24px] p-4 flex min-h-[300px] lg:min-h-0 overflow-hidden">
                  <PdfViewer fileData={fileData} />
                </div>
                {/* Right: Extraction results - scrolls internally */}
                <div className="flex-1 bg-white border border-gray-200 rounded-[24px] p-6 min-h-[400px] lg:min-h-0 overflow-y-auto shadow-sm">
                  <ExtractionResults
                    data={extraction}
                    onApprove={handleApprove}
                    onEdit={handleEdit}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Intake;
