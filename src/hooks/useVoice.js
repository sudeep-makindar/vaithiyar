import { useState, useEffect, useRef } from 'react';
import { normalizeDrugName } from '../constants/drugNameMap';
import { normalizeClinicalTerm } from '../constants/clinicalTermMap';
import { BASE_API } from '../config.js';
import { usePatientStore } from '../stores/patientStore';

export const useVoice = (onActionExecuted) => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastAction, setLastAction] = useState(null);
  const [error, setError] = useState('');

  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const synthesisUtteranceRef = useRef(null);

  // Initialize Native Web Speech APIs
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      recognitionRef.current = rec;
    }
    return () => {
      stopSpeaking();
    };
  }, []);

  const startListening = async (context = 'command', languageCode = 'en-US') => {
    setError('');
    setTranscript('');
    setIsListening(true);
    audioChunksRef.current = [];

    // Native English Web Speech fallback for instant response
    const useNativeSpeech = languageCode.startsWith('en') && recognitionRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Setup Web Audio VAD
      setupVAD(stream, () => {
        console.log("VAD: Silence detected, auto-stopping.");
        stopListening(context, languageCode, useNativeSpeech);
      });

      if (useNativeSpeech) {
        const rec = recognitionRef.current;
        rec.lang = languageCode;
        
        rec.onresult = (e) => {
          const resultText = e.results[0][0].transcript;
          setTranscript(resultText);
          handleSTTComplete(resultText, context);
        };

        rec.onerror = (e) => {
          console.error("Native STT error:", e.error);
          if (e.error === 'no-speech') {
            setError('No speech detected.');
          }
        };

        rec.onend = () => {
          setIsListening(false);
        };

        rec.start();
      } else {
        // Record audio blob for backend processing
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
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          setIsListening(false);
          await uploadAndTranscribe(audioBlob, languageCode, context);
        };

        mediaRecorder.start(250);
      }
    } catch (err) {
      console.error("Microphone access failed:", err);
      setError("Microphone permission denied or unavailable.");
      setIsListening(false);
    }
  };

  const stopListening = (context = 'command', languageCode = 'en-US', isNative = false) => {
    // Stop VAD streams
    cleanupAudioContext();

    if (isNative && recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
    }
    setIsListening(false);
  };

  // Web Audio decibel-based VAD (Voice Activity Detection)
  const setupVAD = (stream, onSilence) => {
    cleanupAudioContext();

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      let silenceStart = null;
      const silenceThreshold = 15; // Decibel energy threshold
      const silenceDuration = 1800; // Auto-stop after 1.8 seconds of silence

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;

        if (avg < silenceThreshold) {
          if (!silenceStart) {
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart > silenceDuration) {
            onSilence();
            return;
          }
        } else {
          silenceStart = null; // Voice active, reset timer
        }

        requestAnimationFrame(checkVolume);
      };

      requestAnimationFrame(checkVolume);
    } catch (e) {
      console.error("Failed to setup VAD:", e);
    }
  };

  const cleanupAudioContext = () => {
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch(e) {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const uploadAndTranscribe = async (audioBlob, languageCode, context) => {
    setIsProcessing(true);
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");
    formData.append("language_code", languageCode);
    formData.append("context", context);

    try {
      const res = await fetch(`${BASE_API}/voice/transcribe`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      
      if (data.transcribed_text) {
        setTranscript(data.transcribed_text);
        await handleSTTComplete(data.transcribed_text, context, languageCode);
      } else {
        setError("Speech recognition failed.");
        setIsProcessing(false);
      }
    } catch (err) {
      console.error("Transcribe API error:", err);
      setError("Network error during transcription.");
      setIsProcessing(false);
    }
  };

  const handleSTTComplete = async (rawText, context, languageCode = 'en-US') => {
    setIsProcessing(true);
    
    // Normalize regional slangs and brand names
    const normalizedText = normalizeClinicalTerm(normalizeDrugName(rawText));
    console.log(`STT Complete: "${rawText}" -> Normalized: "${normalizedText}"`);

    if (context === 'command') {
      await sendCommand(normalizedText);
    } else {
      setIsProcessing(false);
    }
  };

  const sendCommand = async (commandText) => {
    try {
      const page = window.location.pathname.split('/').pop() || 'dashboard';
      const res = await fetch(`${BASE_API}/voice/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcribed_text: commandText,
          current_page: page,
          patient_id: usePatientStore.getState().currentPatient?.id || null
        })
      });
      const actionData = await res.json();
      setLastAction(actionData);
      setIsProcessing(false);

      if (actionData.clarification_needed) {
        speak(actionData.clarification_prompt);
      } else {
        // Execute command in UI
        if (onActionExecuted) {
          onActionExecuted(actionData);
        }
      }
    } catch (err) {
      console.error("Command processing error:", err);
      setError("Failed to interpret voice command.");
      setIsProcessing(false);
    }
  };

  // Amazon Polly neural voices (served by /voice/synthesize on AWS); browser TTS otherwise
  const pollyAudioRef = useRef(null);
  const POLLY_LANGS = ['en-IN', 'hi-IN', 'en-US', 'en-GB'];

  const speak = async (text, languageCode = 'en-US') => {
    stopSpeaking();

    if (POLLY_LANGS.includes(languageCode)) {
      try {
        const res = await fetch(`${BASE_API}/voice/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language_code: languageCode })
        });
        const data = await res.json();
        if (data.audio_base64) {
          const audio = new Audio(`data:audio/mp3;base64,${data.audio_base64}`);
          audio.onplay = () => setIsSpeaking(true);
          audio.onended = () => setIsSpeaking(false);
          audio.onerror = () => setIsSpeaking(false);
          pollyAudioRef.current = audio;
          await audio.play();
          return;
        }
      } catch (err) {
        console.warn("Polly synthesis unavailable, using browser voice.", err);
      }
    }

    speakWithBrowser(text, languageCode);
  };

  // Native Speech Synthesis / TTS with high-quality voice select
  const speakWithBrowser = (text, languageCode) => {
    if (!window.speechSynthesis) {
      setError("Text to speech not supported in this browser.");
      return;
    }

    // Map language code to Neural2 equivalences
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = languageCode;

    // Pick an appropriate voice
    const voices = window.speechSynthesis.getVoices();
    let selectedVoice = null;

    if (languageCode.startsWith('hi')) {
      selectedVoice = voices.find(v => v.lang.includes('hi') && v.name.includes('Google'));
    } else if (languageCode.startsWith('ta')) {
      selectedVoice = voices.find(v => v.lang.includes('ta'));
    } else if (languageCode.startsWith('te')) {
      selectedVoice = voices.find(v => v.lang.includes('te'));
    } else if (languageCode.startsWith('en')) {
      selectedVoice = voices.find(v => v.lang.includes('en-IN') || v.lang.includes('en-GB') || v.name.includes('Google'));
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    synthesisUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    if (pollyAudioRef.current) {
      pollyAudioRef.current.pause();
      pollyAudioRef.current = null;
      setIsSpeaking(false);
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  const translateAndSpeak = async (text, targetLanguage) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`${BASE_API}/voice/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          target_language: targetLanguage
        })
      });
      const data = await res.json();
      setIsProcessing(false);
      if (data.translated_text) {
        speak(data.translated_text, targetLanguage);
      }
    } catch (err) {
      console.error("Translation failed:", err);
      setIsProcessing(false);
      speak(text); // fallback
    }
  };

  return {
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    translateAndSpeak,
    isListening,
    isSpeaking,
    isProcessing,
    transcript,
    lastAction,
    error,
    setError
  };
};
