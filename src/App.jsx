import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import BottomNav from './components/BottomNav';
import Overview from './views/Overview';
import PatientIntel from './views/PatientIntel';
import PillGuard from './views/PillGuard';
import Analytics from './views/Analytics';
import AlertCentre from './views/AlertCentre';
import Intake from './views/Intake';
import Forecast from './pages/Forecast';
import ComorbidityWeb from './pages/ComorbidityWeb';
import TrialMatcherPage from './pages/TrialMatcherPage';
import { usePatientStore } from './stores/patientStore';
import { T } from './tokens';
import ShaderBackground from './components/ShaderBackground';
import { BASE_API } from './config.js';

function AppContent() {
  const navigate = useNavigate();
  const { 
    patients, 
    currentPatient, 
    loading, 
    isOffline, 
    loadPatients, 
    setCurrentPatient,
    refreshPatients 
  } = usePatientStore();

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  const setCurrentView = (view) => {
    switch (view) {
      case 'overview': navigate('/'); break;
      case 'intake': navigate('/intake'); break;
      case 'patient-registry': navigate('/registry'); break;
      case 'patient': 
        if (currentPatient) {
          navigate(`/patient/${currentPatient.id}`);
        } else {
          navigate('/registry');
        }
        break;
      case 'pillguard': navigate('/pillguard'); break;
      case 'analytics': navigate('/analytics'); break;
      case 'alerts': navigate('/alerts'); break;
      case 'forecast': navigate('/forecast'); break;
      case 'comorbidity': navigate('/comorbidity'); break;
      default: navigate('/');
    }
  };

  const handleDeletePatient = async (id) => {
    try {
      await fetch(`${BASE_API}/patient/${id}`, { method: 'DELETE' });
      await refreshPatients();
      navigate('/registry');
    } catch (err) {
      console.error(err);
      alert('Failed to delete patient');
    }
  };

  if (loading) {
    return (
      <div style={{
        background: '#0a0a0c',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'DM Sans', sans-serif",
        color: 'white',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap');
          @keyframes blob {
            0%   { transform: translate(0px, 0px) scale(1); }
            33%  { transform: translate(30px, -50px) scale(1.1); }
            66%  { transform: translate(-20px, 20px) scale(0.9); }
            100% { transform: translate(0px, 0px) scale(1); }
          }
          @keyframes float {
            0%, 100% { transform: translateY(0); }
            50%       { transform: translateY(-10px); }
          }
          @keyframes pulse-glow {
            0%, 100% { opacity: 0.8; transform: scale(1); filter: hue-rotate(0deg); }
            50%       { opacity: 1; transform: scale(1.05); filter: hue-rotate(15deg); }
          }
          @keyframes shimmer {
            100% { transform: translateX(200%); }
          }
          @keyframes particle-drift {
            0%   { transform: translate(0,0) scale(1); opacity: 0.3; }
            50%  { opacity: 0.8; }
            100% { transform: translate(var(--tx), var(--ty)) scale(1.5); opacity: 0; }
          }
          @keyframes progress-fill {
            0%   { width: 0%; }
            60%  { width: 72%; }
            85%  { width: 88%; }
            100% { width: 94%; }
          }
          .cliniq-blob { position:absolute; border-radius:50%; mix-blend-mode:screen; filter:blur(100px); animation: blob 10s infinite; }
          .cliniq-bokeh { position:absolute; border-radius:50%; filter:blur(4px); animation: particle-drift 8s infinite ease-in-out alternate; }
          .cliniq-card {
            background: rgba(17,18,21,0.4);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            border: 1px solid rgba(255,255,255,0.1);
            border-top-color: rgba(255,255,255,0.2);
            border-left-color: rgba(255,255,255,0.15);
            box-shadow: 0 8px 32px 0 rgba(0,0,0,0.5), inset 0 0 20px rgba(255,255,255,0.05);
            border-radius: 20px;
            padding: 40px 36px;
            width: 100%;
            max-width: 420px;
            display: flex;
            flex-direction: column;
            align-items: center;
            animation: float 6s ease-in-out infinite;
            position: relative;
            overflow: hidden;
          }
          .cliniq-logo {
            background: linear-gradient(to right, #FFD700, #FF69B4, #00BFFF);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: none;
            font-size: 3.2rem;
            font-weight: 800;
            letter-spacing: -0.02em;
            animation: pulse-glow 4s ease-in-out infinite;
            margin-bottom: 36px;
          }
          .cliniq-progress-track {
            height: 12px; width: 100%; background: rgba(10,10,12,0.8);
            border-radius: 999px; overflow: hidden;
            border: 1px solid rgba(255,255,255,0.1);
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.4);
            position: relative;
          }
          .cliniq-progress-fill {
            position: absolute; inset-block: 0; left: 0;
            background: linear-gradient(to right, #00BFFF, #FF69B4, #FFD700);
            border-radius: 999px;
            box-shadow: 0 0 15px rgba(0,191,255,0.8), 0 0 30px rgba(255,105,180,0.4);
            animation: progress-fill 3s ease-out forwards;
            overflow: hidden;
          }
          .cliniq-shimmer {
            position: absolute; inset: 0;
            background: linear-gradient(to right, transparent, rgba(255,255,255,0.4), transparent);
            width: 40%;
            animation: shimmer 1.5s infinite;
          }
          .cliniq-badge {
            margin-top: 20px;
            display: inline-flex; align-items: center; gap: 8px;
            padding: 10px 20px; border-radius: 999px;
            background: rgba(10,10,12,0.6);
            border: 1px solid rgba(0,191,255,0.3);
            box-shadow: 0 0 15px rgba(0,191,255,0.15);
            backdrop-filter: blur(12px);
          }
        `}</style>

        {/* Background blobs */}
        <div style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:0,overflow:'hidden'}}>
          <div className="cliniq-blob" style={{width:384,height:384,top:0,left:'25%',background:'rgba(0,191,255,0.3)',animationDelay:'0s'}} />
          <div className="cliniq-blob" style={{width:384,height:384,top:'25%',right:'25%',background:'rgba(255,105,180,0.3)',animationDelay:'2s'}} />
          <div className="cliniq-blob" style={{width:384,height:384,bottom:-32,left:'33%',background:'rgba(255,215,0,0.2)',animationDelay:'4s'}} />
          {/* Bokeh particles */}
          <div className="cliniq-bokeh" style={{width:24,height:24,top:'25%',left:'20%',background:'rgba(255,215,0,0.6)','--tx':'50px','--ty':'-50px',animationDelay:'0s'}} />
          <div className="cliniq-bokeh" style={{width:32,height:32,bottom:'33%',right:'25%',background:'rgba(255,105,180,0.6)','--tx':'-40px','--ty':'-90px',animationDelay:'2s'}} />
          <div className="cliniq-bokeh" style={{width:16,height:16,top:'33%',right:'33%',background:'rgba(0,191,255,0.8)','--tx':'70px','--ty':'30px',animationDelay:'4s'}} />
          <div className="cliniq-bokeh" style={{width:20,height:20,bottom:'25%',left:'33%',background:'rgba(0,191,255,0.5)','--tx':'-50px','--ty':'70px',animationDelay:'1s'}} />
          <div className="cliniq-bokeh" style={{width:28,height:28,top:'50%',left:'66%',background:'rgba(255,215,0,0.5)','--tx':'30px','--ty':'-60px',animationDelay:'3s'}} />
        </div>

        {/* Card */}
        <div style={{position:'relative',zIndex:10,width:'100%',maxWidth:440,padding:'0 24px'}}>
          <div className="cliniq-card">
            {/* Inner gloss */}
            <div style={{position:'absolute',inset:0,background:'linear-gradient(135deg, rgba(255,255,255,0.05), transparent)',pointerEvents:'none',borderRadius:20}} />

            {/* Logo */}
            <div style={{position:'relative',zIndex:1,textAlign:'center'}}>
              <h1 className="cliniq-logo">ClinIQ+</h1>
            </div>

            {/* Progress section */}
            <div style={{width:'100%',marginBottom:24,position:'relative',zIndex:1}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:12}}>
                <div style={{display:'flex',flexDirection:'column'}}>
                  <span style={{fontSize:11,color:'rgba(0,191,255,0.8)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.12em',marginBottom:4}}>Status</span>
                  <span style={{fontSize:17,color:'#f3f4f6',fontWeight:600,letterSpacing:'0.01em'}}>Initializing clinical data...</span>
                </div>
                <span style={{fontSize:36,fontWeight:700,background:'linear-gradient(to top, #d1d5db, #fff)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>94%</span>
              </div>

              {/* Progress bar */}
              <div className="cliniq-progress-track">
                <div className="cliniq-progress-fill">
                  <div className="cliniq-shimmer" />
                </div>
              </div>
              <p style={{fontSize:13,color:'#9ca3af',marginTop:10,textAlign:'right',fontWeight:500}}>Connecting to core systems</p>
            </div>

            {/* Badge */}
            <div className="cliniq-badge">
              <svg style={{height:16,width:16,color:'#00BFFF',filter:'drop-shadow(0 0 5px rgba(0,191,255,0.8))'}} fill="currentColor" viewBox="0 0 20 20">
                <path clipRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" fillRule="evenodd" />
              </svg>
              <span style={{fontSize:12,fontWeight:600,letterSpacing:'0.04em',color:'#e5e7eb'}}>Secure Enterprise Environment</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleVoiceAction = (actionObj) => {
    console.log("Global Voice Action Intercepted:", actionObj);
    
    if (actionObj.action === 'navigate_page') {
      const page = actionObj.target.toLowerCase();
      if (page.includes('dashboard') || page.includes('overview') || page.includes('home')) {
        setCurrentView('overview');
      } else if (page.includes('forecast')) {
        setCurrentView('forecast');
      } else if (page.includes('comorbidity') || page.includes('network')) {
        setCurrentView('comorbidity');
      } else if (page.includes('alert')) {
        setCurrentView('alerts');
      } else if (page.includes('analytics') || page.includes('chart')) {
        setCurrentView('analytics');
      } else if (page.includes('pillguard') || page.includes('scanner') || page.includes('pill')) {
        setCurrentView('pillguard');
      } else if (page.includes('patient') || page.includes('registry')) {
        setCurrentView('patient-registry');
      } else if (page.includes('intake')) {
        setCurrentView('intake');
      }
    } else if (actionObj.action === 'show_patient') {
      const name = actionObj.target.toLowerCase();
      const p = patients.find(pat => pat.name.toLowerCase().includes(name) || pat.id.toLowerCase() === name);
      if (p) {
        setCurrentPatient(p);
        navigate(`/patient/${p.id}`);
      }
    }
  };

  return (
    <div style={{ display: 'flex', width: '100%', minHeight: '100vh', flexDirection: 'column', backgroundColor: 'transparent' }}>
      <ShaderBackground />
      
      {/* Offline Banner */}
      {isOffline && (
        <div style={{
          width: '100%',
          background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.05) 0%, rgba(245, 158, 11, 0.1) 50%, rgba(245, 158, 11, 0.05) 100%)',
          color: T.amber,
          fontSize: '10px',
          fontWeight: '800',
          padding: '8px 16px',
          textAlign: 'center',
          borderBottom: `1px solid rgba(245, 158, 11, 0.2)`,
          letterSpacing: '0.15em',
          zIndex: 100,
          fontFamily: T.fontMono,
          textTransform: 'uppercase'
        }}>
          <span style={{ marginRight: '8px' }}>⚠</span> SYSTEM ARCHIVE UNAVAILABLE — INITIALIZING LOCAL NEURAL CACHE (DEMO MODE)
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />

        <main className="pl-0 md:pl-[268px] pb-16 md:pb-0" style={{ flex: 1, position: 'relative', overflowY: 'auto', height: '100vh', background: 'transparent' }}>
          <Routes>
            <Route path="/" element={<Overview setCurrentView={setCurrentView} setCurrentPatient={setCurrentPatient} patients={patients} />} />
            <Route path="/intake" element={<Intake patient={currentPatient} patients={patients} setCurrentPatient={setCurrentPatient} refreshPatients={refreshPatients} setCurrentView={setCurrentView} />} />
            <Route path="/registry" element={<PatientIntel patients={patients} patient={currentPatient} setCurrentPatient={setCurrentPatient} setCurrentView={setCurrentView} startInRegistry={true} onDeletePatient={handleDeletePatient} />} />
            <Route path="/patient/:id" element={<PatientIntel patients={patients} patient={currentPatient} setCurrentPatient={setCurrentPatient} setCurrentView={setCurrentView} startInRegistry={false} onDeletePatient={handleDeletePatient} />} />
            <Route path="/forecast" element={<Forecast />} />
            <Route path="/comorbidity" element={<ComorbidityWeb />} />
            <Route path="/pillguard" element={<PillGuard patient={currentPatient} />} />
            <Route path="/analytics" element={<Analytics patients={patients} />} />
            <Route path="/alerts" element={<AlertCentre patients={patients} />} />
            <Route path="/trials" element={<TrialMatcherPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
        
        <BottomNav />
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
