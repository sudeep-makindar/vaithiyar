import React, { useState, useEffect } from 'react';
import { T } from '../tokens';
import { fetchPillEvents } from '../api';
import GlassPanel from './GlassPanel';
import Badge from './Badge';
import { BASE_API } from '../config.js';

const RightPillPanel = () => {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    // We will fetch patients, then extract all their recent clinical patterns
    fetch(`${BASE_API}/patients`)
      .then(r => r.json())
      .then(patients => {
        let allPatterns = [];
        patients.forEach(p => {
          if (p.clinicalPatterns) {
            p.clinicalPatterns.forEach(pattern => {
              allPatterns.push({ ...pattern, patientName: p.name });
            });
          }
        });
        setEvents(allPatterns.slice(0, 6)); // Just grab the most recent ones
      });
  }, []);

  return (
    <GlassPanel className="fadeIn" style={{
      width: '320px',
      padding: '24px 20px',
      height: '100%',
      animationDelay: '0.2s',
      display: 'flex',
      flexDirection: 'column',
      border: `1px solid ${T.borderSubtle}`,
      background: T.bgCard
    }}>
      <div style={{
        fontSize: '11px',
        fontWeight: '500',
        color: T.textSecondary,
        letterSpacing: '0.08em',
        marginBottom: '20px',
        borderBottom: `1px solid ${T.borderSubtle}`,
        paddingBottom: '12px',
        fontFamily: T.fontUi,
        textTransform: 'uppercase'
      }}>
        SYSTEM LOGS & ANOMALIES
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, overflowY: 'auto' }}>
        {events.map((evt, idx) => {

          let statusColor = 'teal';
          if (evt.severity === 'HIGH') statusColor = 'red';
          if (evt.severity === 'MEDIUM') statusColor = 'amber';

          return (
            <div key={idx} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '16px',
              borderRadius: '12px',
              background: 'var(--bg-input)',
              border: `1px solid ${T.borderSubtle}`,
              animation: `fadeSlideUp 0.3s ease forwards`,
              animationDelay: `${0.3 + (idx * 0.1)}s`,
              opacity: 0
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '11px', fontWeight: '500', color: T.textSecondary, fontFamily: T.fontUi }}>
                  <span style={{ marginRight: '8px', opacity: 0.6 }}>🕒</span>
                  {evt.time}
                </div>
                <Badge variant={statusColor}>{evt.type}</Badge>
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: '400', color: T.textPrimary, marginBottom: '8px', letterSpacing: '0.03em', fontFamily: T.fontBody, lineHeight: '1.4' }}>
                  {evt.description}
                </div>

                <div style={{ fontSize: '11px', color: T.textSecondary, marginTop: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Patient: <span style={{ color: T.teal }}>{evt.patientName}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${T.borderSubtle}` }}>
        <button style={{
          width: '100%',
          padding: '12px',
          background: 'transparent',
          border: `1px solid ${T.tealBorder}`,
          color: T.teal,
          borderRadius: '999px',
          fontSize: '11px',
          fontWeight: '500',
          cursor: 'pointer',
          transition: 'all 0.3s',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily: T.fontUi
        }}
          onMouseEnter={e => {
            e.currentTarget.style.background = T.tealDim;
            e.currentTarget.style.boxShadow = `0 0 12px ${T.tealDim}`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          VIEW FULL LOG
        </button>
      </div>

    </GlassPanel>
  );
};

export default RightPillPanel;
