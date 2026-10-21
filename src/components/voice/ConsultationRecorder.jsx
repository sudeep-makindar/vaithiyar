import React, { useState, useRef } from 'react';
import { BASE_API } from '../../config.js';

const ConsultationRecorder = ({ patientId }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [structuredNote, setStructuredNote] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const [duration, setDuration] = useState(0);

  const startRecording = async () => {
    setStructuredNote(null);
    setTranscript('');
    audioChunksRef.current = [];
    setDuration(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = { mimeType: 'audio/webm' };
      let mediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, options);
      } catch (e) {
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsProcessing(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await uploadConsultation(audioBlob);
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setIsPaused(false);

      // Start timer
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Failed to start recording consultation:", err);
      alert("Microphone permission denied or unavailable.");
    }
  };

  const pauseRecording = () => {
    if (!mediaRecorderRef.current) return;
    if (isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } else {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      clearInterval(timerRef.current);
    }
  };

  const stopAndSummarize = () => {
    if (!mediaRecorderRef.current) return;
    clearInterval(timerRef.current);
    mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const uploadConsultation = async (audioBlob) => {
    const formData = new FormData();
    formData.append("audio", audioBlob, "consultation.webm");
    formData.append("patient_id", patientId);
    formData.append("physician_id", "doc-1");

    try {
      const res = await fetch(`${BASE_API}/voice/consultation-record`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      
      if (data.raw_transcript) {
        setTranscript(data.raw_transcript);
        setStructuredNote(data.structured_note);
      } else {
        alert("Consultation processing failed.");
      }
    } catch (err) {
      console.error("Upload consultation error:", err);
      alert("Network error processing consultation note.");
    } finally {
      setIsProcessing(false);
    }
  };

  const saveNote = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch(`${BASE_API}/intake/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          extracted_name: "Patient",
          diagnosis: { value: structuredNote.chief_complaint || "Routine consultation" },
          medications: { value: structuredNote.medications_discussed?.map(m => `${m.name} ${m.dose} ${m.frequency}`).join('\n') || "" },
          vitals: { value: {} }
        })
      });
      
      const resData = await res.json();
      if (resData.status === "success") {
        alert("Clinical note finalized and saved to SQLite database!");
        setStructuredNote(null);
        setTranscript('');
      } else {
        alert("Failed to save note.");
      }
    } catch (err) {
      console.error("Save note error:", err);
      alert("Error saving clinical note.");
    } finally {
      setIsProcessing(false);
      setIsEditing(false);
    }
  };

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-[24px] p-6 shadow-sm flex flex-col h-full min-h-[380px]">
      <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[24px] text-brand-sidebar">clinical_notes</span>
          <h3 className="text-[18px] font-black text-brand-sidebar leading-none">
            Consultation Scribe
          </h3>
        </div>
        
        {isRecording && (
          <div className="flex items-center gap-2 bg-red-50 text-red-600 px-3 py-1 rounded-full border border-red-100 text-xs font-bold animate-pulse">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600"></span>
            <span>Recording {formatDuration(duration)}</span>
          </div>
        )}
      </div>

      {!isRecording && !structuredNote && !isProcessing && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
          <span className="material-symbols-outlined text-[48px] text-gray-400 mb-3">mic</span>
          <h4 className="text-sm font-black text-gray-700 mb-1">
            Initialize Consultation Recording
          </h4>
          <p className="text-xs text-gray-400 max-w-sm mb-6 leading-relaxed">
            Record patient-physician conversation. ClinIQ will automatically transcribe, label speakers, and extract clinical notes.
          </p>
          <button
            onClick={startRecording}
            className="bg-black text-white hover:bg-black/90 text-xs font-black uppercase tracking-wider px-6 py-3 rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
            Start Scribing
          </button>
        </div>
      )}

      {isRecording && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 border border-gray-100 rounded-2xl bg-gray-50/30">
          <div className="relative w-20 h-20 mb-6 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
            <div className="w-16 h-16 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg border border-red-500/30">
              <span className="material-symbols-outlined text-[32px] animate-pulse">settings_voice</span>
            </div>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={pauseRecording}
              className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-bold px-5 py-3 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">
                {isPaused ? 'play_arrow' : 'pause'}
              </span>
              <span>{isPaused ? 'Resume' : 'Pause'}</span>
            </button>
            <button
              onClick={stopAndSummarize}
              className="bg-black hover:bg-black/90 text-white text-xs font-bold px-6 py-3 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-md"
            >
              <span className="material-symbols-outlined text-[16px]">summarize</span>
              <span>End & Summarize</span>
            </button>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <span className="material-symbols-outlined text-[48px] text-[#F5C842] animate-spin mb-4">
            progress_activity
          </span>
          <h4 className="text-sm font-black text-gray-700 mb-1">
            Analyzing Consultation Audio...
          </h4>
          <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
            AI is transcribing dialog, diarizing speakers, and compiling clinical SOAP notes. This will take a moment.
          </p>
        </div>
      )}

      {/* Structured SOAP Note Editable Panel */}
      {structuredNote && !isProcessing && (
        <div className="flex-grow flex flex-col gap-4 overflow-y-auto pr-1 custom-scrollbar">
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
            <h4 className="text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-2">
              Diarized Transcript
            </h4>
            <div className="max-h-32 overflow-y-auto text-xs text-gray-600 leading-relaxed font-medium bg-white p-2.5 rounded-xl border border-gray-100/50 pr-2 custom-scrollbar">
              {transcript}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-extrabold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-1">
              Extracted SOAP Summary
            </h4>

            {/* Chief Complaint */}
            <div className="grid grid-cols-4 gap-2 text-xs">
              <span className="font-extrabold text-gray-500 uppercase tracking-wide col-span-1">Complaint:</span>
              <span className="col-span-3 text-on-surface font-semibold">{structuredNote.chief_complaint || 'N/A'}</span>
            </div>

            {/* Symptoms */}
            <div className="grid grid-cols-4 gap-2 text-xs">
              <span className="font-extrabold text-gray-500 uppercase tracking-wide col-span-1">Symptoms:</span>
              <span className="col-span-3 text-on-surface font-semibold">
                {structuredNote.symptoms_mentioned?.join(', ') || 'None reported'}
              </span>
            </div>

            {/* Observations */}
            <div className="grid grid-cols-4 gap-2 text-xs">
              <span className="font-extrabold text-gray-500 uppercase tracking-wide col-span-1">Obs:</span>
              <span className="col-span-3 text-on-surface font-semibold">{structuredNote.physician_observations || 'N/A'}</span>
            </div>

            {/* Medications */}
            <div className="grid grid-cols-4 gap-2 text-xs">
              <span className="font-extrabold text-gray-500 uppercase tracking-wide col-span-1">Meds:</span>
              <div className="col-span-3 flex flex-col gap-1">
                {structuredNote.medications_discussed?.map((m, i) => (
                  <span key={i} className="bg-brand-pink-light/35 text-brand-sidebar px-2 py-0.5 rounded-md font-bold text-[10px] w-fit">
                    {m.name} {m.dose} • {m.frequency}
                  </span>
                )) || 'None discussed'}
              </div>
            </div>

            {/* Follow Up */}
            <div className="grid grid-cols-4 gap-2 text-xs">
              <span className="font-extrabold text-gray-500 uppercase tracking-wide col-span-1">Follow-up:</span>
              <span className="col-span-3 text-on-surface font-semibold">{structuredNote.follow_up_instructions || 'None'}</span>
            </div>
          </div>

          <div className="mt-auto pt-4 flex gap-2 border-t border-gray-100">
            <button
              onClick={() => {
                setStructuredNote(null);
                setTranscript('');
              }}
              className="flex-1 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-black uppercase tracking-wider py-3 rounded-xl transition-all cursor-pointer"
            >
              Discard
            </button>
            <button
              onClick={saveNote}
              className="flex-1 bg-black hover:bg-black/90 text-white text-xs font-black uppercase tracking-wider py-3 rounded-xl transition-all cursor-pointer shadow-md"
            >
              Save Scribe Note
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsultationRecorder;
