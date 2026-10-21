import { useState, useEffect } from 'react';

// Expected 13-Step Flow
const DEMO_STEPS = [
  { id: 1, action: 'start', wait: 1000 },
  // 1. Auto-selects Patient A (Arjun Mehta)
  { id: 2, action: 'select_patient_a', wait: 500 },
  // 2. Navigates to Overview, pauses 3 seconds
  { id: 3, action: 'nav_overview', wait: 3000 },
  // 3. Navigates to Patient Intel, waits for brief to render
  { id: 4, action: 'nav_intel', wait: 2000 },
  // 4. Clicks the kidney node on the body map
  { id: 5, action: 'click_kidney', wait: 2500 },
  // 5. Switches lab to 'Creatinine' tab
  { id: 6, action: 'switch_lab_creatinine', wait: 1500 },
  // 6. Auto-types into NL query bar 'What is the creatinine trend?'
  { id: 7, action: 'type_query', payload: 'What is the creatinine trend?', wait: 3500 }, // type timing baked in component later
  // 7. Submits query
  { id: 8, action: 'submit_query', wait: 5000 }, // wait for AI response
  // 8. Types into Second Opinion: 'Diabetic nephropathy'
  { id: 9, action: 'type_opinion', payload: 'Diabetic nephropathy', wait: 3000 },
  // 9. Submits
  { id: 10, action: 'submit_opinion', wait: 4000 },
  // 10. Navigates to Pill Guard
  { id: 11, action: 'nav_pillguard', wait: 2000 },
  // 11. Auto-clicks 'Simulate Scan'
  { id: 12, action: 'simulate_scan', wait: 5000 },
  // 12. Navigates to Alert Centre
  { id: 13, action: 'nav_alerts', wait: 3000 },
  // 13. End
  { id: 14, action: 'end', wait: 0 },
];

export function useDemoMode({ patients, setCurrentPatient, setCurrentView }) {
  const [isDemoActive, setIsDemoActive] = useState(false);
  const [demoStepIndex, setDemoStepIndex] = useState(0);

  // Global dispatched states for demo UI syncing
  const [demoEvent, setDemoEvent] = useState(null);

  useEffect(() => {
    if (!isDemoActive) {
      setDemoStepIndex(0);
      setDemoEvent(null);
      return;
    }

    const step = DEMO_STEPS[demoStepIndex];
    if (!step) return;

    let timer;

    const executeStep = () => {
      // Broadcast event for UI components to listen to
      setDemoEvent({ action: step.action, payload: step.payload });

      // Core routing & state manipulation
      switch (step.action) {
        case 'select_patient_a':
          if (patients.length > 0) setCurrentPatient(patients[0]);
          break;
        case 'nav_overview':
          setCurrentView('overview');
          break;
        case 'nav_intel':
          setCurrentView('patient');
          break;
        case 'nav_pillguard':
          setCurrentView('pillguard');
          break;
        case 'nav_alerts':
          setCurrentView('alerts');
          break;
        case 'end':
          setIsDemoActive(false);
          setDemoStepIndex(0);
          return; // Stop here
      }

      // Schedule next
      timer = setTimeout(() => {
        setDemoStepIndex(prev => prev + 1);
      }, step.wait);
    };

    executeStep();

    return () => clearTimeout(timer);
  }, [isDemoActive, demoStepIndex, patients, setCurrentPatient, setCurrentView]);

  return {
    isDemoActive,
    setIsDemoActive,
    demoStepIndex: isDemoActive ? (demoStepIndex > 0 ? demoStepIndex : 1) : 0, // 1-13 formatted
    totalSteps: 13,
    demoEvent
  };
}
