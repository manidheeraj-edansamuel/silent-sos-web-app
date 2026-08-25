import { useState, useEffect, useCallback } from 'react';

export default function App() {
  const [healthData, setHealthData] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'connected' | 'unavailable'
  const [errorMsg, setErrorMsg] = useState('');
  const [lastChecked, setLastChecked] = useState(null);

  const checkHealth = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const response = await fetch('/api/v1/health', {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status} (${response.statusText})`);
      }

      const data = await response.json();
      if (data.status === 'ok') {
        setHealthData(data);
        setStatus('connected');
      } else {
        throw new Error(data.message || 'Health status returned non-ok');
      }
    } catch (err) {
      console.error('[Health Check Failed]:', err);
      setStatus('unavailable');
      setErrorMsg(err.message || 'Unable to connect to backend server');
    } finally {
      setLastChecked(new Date().toLocaleTimeString());
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const milestones = [
    {
      step: 'Step 1',
      name: 'Project Initialization & Baseline Verification',
      status: 'Completed',
      active: false,
      desc: 'Monorepo scaffolding, React/Vite frontend, Express backend, /api/v1/health, and safety guardrails.',
    },
    {
      step: 'Step 2',
      name: 'Database & Geospatial Modeling',
      status: 'Active / Completed',
      active: true,
      desc: 'PostgreSQL 18.6 + PostGIS 3.6.2 schemas, migrations (001-007), GiST spatial index, and seeds.',
    },
    {
      step: 'Step 3',
      name: 'Secure Authentication & Contacts',
      status: 'Planned',
      active: false,
      desc: 'User management, password hashing, JWT sessions, and trusted contacts directory.',
    },
    {
      step: 'Step 4',
      name: 'Silent SOS Trigger & Location Engine',
      status: 'Planned',
      active: false,
      desc: 'Stealth SOS triggers, high-entropy tracking tokens, and geolocation breadcrumbs.',
    },
    {
      step: 'Step 5',
      name: 'Real-time Gateway & Notifications',
      status: 'Planned',
      active: false,
      desc: 'Socket.IO live streaming, BullMQ queue, Twilio/SMS & Email alerts, and tracking portal.',
    },
  ];

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <h1 className="brand-title">Silent SOS</h1>
            <p className="brand-tagline">Emergency Alert & Silent Location System</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <span className="badge badge-step">Phase: Step 2 Initialized</span>
          {status === 'connected' && (
            <span className="badge badge-connected">
              <span className="status-dot online"></span> API Online
            </span>
          )}
          {status === 'unavailable' && (
            <span className="badge badge-unavailable">
              <span className="status-dot offline"></span> API Offline
            </span>
          )}
        </div>
      </header>

      {/* Safety Notice Banner */}
      <section className="safety-banner">
        <div className="safety-banner-icon">⚠️</div>
        <div>
          <h2 className="safety-banner-title">Safety Constraints & Protocol Notice</h2>
          <p className="safety-banner-text">
            This application is engineered for critical safety situations. It is strictly supplementary and does not replace official emergency services. 
            Background GPS and instant delivery are subject to device and network limitations.
          </p>
        </div>
      </section>

      {/* Backend Health Check Card */}
      <section className="card">
        <div className="card-header">
          <div className="card-title">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <span>Backend Health Status & Connectivity</span>
          </div>

          <button
            className="btn btn-outline"
            onClick={checkHealth}
            disabled={status === 'loading'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            {status === 'loading' ? 'Checking...' : 'Refresh Health Check'}
          </button>
        </div>

        {status === 'loading' && (
          <div style={{ color: 'var(--text-secondary)', padding: '1rem 0' }}>
            Querying <code>/api/v1/health</code> via Vite development proxy...
          </div>
        )}

        {status === 'connected' && healthData && (
          <div>
            <p style={{ fontSize: '0.88rem', color: 'var(--accent-green)', marginBottom: '0.85rem' }}>
              ✓ Backend service connected and responding with HTTP 200 OK.
            </p>
            <div className="health-grid">
              <div className="health-item">
                <div className="health-label">API Status</div>
                <div className="health-value" style={{ color: 'var(--accent-green)' }}>
                  {healthData.services?.api || healthData.status}
                </div>
              </div>
              <div className="health-item">
                <div className="health-label">Database Status</div>
                <div 
                  className="health-value" 
                  style={{ color: healthData.services?.database === 'ok' ? 'var(--accent-green)' : 'var(--text-muted)' }}
                >
                  {healthData.services?.database === 'ok' ? 'PostgreSQL Online' : (healthData.services?.database || 'Ready')}
                </div>
              </div>
              <div className="health-item">
                <div className="health-label">Service Identifier</div>
                <div className="health-value">{healthData.service}</div>
              </div>
              <div className="health-item">
                <div className="health-label">API Version</div>
                <div className="health-value">{healthData.version}</div>
              </div>
              <div className="health-item">
                <div className="health-label">Environment</div>
                <div className="health-value">{healthData.environment}</div>
              </div>
              <div className="health-item">
                <div className="health-label">Process Uptime</div>
                <div className="health-value">{healthData.uptime} seconds</div>
              </div>
              <div className="health-item">
                <div className="health-label">Last Checked</div>
                <div className="health-value">{lastChecked || 'Just now'}</div>
              </div>
            </div>
          </div>
        )}

        {status === 'unavailable' && (
          <div style={{ padding: '0.5rem 0' }}>
            <p style={{ color: 'var(--accent-red)', fontWeight: 600, marginBottom: '0.5rem' }}>
              ✗ Backend Service Unavailable
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Could not reach <code>GET /api/v1/health</code>. Ensure the backend server is running on port 5000 (<code>npm run dev:server</code>).
            </p>
            {errorMsg && (
              <p style={{ fontSize: '0.8rem', color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                Error details: {errorMsg}
              </p>
            )}
            <button className="btn btn-primary" onClick={checkHealth}>
              Retry Connection
            </button>
          </div>
        )}
      </section>

      {/* Architecture & Milestone Roadmap */}
      <section className="card">
        <div className="card-header">
          <div className="card-title">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
            <span>Incremental Development Milestones</span>
          </div>
        </div>

        <div className="roadmap-grid">
          {milestones.map((item, idx) => (
            <div key={idx} className={`roadmap-card ${item.active ? 'active' : ''}`}>
              <div className="roadmap-card-header">
                <span style={{ fontSize: '0.75rem', color: item.active ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: 700 }}>
                  {item.step}
                </span>
                <span className={`badge ${item.active ? 'badge-connected' : 'badge-step'}`} style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}>
                  {item.status}
                </span>
              </div>
              <h3 className="roadmap-card-title">{item.name}</h3>
              <p className="roadmap-card-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="app-footer">
        <p>Silent SOS Emergency Web App • Step 1 Project Skeleton Initialized</p>
        <p style={{ marginTop: '0.35rem', color: 'var(--text-muted)' }}>
          Strict separation maintained • Zero unauthorized data tracking • Security headers active
        </p>
      </footer>
    </div>
  );
}
