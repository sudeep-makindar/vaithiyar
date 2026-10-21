import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { T } from '../tokens';
import TopHeader from '../components/TopHeader';
import BodyMapContext from '../components/PatientIntel/BodyMapContext';
import LabTrendChart from '../components/PatientIntel/LabTrendChart';
import MedicationsPanel from '../components/PatientIntel/MedicationsPanel';
import SecondOpinionPanel from '../components/PatientIntel/SecondOpinionPanel';
import NaturalLanguageQuery from '../components/PatientIntel/NaturalLanguageQuery';
import ClinicalPatternFeed from '../components/PatientIntel/ClinicalPatternFeed';
import TrajectoryPreview from '../components/PatientIntel/TrajectoryPreview';
import ConsultationRecorder from '../components/voice/ConsultationRecorder';
import { useVoice } from '../hooks/useVoice';
import VoiceWaveform from '../components/voice/VoiceWaveform';
import MicButton from '../components/voice/MicButton';
import VoiceResultCard from '../components/voice/VoiceResultCard';
import TrialMatcherPanel from '../components/PatientIntel/TrialMatcherPanel';
import { usePatientStore } from '../stores/patientStore';
import { BASE_API } from '../config.js';

const PatientIntel = ({ patients = [], patient, setCurrentPatient, setCurrentView, startInRegistry, onDeletePatient }) => {
  const navigate = useNavigate();
  const { id: routeId } = useParams();

  // Keep the selected patient in sync with the URL (deep links, notifications, refresh)
  useEffect(() => {
    if (!routeId || patient?.id === routeId) return;
    const match = patients.find(p => p.id === routeId);
    if (match) setCurrentPatient(match);
  }, [routeId, patients, patient?.id, setCurrentPatient]);
  const location = useLocation();
  const [voiceResult, setVoiceResult] = useState(null);
  const [viewMode, setViewMode] = useState(!patient || startInRegistry ? 'list' : 'detail');
  const [activeTab, setActiveTab] = useState('triage');
  // Trial cache is now shared globally via Zustand store
  const { cachedTrials, setCachedTrials } = usePatientStore();

  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    }
  }, [location.state?.tab]);

  // Voice & Patient Mode states
  const [patientLang, setPatientLang] = useState('hi-IN');
  const [patientMode, setPatientMode] = useState(false);
  const [patientRecording, setPatientRecording] = useState(false);
  const [patientIsProcessing, setPatientIsProcessing] = useState(false);
  const [patientResponse, setPatientResponse] = useState('');
  const [patientTranscript, setPatientTranscript] = useState('');
  const [patientInteractions, setPatientInteractions] = useState([]);
  const [isDownloadingPDF, setIsDownloadingPDF] = useState(false);
  const [patientAnalyser, setPatientAnalyser] = useState(null);

  const patientMediaRecorderRef = useRef(null);
  const patientChunksRef = useRef([]);
  const patientAudioContextRef = useRef(null);
  const patientStreamRef = useRef(null);

  const { speak, stopSpeaking } = useVoice();

  const stopPatientRecording = () => {
    if (patientMediaRecorderRef.current && patientMediaRecorderRef.current.state !== 'inactive') {
      patientMediaRecorderRef.current.stop();
    }
    if (patientStreamRef.current) {
      patientStreamRef.current.getTracks().forEach(track => track.stop());
      patientStreamRef.current = null;
    }
    if (patientAudioContextRef.current) {
      try { patientAudioContextRef.current.close(); } catch (e) { }
      patientAudioContextRef.current = null;
    }
    setPatientAnalyser(null);
    setPatientRecording(false);
  };

  const startPatientRecording = async () => {
    setPatientResponse('');
    setPatientTranscript('');
    patientChunksRef.current = [];
    stopSpeaking();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      patientStreamRef.current = stream;

      // Setup Web Audio Analyser
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      patientAudioContextRef.current = audioCtx;
      setPatientAnalyser(analyser);

      const options = { mimeType: 'audio/webm' };
      let mediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, options);
      } catch (e) {
        mediaRecorder = new MediaRecorder(stream);
      }

      patientMediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          patientChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setPatientIsProcessing(true);
        const audioBlob = new Blob(patientChunksRef.current, { type: 'audio/webm' });

        const formData = new FormData();
        formData.append("audio", audioBlob, "patient_symptom.webm");
        formData.append("language_code", patientLang);
        formData.append("patient_id", patient.id);

        try {
          const res = await fetch(`${BASE_API}/voice/patient-symptom`, {
            method: "POST",
            body: formData
          });
          const data = await res.json();
          setPatientIsProcessing(false);

          if (data.native_transcript) {
            setPatientTranscript(data.native_transcript);
            setPatientResponse(data.patient_reassurance_native);

            // Speak response in patient's language
            speak(data.patient_reassurance_native, patientLang);

            if (data.structured_data) {
              setPatientInteractions(prev => [data.structured_data, ...prev]);
            }
          } else {
            setPatientResponse("Sorry, I could not understand. Please try speaking again.");
            speak("Sorry, I could not understand. Please try speaking again.", "en-US");
          }
        } catch (err) {
          console.error("Patient mode recording error:", err);
          setPatientIsProcessing(false);
          setPatientResponse("Failed to connect to the voice intelligence layer.");
        }
      };

      mediaRecorder.start(250);
      setPatientRecording(true);
    } catch (err) {
      console.error("Mic access error for patient mode:", err);
      alert("Microphone permission denied or unavailable.");
    }
  };

  const handlePatientMicClick = () => {
    if (patientRecording) {
      stopPatientRecording();
    } else {
      startPatientRecording();
    }
  };

  const handleMockPatientSpeech = async (text) => {
    setPatientIsProcessing(true);
    setPatientResponse('');
    setPatientTranscript(text);

    try {
      let nativeText = text;
      let reassuranceText = "";
      let severity = 5;
      let primaryComplaint = "";
      let duration = "";
      let associated = [];

      // Get English translation of the spoken text if not English
      if (patientLang !== 'en-US') {
        const res = await fetch(`${BASE_API}/voice/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text,
            source_language: "en",
            target_language: patientLang.split('-')[0]
          })
        });
        const data = await res.json();
        nativeText = data.translated_text || text;
      }

      if (text.includes("chest pain")) {
        primaryComplaint = "Chest Pain";
        duration = "since yesterday";
        severity = 8;
        associated = ["Shortness of breath", "Fatigue"];

        const langMap = {
          'hi-IN': "मुझे खेद है कि आपको छाती में दर्द हो रहा है। मैंने आपके डॉक्टर, डॉ. यूथिका को तुरंत सूचित कर दिया है। कृपया आराम करें जब तक हम आपके विटल्स की जांच करते हैं।",
          'ta-IN': "உங்களுக்கு நெஞ்சு வலி இருப்பதாகக் கேள்விப்பட்டு வருந்துகிறேன். இதை உங்கள் மருத்துவர் டாக்டர் யூதிகாவிற்கு உடனடியாகத் தெரிவித்துள்ளேன். உங்கள் முக்கிய அறிகுறிகளை நாங்கள் சரிபார்க்கும்போது தயவுசெய்து ஓய்வெடுக்கவும்.",
          'te-IN': "మీకు ఛాతీ నొప్పి ఉన్నందుకు చింతిస్తున్నాను. నేను వెంటనే మీ డాక్టర్, డాక్టర్ యుతికాకు తెలియజేసాను. మేము మీ పారామితులను తనిఖీ చేసే వరకు దయచేసి విశ్రాంతి తీసుకోండి.",
          'kn-IN': "ನಿಮಗೆ ಎದೆ ನೋವು ಇರುವುದಕ್ಕೆ ವಿಷಾದಿಸುತ್ತೇವೆ. ನಾನು ತಕ್ಷಣ ನಿಮ್ಮ ವೈದ್ಯರಾದ ಡಾ. ಯುಥಿಕಾಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ನಾವು ನಿಮ್ಮ ಪ್ರಮುಖ ಲಕ್ಷಣಗಳನ್ನು ಪರಿಶೀಲಿಸುವವರೆಗೆ ದಯವಿಟ್ಟು ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ.",
          'ml-IN': "നിങ്ങൾക്ക് നെഞ്ചുവേദനയുള്ളതിൽ ഞാൻ ഖേദിക്കുന്നു. ഞാൻ ഉടൻ തന്നെ നിങ്ങളുടെ ഡോക്ടർ ഡോ. യുതികയെ അറിയിച്ചിട്ടുണ്ട്. നിങ്ങളുടെ പ്രധാന ലക്ഷണങ്ങൾ പരിശോധിക്കുന്നത് വരെ ദയവായി വിശ്രമിക്കുക.",
          'bn-IN': "আপনার বুকে ব্যথার কথা শুনে আমি দুঃখিত। আমি অবিলম্বে আপনার ডাক্তার ডঃ ইউথিকাকে জানিয়েছি। আমরা আপনার ভাইটাল পরীক্ষা করা পর্যন্ত অনুগ্রহ করে বিশ্রাম নিন।",
          'mr-IN': "तुमच्या छातीत दुखत असल्याबद्दल मला खेद वाटतो. मी तात्काळ तुमचे डॉक्टर, डॉ. युथिका यांना कळवले आहे. आम्ही तुमच्या शरीरातील महत्त्वाच्या खुणा तपासत असताना कृपया विश्रांती घ्या.",
          'en-US': "I am sorry to hear you have chest pain. I have flagged this for your doctor, Dr. Vedanth, immediately. Please rest while we check your vitals."
        };
        reassuranceText = langMap[patientLang] || langMap['en-US'];
      } else if (text.includes("forgot")) {
        primaryComplaint = "Missed Metformin Dose";
        duration = "this morning";
        severity = 4;
        associated = ["Glucose fluctuation"];

        const langMap = {
          'hi-IN': "बताने के लिए धन्यवाद। मैंने छूटी हुई मेटफॉर्मिन खुराक को लॉग कर दिया है। यदि यह समय सीमा के भीतर है, तो कृपया इसे अभी लें।",
          'ta-IN': "எனக்குத் தெரிவித்ததற்கு நன்றி. தவறிய மெட்ஃபோர்மின் அளவை நான் பதிவு செய்துள்ளேன். தயவுசெய்து இப்போது எடுத்துக் கொள்ளுங்கள்.",
          'te-IN': "తెలియజేసినందుకు ధన్యவாదాలు. నేను తప్పిపోయిన మెట్‌ఫార్మిన్ మోతాదును నమోదు చేసాను. దయచేసి ఇప్పుడు తీసుకోండి.",
          'kn-IN': "ತಿಳಿಸಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು. ತಪ್ಪಿಹೋದ ಮೆಟ್‌ಫಾರ್ಮಿನ್ ಡೋಸ್ ಅನ್ನು ನಾನು ಲಾಗ್ ಮಾಡಿದ್ದೇನೆ. ದಯವಿಟ್ಟು ಈಗ ತೆಗೆದುಕೊಳ್ಳಿ.",
          'ml-IN': "അറിയിച്ചതിന് നന്ദി. ഞാൻ വിട്ടുപോയ മെറ്റ്ഫോർമിൻ ഡോസ് രേഖപ്പെടുത്തിയിട്ടുണ്ട്. ദയവായി ഇപ്പോൾ എടുക്കുക.",
          'bn-IN': "জানানোর জন্য ধন্যবাদ। আমি বাদ পড়া মেটফর্মিন ডোজটি রেকর্ড করেছি। অনুগ্রহ করে এখন এটি নিন।",
          'mr-IN': "कळवल्याबद्दल धन्यवाद. मी चुकलेला मेटफॉर्मिन डोस नोंदवला आहे. कृपया आता घ्या.",
          'en-US': "Thank you for letting me know. I have logged the missed dose of Metformin and updated your adherence profile. Please take it now if it's within the window, or consult Dr. Vedanth."
        };
        reassuranceText = langMap[patientLang] || langMap['en-US'];
      } else if (text.includes("Metformin") || text.includes("medicine")) {
        primaryComplaint = "Drug Query (Metformin)";
        duration = "instant";
        severity = 2;

        const langMap = {
          'hi-IN': "मेटफॉर्मिन का उपयोग टाइप 2 मधुमेह वाले रोगियों में इंसुलिन संवेदनशीलता में सुधार करके रक्त शर्करा के स्तर को नियंत्रित करने के लिए किया जाता है।",
          'ta-IN': "மெட்ஃபோர்மின் டைப் 2 நீரிழிவு நோயாளிகளின் இரத்த சர்க்கரை அளவைக் கட்டுப்படுத்தப் பயன்படுகிறது.",
          'te-IN': "మెట్‌ఫార్మిన్ టైప్ 2 మధుమేహం ఉన్న రోగులలో రక్తంలో చక్కెర స్థాయిలను నియంత్రించడానికి ఉపయోగించబడుతుంది.",
          'kn-IN': "ಮೆಟ್‌ಫಾರ್ಮಿನ್ ಅನ್ನು ಟೈಪ್ 2 ಮಧುಮೇಹ ರೋಗಿಗಳಲ್ಲಿ ರಕ್ತದ ಸಕ್ಕರೆ ಮಟ್ಟವನ್ನು ನಿಯಂತ್ರಿಸಲು ಬಳಸಲಾಗುತ್ತದೆ.",
          'ml-IN': "ടൈപ്പ് 2 പ്രമേഹ രോഗികളിൽ ರಕ್ತത്തിലെ പഞ്ചസാരയുടെ അളവ് നിയന്ത്രിക്കാൻ മെറ്റ്ഫോർമിൻ ഉപയോഗിക്കുന്നു.",
          'bn-IN': "মেটফর্মিন টাইপ 2 ডায়াবেটিস রোগীদের রক্তে শর্করার মাত্রা নিয়ন্ত্রণ করতে ব্যবহৃত হয়।",
          'mr-IN': "मेटफॉर्मिनचा वापर टाईप २ मधुमेह असलेल्या रुग्णांमध्ये रक्तातील साखरेची पातळी नियंत्रित करण्यासाठी केला जातो.",
          'en-US': "Metformin is used to control blood sugar levels in patients with type 2 diabetes by improving insulin sensitivity."
        };
        reassuranceText = langMap[patientLang] || langMap['en-US'];
      } else {
        primaryComplaint = "Dizziness and Headache";
        duration = "today";
        severity = 6;
        associated = ["Dizziness", "Headache"];

        const langMap = {
          'hi-IN': "चक्कर आना और सिरदर्द लॉग कर लिया गया है। मैं आपके डॉक्टर को सचेत कर रहा हूँ।",
          'ta-IN': "தலைச்சுற்றல் மற்றும் தலைவலி பதிவு செய்யப்பட்டுள்ளது. நான் உங்கள் மருத்துவரை எச்சரிக்கிறேன்.",
          'te-IN': "తలతిరగడం మరియు తలనొప్పి నమోదు చేయబడింది. నేను మీ వైద్యుడిని హెచ్చరిస్తున్నాను.",
          'kn-IN': "ತಲೆತಿರುಗುವಿಕೆ ಮತ್ತು ತಲೆನೋವು ದಾಖಲಿಸಲಾಗಿದೆ. ನಾನು ನಿಮ್ಮ ವೈದ್ಯರನ್ನು ಎಚ್ಚರಿಸುತ್ತಿದ್ದೇನೆ.",
          'ml-IN': "തലകറക്കവും തലവേദനയും രേഖപ്പെടുത്തിയിട്ടുണ്ട്. ഞാൻ നിങ്ങളുടെ ഡോക്ടറെ അറിയിക്കാം.",
          'bn-IN': "মাথা ঘোরা এবং মাথাব্যথা রেকর্ড করা হয়েছে। আমি আপনার ডাক্তারকে সতর্ক করছি।",
          'mr-IN': "चक्कर येणे आणि डोकेदुखी नोंदवली गेली आहे. मी तुमच्या डॉक्टरांना सतर्क करत आहे.",
          'en-US': "Dizziness and headaches have been logged. I am cross-referencing this with your current medications for side effects and alerting Dr. Vedanth."
        };
        reassuranceText = langMap[patientLang] || langMap['en-US'];
      }

      setPatientTranscript(nativeText);
      setPatientResponse(reassuranceText);

      speak(reassuranceText, patientLang);

      const structuredData = {
        primary_complaint: primaryComplaint,
        duration: duration,
        severity: severity,
        associated_symptoms: associated,
        history_mentions: [],
        reassuring_advice_english: text
      };

      setPatientInteractions(prev => [structuredData, ...prev]);

    } catch (e) {
      console.error(e);
      setPatientResponse("Error processing simulated speech.");
    } finally {
      setPatientIsProcessing(false);
    }
  };

  const handleDownloadPDF = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isDownloadingPDF) return;
    setIsDownloadingPDF(true);

    // Open the PDF endpoint directly in a new tab — the browser will read
    // the Content-Disposition: attachment header and save it as a .pdf file.
    const url = `${BASE_API}/patient/${patient.id}/summary-pdf`;
    window.open(url, '_blank');

    // Reset loading state after a short delay
    setTimeout(() => {
      setIsDownloadingPDF(false);
    }, 2000);
  };

  // If list view, show flat-designed registry list
  if (viewMode === 'list' || !patient) {
    return (
      <div className="flex flex-col min-h-screen bg-transparent">
        <TopHeader />
        <div className="fadeIn px-4 md:px-8 pb-8 max-w-[1400px] mx-auto w-full">
          {/* Page Header */}
          <div className="mb-8 md:mb-10 animate-fade-in-up">
            <div className="flex flex-col md:flex-row md:items-center gap-3 mb-3">
              <h2 className="font-sans text-2xl md:text-[36px] text-brand-sidebar font-extrabold tracking-tight">
                Patient Intelligence Registry
              </h2>
              <div className="flex items-center space-x-2 bg-[#E8EDC8] text-[#5A631D] px-4 py-1.5 rounded-full border border-[#CFD96C]/30 shadow-sm w-fit shrink-0">
                <span className="w-2 h-2 bg-brand-green rounded-full"></span>
                <span className="text-[11px] uppercase tracking-wider font-extrabold">System Status: Optimal</span>
              </div>
            </div>
            <p className="text-sm md:text-lg text-gray-500 max-w-3xl">
              Select a patient file to initialize their comprehensive somatic and biometric insight dashboard.
            </p>
          </div>

          {/* Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {patients.map((p, idx) => {
              const cardThemes = [
                {
                  bg: 'bg-[#FFECA1] border-[#F8D664]',
                  textDoctor: 'text-[#8C6D14]',
                  blobColor: 'bg-brand-yellow',
                },
                {
                  bg: 'bg-[#EAF0AD] border-[#CFD96C]',
                  textDoctor: 'text-[#566118]',
                  blobColor: 'bg-brand-green',
                },
                {
                  bg: 'bg-[#FFCFE1] border-[#F8A1C4]',
                  textDoctor: 'text-[#912D55]',
                  blobColor: 'bg-brand-pink',
                },
                {
                  bg: 'bg-[#D1E8FA] border-[#A3D1F5]',
                  textDoctor: 'text-[#31648C]',
                  blobColor: 'bg-brand-blue',
                },
              ];
              const theme = cardThemes[idx % cardThemes.length];
              const isCritical = p.riskScore >= 70;

              return (
                <div
                  key={p.id}
                  onClick={() => {
                    setCurrentPatient(p);
                    setViewMode('detail');
                    setCurrentView('patient');
                  }}
                  className={`${theme.bg} rounded-[24px] p-8 relative overflow-hidden cursor-pointer transition-all duration-350 hover:-translate-y-1 hover:shadow-md border flex flex-col justify-between h-64`}
                >
                  <div className={`absolute bottom-[-10%] right-[-10%] w-[180px] h-[180px] rounded-full blur-2xl opacity-20 pointer-events-none ${theme.blobColor}`} />
                  <div className="relative z-10 flex flex-col h-full justify-between">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-xs text-gray-600 uppercase tracking-widest mb-1.5 font-extrabold font-mono">
                          {p.id} • {p.ward ? p.ward.toUpperCase() : 'GENERAL'}
                        </p>
                        <h3 className="text-[26px] font-extrabold text-black tracking-tight leading-snug">
                          {p.name} <span className="text-lg text-gray-600 font-normal">({p.age}Y)</span>
                        </h3>
                        <p className={`text-xs font-bold mt-1 ${theme.textDoctor}`}>
                          Physician: {p.doctor}
                        </p>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Are you sure you want to delete patient ${p.name}?`)) {
                            onDeletePatient && onDeletePatient(p.id);
                          }
                        }}
                        className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-red-500 hover:bg-red-50 hover:scale-105 active:scale-95 transition-all shadow-sm cursor-pointer z-20 border border-gray-100"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 bg-white/80 rounded-[16px] p-4 backdrop-blur-md border border-white/40 shadow-sm">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5 font-extrabold">Risk Score</p>
                        <p className={`text-[32px] font-black leading-none ${isCritical ? 'text-[#D93025]' : 'text-[#1E8E3E]'}`}>
                          {p.riskScore}%
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5 font-extrabold">Diagnosis</p>
                        <p className="text-xs font-bold text-black leading-snug mt-1 line-clamp-2">
                          {p.diagnosis && p.diagnosis.length > 0 ? p.diagnosis[0] : 'Review Needed'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const isCritical = patient.riskScore >= 70;
  const riskBadgeClass = isCritical
    ? 'bg-red-500/15 text-red-700 border-red-500/20'
    : 'bg-brand-green/20 text-[#5A631D] border-[#CFD96C]/30';

  if (patientMode) {
    return createPortal(
      <div className="fixed inset-0 bg-[#FAF9F5] bg-vibrant-gradient text-on-surface z-[100000] flex flex-col p-8 justify-between animate-fade-in font-sans overflow-hidden w-screen h-screen">

        {/* Decorative Blur Blobs */}
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-[#ffb0cc]/30 rounded-full blur-3xl opacity-60 pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] bg-[#fdcf49]/20 rounded-full blur-3xl opacity-60 pointer-events-none" />

        {/* Ambient Floating Elements */}
        <div className="absolute top-1/4 left-1/4 w-12 h-12 rounded-full bg-[#fdcf49]/40 blur-md animate-float pointer-events-none" style={{ animationDelay: '0.5s' }} />
        <div className="absolute bottom-1/3 right-1/4 w-16 h-16 rounded-full bg-[#ffb0cc]/40 blur-md animate-float pointer-events-none" style={{ animationDelay: '1.2s' }} />

        {/* Top Header */}
        <div className="flex justify-between items-center w-full z-10">
          <div className="font-sans text-[24px] font-bold text-primary">
            ClinIQ+ <span className="text-on-surface-variant font-normal text-lg ml-2">Patient Mode</span>
          </div>
          <button
            onClick={() => {
              stopSpeaking();
              stopPatientRecording();
              setPatientMode(false);
            }}
            className="glass-panel px-6 py-3 rounded-full font-bold flex items-center gap-2 hover:bg-white/90 transition-colors shadow-sm cursor-pointer text-xs uppercase tracking-wider text-black z-[100001]"
          >
            <span className="material-symbols-outlined text-sm font-bold">close</span>
            Exit Patient Mode
          </button>
        </div>

        {/* Center content */}
        <div className="flex-1 flex flex-col items-center justify-center text-center max-w-4xl mx-auto w-full my-4 z-10">

          {/* Greeting */}
          <div className="text-center mb-8 animate-float">
            <h1 className="text-[48px] font-bold text-primary mb-3 leading-tight tracking-tight font-sans">
              Hello {patient.name.split(' ')[0]},
            </h1>
            <p className="text-[24px] text-on-surface-variant font-medium font-sans">How can I help you today?</p>
          </div>

          {/* Language Selection Pills */}
          <div className="flex flex-wrap gap-2.5 justify-center mb-10 max-w-2xl">
            {[
              { code: 'en-US', name: 'English', flag: '🇬🇧' },
              { code: 'hi-IN', name: 'Hindi', flag: '🇮🇳' },
              { code: 'ta-IN', name: 'Tamil', flag: '🇮🇳' },
              { code: 'te-IN', name: 'Telugu', flag: '🇮🇳' },
              { code: 'ml-IN', name: 'Malayalam', flag: '🇮🇳' },
              { code: 'kn-IN', name: 'Kannada', flag: '🇮🇳' },
              { code: 'bn-IN', name: 'Bengali', flag: '🇮🇳' },
              { code: 'mr-IN', name: 'Marathi', flag: '🇮🇳' }
            ].map(lang => (
              <button
                key={lang.code}
                onClick={() => {
                  setPatientLang(lang.code);
                  stopSpeaking();
                }}
                className={`px-5 py-2.5 rounded-full border text-xs font-bold tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${patientLang === lang.code
                  ? 'bg-[#ffb0cc] text-[#39071f] border-transparent font-black scale-105 shadow-sm shadow-[#ffb0cc]/50'
                  : 'bg-white/70 border-gray-200 text-[#1B1C1A]/70 hover:bg-white'
                  }`}
              >
                <span>{lang.flag}</span>
                <span>{lang.name}</span>
              </button>
            ))}
          </div>

          {/* Centered Microphone Button */}
          <div className="relative w-48 h-48 flex items-center justify-center mb-8">
            {patientRecording && (
              <>
                <div className="absolute inset-0 rounded-full border-2 border-[#ffb0cc] opacity-20 animate-ping" style={{ animationDuration: '3s' }} />
                <div className="absolute inset-0 rounded-full border-2 border-[#ffb0cc] opacity-40 animate-ping" style={{ animationDuration: '3s', animationDelay: '1s' }} />
              </>
            )}

            <button
              onClick={handlePatientMicClick}
              className={`w-40 h-40 rounded-full bg-gradient-to-br from-[#ffb0cc] to-[#b56f89] flex flex-col items-center justify-center mic-glow transform transition-all duration-300 relative z-10 shadow-[inset_0_4px_12px_rgba(255,255,255,0.4)] ${patientRecording ? 'scale-105' : 'hover:scale-105'
                }`}
            >
              {patientIsProcessing ? (
                <span className="material-symbols-outlined text-white text-[52px] animate-spin">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-white text-[56px] fill-icon">mic</span>
              )}
              <span className="text-[10px] font-black uppercase tracking-wider mt-2 text-white/90">
                {patientRecording ? 'Recording...' : patientIsProcessing ? 'Processing...' : 'Speak Now'}
              </span>
            </button>

            {/* VoiceWaveform visualizer */}
            {patientRecording && patientAnalyser && (
              <div className="absolute inset-x-0 -bottom-8 h-12 flex justify-center items-center pointer-events-none z-20">
                <div className="w-48 h-full opacity-70">
                  <VoiceWaveform isListening={patientRecording} analyser={patientAnalyser} />
                </div>
              </div>
            )}
          </div>

          {/* Interactive Subtitles / Prompt Card */}
          <div className="glass-panel rounded-[24px] p-6 max-w-2xl w-full text-center shadow-lg border border-white/60 min-h-[140px] flex flex-col justify-center items-center">
            {patientIsProcessing ? (
              <div className="flex flex-col items-center gap-2">
                <span className="text-[#b56f89] text-xs font-black uppercase tracking-wider animate-pulse">Analyzing Response</span>
                <p className="text-sm text-gray-500 italic font-bold">"Processing symptoms and generating advice..."</p>
              </div>
            ) : patientTranscript ? (
              <div className="flex flex-col gap-3 w-full text-center">
                <div>
                  <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">What you said:</span>
                  <p className="text-sm font-semibold text-gray-700 italic">"{patientTranscript}"</p>
                </div>
                {patientResponse && (
                  <div className="border-t border-gray-250/50 pt-3 flex flex-col items-center gap-2">
                    <span className="text-[#b56f89] text-[10px] font-black uppercase tracking-wider">ClinIQ+ Reassurance:</span>
                    <p className="text-base font-extrabold text-[#1B1C1A] leading-relaxed font-sans">{patientResponse}</p>
                    <button
                      onClick={() => speak(patientResponse, patientLang)}
                      className="mt-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#b56f89] hover:opacity-85 cursor-pointer bg-[#ffb0cc]/20 px-3 py-1 rounded-full border border-[#ffb0cc]/30"
                    >
                      <span className="material-symbols-outlined text-[14px]">volume_up</span>
                      Listen Again
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-[#b56f89]">
                <span className="material-symbols-outlined text-lg">info</span>
                <p className="text-sm font-bold uppercase tracking-wide">
                  Speak symptoms, missed medicines, or ask drug queries
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Suggestion list */}
        <div className="w-full max-w-5xl mx-auto mb-4 border-t border-white/40 pt-6 z-10">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-center mb-4">Try saying one of these:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                title: "Report Symptoms",
                text: "I have been having chest pain since yesterday",
                icon: "favorite"
              },
              {
                title: "Medication Adherence",
                text: "I forgot to take my morning medicine",
                icon: "medication"
              },
              {
                title: "Inquire about Pills",
                text: "What does this Metformin medicine do?",
                icon: "help"
              },
              {
                title: "Dizziness & Headaches",
                text: "I feel dizzy and my head hurts",
                icon: "warning"
              }
            ].map((suggest, i) => (
              <button
                key={i}
                onClick={() => {
                  setPatientTranscript(suggest.text);
                  handleMockPatientSpeech(suggest.text);
                }}
                className="bg-white/70 hover:bg-white border border-white/50 p-4 rounded-xl text-left transition-all cursor-pointer group flex flex-col justify-between min-h-[90px] shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="flex justify-between items-start w-full mb-1">
                  <span className="text-[#b56f89] font-extrabold text-[11px] uppercase tracking-wider">{suggest.title}</span>
                  <span className="material-symbols-outlined text-gray-400 text-[16px]">{suggest.icon}</span>
                </div>
                <p className="text-xs text-gray-600 font-bold leading-normal italic">"{suggest.text}"</p>
              </button>
            ))}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-transparent">
      <TopHeader />

      <div className="fadeIn px-4 md:px-8 pb-8 flex-1 flex flex-col">
        {/* Back navigation & Page Title Header */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-2 animate-fade-in-up">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                setViewMode('list');
                setCurrentView('patient-registry');
              }}
              className="bg-white border border-gray-200 w-10 h-10 rounded-full flex items-center justify-center text-brand-sidebar hover:bg-gray-50 transition-colors shadow-sm cursor-pointer shrink-0"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <h2 className="text-2xl md:text-[28px] font-extrabold text-brand-sidebar tracking-tight leading-none break-words">
              {patient.name}
            </h2>
            <div className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 border ${riskBadgeClass} shadow-sm font-bold text-[11px] tracking-wide shrink-0`}>
              <span className="material-symbols-outlined text-[14px]">
                {isCritical ? 'warning' : 'check_circle'}
              </span>
              <span>Precision Risk: {patient.riskScore}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <MicButton
              patientId={patient.id}
              onResult={setVoiceResult}
            />
            <button 
              type="button"
              onClick={(e) => handleDownloadPDF(e)}
              disabled={isDownloadingPDF}
              className="px-4 py-2 bg-white hover:bg-gray-50 text-brand-sidebar border border-gray-200 rounded-full flex items-center gap-2 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className={`material-symbols-outlined text-[16px] ${isDownloadingPDF ? 'animate-spin' : ''}`}>
                {isDownloadingPDF ? 'sync' : 'download'}
              </span>
              <span>{isDownloadingPDF ? 'Generating...' : 'Download PDF Summary'}</span>
            </button>
            <button
              onClick={() => setPatientMode(true)}
              className="px-4 py-2 bg-brand-sidebar hover:bg-brand-sidebar/90 text-white rounded-full flex items-center gap-2 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[16px]">account_box</span>
              <span>Patient Mode</span>
            </button>
            <button className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">
              <span className="material-symbols-outlined text-lg">edit</span>
            </button>
            <button className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">
              <span className="material-symbols-outlined text-lg">more_vert</span>
            </button>
          </div>
        </div>

        {/* Demographics Bar */}
        <div className="flex flex-wrap items-center gap-3 text-gray-500 font-semibold mb-6 pl-0 md:pl-14 animate-fade-in-up">
          <span className="flex items-center gap-1.5 text-xs md:text-sm">
            <span className="material-symbols-outlined text-[18px] text-gray-400">cake</span>
            {patient.age} Years
          </span>
          <span className="hidden md:inline w-1.5 h-1.5 rounded-full bg-gray-300"></span>
          <span className="flex items-center gap-1.5 text-xs md:text-sm">
            <span className="material-symbols-outlined text-[18px] text-gray-400">badge</span>
            ID: {patient.id}
          </span>
          <span className="hidden md:inline w-1.5 h-1.5 rounded-full bg-gray-300"></span>
          <span className="flex items-center gap-1.5 text-xs md:text-sm">
            <span className="material-symbols-outlined text-[18px] text-gray-400">
              {patient.sex?.toLowerCase() === 'female' ? 'female' : 'male'}
            </span>
            {patient.sex || 'Male'}
          </span>
        </div>
        {voiceResult && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
            <h3 className="font-bold mb-2">
              Voice Query Result
            </h3>

            <pre
              style={{
                maxHeight: 300,
                overflow: "auto"
              }}
            >
              {
                voiceResult && (
                  <VoiceResultCard
                    result={voiceResult}
                  />
                )
              }
            </pre>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-6 border-b border-gray-200 mb-6 pl-14 w-full max-w-[1600px] mx-auto animate-fade-in-up">
          <button 
            onClick={() => setActiveTab('triage')}
            className={`pb-3 font-extrabold text-sm border-b-[3px] transition-colors ${activeTab !== 'trials' ? 'border-brand-sidebar text-brand-sidebar' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            Clinical Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('trials')}
            className={`pb-3 font-extrabold text-sm border-b-[3px] transition-colors flex items-center gap-2 ${activeTab === 'trials' ? 'border-brand-blue text-brand-blue' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            <span className="material-symbols-outlined text-[18px]">science</span>
            Trial Matches
          </button>
        </div>

        {activeTab === 'trials' && (
          <div className="flex flex-col gap-6 flex-1 w-full max-w-[1600px] mx-auto px-14">
            <TrialMatcherPanel patient={patient} cachedTrials={cachedTrials} setCachedTrials={setCachedTrials} />
          </div>
        )}

        {activeTab !== 'trials' && (
          <>
            {/* Patient Voice interactions feed */}
            {patientInteractions.length > 0 && (
          <div className="bg-brand-pink/10 border border-brand-pink/30 rounded-card p-6 mb-6 animate-fade-in-up w-full max-w-[1600px] mx-auto shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-brand-pink text-[24px]">contact_support</span>
              <h3 className="text-lg font-extrabold text-brand-sidebar font-sans">Patient-Reported Symptom Feed (Voice Session)</h3>
              <span className="text-[10px] font-black bg-brand-pink text-[#1A1A1A] px-2.5 py-0.5 rounded-full uppercase tracking-wider ml-auto">
                {patientInteractions.length} New Report{patientInteractions.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {patientInteractions.map((report, idx) => (
                <div key={idx} className="bg-white border border-gray-150 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-black text-gray-500 uppercase tracking-wider font-mono">Symptom Log</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${report.severity >= 7 ? 'bg-red-500/10 text-red-650' : 'bg-brand-yellow/20 text-[#715800]'
                        }`}>
                        Severity: {report.severity || 5}/10
                      </span>
                    </div>
                    <p className="text-sm font-extrabold text-brand-sidebar font-sans">
                      {report.primary_complaint || 'General complaints'} <span className="text-xs text-gray-500 font-semibold font-sans">({report.duration || 'duration unspecified'})</span>
                    </p>
                    {report.associated_symptoms && report.associated_symptoms.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1 font-semibold font-sans">
                        Associated: {report.associated_symptoms.join(', ')}
                      </p>
                    )}
                  </div>
                  {report.severity >= 7 && (
                    <div className="flex items-center gap-1.5 bg-red-50 text-red-650 px-3 py-1.5 rounded-full border border-red-100 text-xs font-black">
                      <span className="material-symbols-outlined text-[16px] animate-pulse">error</span>
                      <span>Physician Alert Triggered</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mobile Tab Navigation */}
        <div className="lg:hidden flex overflow-x-auto gap-2 p-1.5 bg-[#EAF0AD]/40 border border-[#CFD96C]/20 rounded-[20px] mb-6 backdrop-blur-md hide-scrollbar">
          {[
            { id: 'triage', label: 'Triage Map', icon: 'health_and_safety' },
            { id: 'vitals', label: 'Vitals & Risks', icon: 'monitoring' },
            { id: 'meds', label: 'Meds & Scribe', icon: 'medication' },
            { id: 'forecast', label: 'Forecast & Sim', icon: 'insights' },
            { id: 'trials', label: 'Clinical Trials', icon: 'science' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-[14px] text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all duration-305 ${
                activeTab === tab.id
                  ? 'bg-brand-sidebar text-white shadow-md scale-[1.02]'
                  : 'text-brand-sidebar/70 hover:bg-white/40'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Desktop Layout - visible only on large screens */}
        <div className="hidden lg:flex flex-col gap-6 flex-grow w-full max-w-[1600px] mx-auto">
          {/* AI Pre-consultation (Yellow Card - Full Width) */}
          <div className="bg-brand-yellow rounded-card p-6 relative overflow-hidden flat-look animate-fade-in-up">
            <div className="blob-bg blob-yellow"></div>
            <div className="card-content">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-extrabold text-lg text-brand-sidebar flex items-center gap-2 font-sans">
                  <span className="material-symbols-outlined fill-icon text-lg">smart_toy</span>
                  AI Pre-consultation
                </h3>
                <span className="text-[10px] font-extrabold text-brand-sidebar/60 bg-brand-sidebar/5 px-3 py-1 rounded-full uppercase tracking-wider font-sans">
                  Generated 2h ago
                </span>
              </div>
              <p className="text-sm font-semibold text-brand-sidebar/85 leading-relaxed max-w-5xl font-sans">
                {patient.consultBrief ? (
                  `Patient reports increased fatigue and symptoms: ${patient.consultBrief}. Historical data suggests correlation with recent medication adherence gap. Recommend immediate review of current dosage and a localized somatic assessment to evaluate kidney/cardiac metrics.`
                ) : (
                  'Patient records show normal parameters. Clinical metrics remain within acceptable bounds. Recommend standard routine check-ups.'
                )}
              </p>
            </div>
          </div>

          {/* Section 1: Patient Intelligence Profile (3-Column Layout) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch font-sans">

            {/* Column 1: Somatic Map */}
            <div className="flex flex-col gap-6">
              <BodyMapContext patient={patient} />
            </div>

            {/* Column 2: Biometrics & Risk Assessment */}
            <div className="flex flex-col gap-6">

              {/* Biometrics Card */}
              <LabTrendChart patient={patient} />

              {/* Risk Assessment Card (Gauges) */}
              <div className="bg-[#FFD646] rounded-[32px] p-8 flex flex-col relative overflow-hidden shadow-2xl shadow-[#FFD646]/20 border border-[#FFD646]/30 animate-fade-in-up text-black h-[268px]">
                <div className="card-content flex flex-col h-full z-10 w-full">
                  <h3 className="font-headline-card text-[22px] font-bold text-black mb-4 tracking-tight flex items-center gap-2 font-sans">
                    <span className="material-symbols-outlined text-[24px]">shield</span>
                    Risk Assessment
                  </h3>
                  <div className="flex gap-6 items-center justify-around flex-1 mt-2">
                    {/* Gauge 1: Stroke Risk */}
                    <div className="flex flex-col items-center gap-2">
                      <div className="relative w-24 h-24">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="4" />
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#ba1a1a" strokeWidth="4"
                            strokeDasharray={`${(patient.riskScore >= 70 ? 65 : 35)}, 100`}
                            strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center font-black text-xl text-black">
                          {patient.riskScore >= 70 ? '65' : '35'}%
                        </div>
                      </div>
                      <span className="text-xs font-bold text-black/85 font-sans">Stroke Risk</span>
                    </div>

                    {/* Gauge 2: Renal Failure */}
                    <div className="flex flex-col items-center gap-2">
                      <div className="relative w-24 h-24">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="4" />
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1b1c1a" strokeWidth="4"
                            strokeDasharray={`${(patient.riskScore >= 70 ? 32 : 12)}, 100`}
                            strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center font-black text-xl text-black">
                          {patient.riskScore >= 70 ? '32' : '12'}%
                        </div>
                      </div>
                      <span className="text-xs font-bold text-black/85 font-sans">Renal Failure</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Column 3: Regimen & Insights */}
            <div className="flex flex-col gap-6">

              {/* Current Regimen */}
              <MedicationsPanel patient={patient} />

              {/* Dr. Insights Card */}
              <div className="bg-white rounded-[32px] p-8 flex flex-col relative overflow-hidden border border-gray-150 transition-shadow duration-300 shadow-sm hover:shadow-md animate-fade-in-up h-[268px]">
                <div className="card-content flex flex-col h-full z-10">
                  <h3 className="font-headline-card text-[22px] font-extrabold text-on-surface mb-4 tracking-tight flex items-center gap-2 font-sans">
                    <span className="material-symbols-outlined text-[24px] text-brand-blue">lightbulb</span>
                    Dr. Insights
                  </h3>
                  <ul className="flex flex-col gap-3 overflow-y-auto pr-1 custom-scrollbar">
                    {patient.riskScore >= 70 ? (
                      <>
                        <li className="flex items-start gap-2.5 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-blue text-[18px] mt-0.5 shrink-0">check_circle</span>
                          <span>Schedule echocardiogram to evaluate recent shortness of breath.</span>
                        </li>
                        <li className="flex items-start gap-2.5 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-yellow text-[18px] mt-0.5 shrink-0">check_circle</span>
                          <span>Discuss strategies for improving medication adherence immediately.</span>
                        </li>
                        <li className="flex items-start gap-2.5 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-pink text-[18px] mt-0.5 shrink-0">check_circle</span>
                          <span>Monitor renal markers (e.g. Creatinine) closely on next clinic visit.</span>
                        </li>
                      </>
                    ) : (
                      <>
                        <li className="flex items-start gap-2.5 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-blue text-[18px] mt-0.5 shrink-0">check_circle</span>
                          <span>Continue current treatment plan; patient is responding well.</span>
                        </li>
                        <li className="flex items-start gap-2.5 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-yellow text-[18px] mt-0.5 shrink-0">check_circle</span>
                          <span>Schedule routine clinical follow-up in 3 months.</span>
                        </li>
                        <li className="flex items-start gap-2.5 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-pink text-[18px] mt-0.5 shrink-0">check_circle</span>
                          <span>Recommend standard lifestyle and dietary adjustments.</span>
                        </li>
                      </>
                    )}
                  </ul>
                </div>
              </div>

            </div>

          </div>

          {/* Section Divider / Transition Header */}
          <div className="mt-10 mb-4 animate-fade-in-up font-sans">
            <h2 className="text-[28px] font-bold text-brand-sidebar tracking-tight flex items-center gap-3">
              <span className="material-symbols-outlined text-black text-[32px]">insights</span>
              Deep Analytics
            </h2>
            <p className="text-sm font-semibold text-gray-500 mt-1">Advanced forecasting and intervention simulations</p>
          </div>

          {/* Section 2: Deep Analytics (Split into Two Rows for Perfect Alignment) */}
          <div className="flex flex-col gap-8">
            {/* Row 1: Scribe, Clinical Query, and Alert Feed */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start font-sans animate-fade-in-up">
              {/* Left Column (col-span-8) */}
              <div className="lg:col-span-8 flex flex-col gap-8">
                {/* Consultation Scribe (Recorder) */}
                <ConsultationRecorder patientId={patient.id} />

                {/* Query Co-Pilot (Clinical Query) */}
                <NaturalLanguageQuery patient={patient} />
              </div>

              {/* Right Column (col-span-4) */}
              <div className="lg:col-span-4 flex flex-col gap-8">
                {/* Alert Feed */}
                <ClinicalPatternFeed patient={patient} />
              </div>
            </div>

            {/* Row 2: Trajectory Forecast, Simulator, and AI Opinion */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start font-sans animate-fade-in-up">
              {/* Left Column (col-span-8) */}
              <div className="lg:col-span-8 flex flex-col gap-6">
                {/* Trajectory Forecast & Intervention Simulator */}
                <TrajectoryPreview patient={patient} />
              </div>

              {/* Right Column (col-span-4) */}
              <div className="lg:col-span-4 flex flex-col gap-8">
                {/* AI Opinion Co-Pilot */}
                <SecondOpinionPanel patient={patient} />
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Layout - visible only on mobile screens */}
        <div className="lg:hidden flex flex-col gap-6 flex-1 w-full max-w-[1600px] mx-auto">
          {activeTab === 'triage' && (
            <div className="flex flex-col gap-6 animate-fade-in-up">
              {/* AI Pre-consultation (Yellow Card) */}
              <div className="bg-brand-yellow rounded-card p-6 relative overflow-hidden flat-look">
                <div className="blob-bg blob-yellow"></div>
                <div className="card-content">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-extrabold text-base text-brand-sidebar flex items-center gap-2 font-sans">
                      <span className="material-symbols-outlined fill-icon text-lg">smart_toy</span>
                      AI Pre-consultation
                    </h3>
                  </div>
                  <p className="text-sm font-semibold text-brand-sidebar/85 leading-relaxed font-sans">
                    {patient.consultBrief ? (
                      `Patient reports increased fatigue and symptoms: ${patient.consultBrief}. Historical data suggests correlation with recent medication adherence gap. Recommend immediate review of current dosage and a localized somatic assessment to evaluate kidney/cardiac metrics.`
                    ) : (
                      'Patient records show normal parameters. Clinical metrics remain within acceptable bounds. Recommend standard routine check-ups.'
                    )}
                  </p>
                </div>
              </div>
              {/* Somatic Map */}
              <BodyMapContext patient={patient} />
              {/* Alert Feed */}
              <ClinicalPatternFeed patient={patient} />
            </div>
          )}

          {activeTab === 'vitals' && (
            <div className="flex flex-col gap-6 animate-fade-in-up">
              {/* Biometrics Card */}
              <LabTrendChart patient={patient} />

              {/* Risk Assessment Card (Gauges) */}
              <div className="bg-[#FFD646] rounded-[32px] p-6 flex flex-col relative overflow-hidden border border-[#FFD646]/30 text-black">
                <div className="card-content flex flex-col w-full">
                  <h3 className="font-headline-card text-[20px] font-bold text-black mb-4 tracking-tight flex items-center gap-2 font-sans">
                    <span className="material-symbols-outlined text-[22px]">shield</span>
                    Risk Assessment
                  </h3>
                  <div className="flex gap-4 items-center justify-around mt-2">
                    {/* Gauge 1: Stroke Risk */}
                    <div className="flex flex-col items-center gap-2">
                      <div className="relative w-20 h-20">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="4" />
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#ba1a1a" strokeWidth="4"
                            strokeDasharray={`${(patient.riskScore >= 70 ? 65 : 35)}, 100`}
                            strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center font-black text-lg text-black">
                          {patient.riskScore >= 70 ? '65' : '35'}%
                        </div>
                      </div>
                      <span className="text-xs font-bold text-black/85 font-sans">Stroke Risk</span>
                    </div>

                    {/* Gauge 2: Renal Failure */}
                    <div className="flex flex-col items-center gap-2">
                      <div className="relative w-20 h-20">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="4" />
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1b1c1a" strokeWidth="4"
                            strokeDasharray={`${(patient.riskScore >= 70 ? 32 : 12)}, 100`}
                            strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center font-black text-lg text-black">
                          {patient.riskScore >= 70 ? '32' : '12'}%
                        </div>
                      </div>
                      <span className="text-xs font-bold text-black/85 font-sans">Renal Failure</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Dr. Insights Card */}
              <div className="bg-white rounded-[32px] p-6 flex flex-col relative overflow-hidden border border-gray-150 shadow-sm h-[250px]">
                <div className="card-content flex flex-col h-full">
                  <h3 className="font-headline-card text-[20px] font-extrabold text-on-surface mb-3 tracking-tight flex items-center gap-2 font-sans">
                    <span className="material-symbols-outlined text-[22px] text-brand-blue">lightbulb</span>
                    Dr. Insights
                  </h3>
                  <ul className="flex flex-col gap-3 overflow-y-auto pr-1 custom-scrollbar">
                    {patient.riskScore >= 70 ? (
                      <>
                        <li className="flex items-start gap-2 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-blue text-[16px] mt-0.5 shrink-0">check_circle</span>
                          <span>Schedule echocardiogram to evaluate recent shortness of breath.</span>
                        </li>
                        <li className="flex items-start gap-2 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-yellow text-[16px] mt-0.5 shrink-0">check_circle</span>
                          <span>Discuss strategies for improving medication adherence immediately.</span>
                        </li>
                        <li className="flex items-start gap-2 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-pink text-[16px] mt-0.5 shrink-0">check_circle</span>
                          <span>Monitor renal markers (e.g. Creatinine) closely on next clinic visit.</span>
                        </li>
                      </>
                    ) : (
                      <>
                        <li className="flex items-start gap-2 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-blue text-[16px] mt-0.5 shrink-0">check_circle</span>
                          <span>Continue current treatment plan; patient is responding well.</span>
                        </li>
                        <li className="flex items-start gap-2 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-yellow text-[16px] mt-0.5 shrink-0">check_circle</span>
                          <span>Schedule routine clinical follow-up in 3 months.</span>
                        </li>
                        <li className="flex items-start gap-2 text-xs font-semibold text-on-surface/80 font-sans">
                          <span className="material-symbols-outlined text-brand-pink text-[16px] mt-0.5 shrink-0">check_circle</span>
                          <span>Recommend standard lifestyle and dietary adjustments.</span>
                        </li>
                      </>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'meds' && (
            <div className="flex flex-col gap-6 animate-fade-in-up">
              {/* Current Regimen */}
              <MedicationsPanel patient={patient} />
              {/* Scribe */}
              <ConsultationRecorder patientId={patient.id} />
              {/* Query Co-Pilot */}
              <NaturalLanguageQuery patient={patient} />
              {/* AI Opinion */}
              <SecondOpinionPanel patient={patient} />
            </div>
          )}

          {activeTab === 'forecast' && (
            <div className="flex flex-col gap-6 animate-fade-in-up">
              {/* Trajectory Forecast & Intervention Simulator */}
              <TrajectoryPreview patient={patient} />
            </div>
          )}

          {activeTab === 'trials' && (
            <div className="flex flex-col gap-6 animate-fade-in-up">
              <TrialMatcherPanel patient={patient} cachedTrials={cachedTrials} setCachedTrials={setCachedTrials} />
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
};

export default PatientIntel;
