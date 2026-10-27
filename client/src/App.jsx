import { useState, useEffect, useCallback, useRef } from 'react';
import RecipientTrackingMap from './components/RecipientTrackingMap.jsx';
import StealthMode from './components/StealthMode.jsx';
import {
  STEALTH_PIN_PATTERN,
  isStealthPinConfigured,
  saveStealthPin,
  clearStealthPin,
} from './utils/stealth.js';

export default function App() {
  // Authentication & Session State
  const [token, setToken] = useState(() => localStorage.getItem('silent_sos_token') || '');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authForm, setAuthForm] = useState({
    full_name: '',
    email: '',
    phone_number: '',
    password: '',
  });

  // Emergency Contacts State
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [contactForm, setContactForm] = useState({
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    priority_order: '',
    notify_email: true,
    notify_sms: true,
  });
  const [contactFormError, setContactFormError] = useState('');
  const [contactFormLoading, setContactFormLoading] = useState(false);
  const [deleteConfirmContact, setDeleteConfirmContact] = useState(null);
  
  // Step 4: Emergency SOS Alert & Geolocation State
  const [activeAlert, setActiveAlert] = useState(null);
  const [sosActivating, setSosActivating] = useState(false);
  const [locationStatus, setLocationStatus] = useState('idle'); // 'idle' | 'acquiring' | 'tracking' | 'unavailable'
  const [locationError, setLocationError] = useState('');
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolveReason, setResolveReason] = useState('Safe Arrival / Threat Passed');
  const [resolveLoading, setResolveLoading] = useState(false);
  const watchIdRef = useRef(null);

  // Phase C: Delivery receipts for the active alert
  const [deliveryReceipts, setDeliveryReceipts] = useState(null);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsError, setReceiptsError] = useState('');

  // Phase D: Stealth mode (decoy calculator/notes + panic triggers)
  const [stealthOpen, setStealthOpen] = useState(false);
  const [stealthPinConfigured, setStealthPinConfigured] = useState(() => isStealthPinConfigured());
  const [stealthPinEditing, setStealthPinEditing] = useState(false);
  const [stealthPinForm, setStealthPinForm] = useState({ pin: '', confirm: '' });
  const [stealthPinError, setStealthPinError] = useState('');
  const [stealthPinSaving, setStealthPinSaving] = useState(false);

  // Global Alert / Feedback State
  const [alertFeedback, setAlertFeedback] = useState(null);

  // System Diagnostics State
  const [healthData, setHealthData] = useState(null);
  const [healthStatus, setHealthStatus] = useState('loading'); // 'loading' | 'connected' | 'unavailable'
  const [lastChecked, setLastChecked] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Step 5C: Recipient Tracking Portal via ?track=<token> URL parameter
  const [trackingToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const track = params.get('track');
    return track && track.trim() ? track.trim() : null;
  });

  const showAlert = (message, type = 'success') => {
    setAlertFeedback({ message, type });
    setTimeout(() => setAlertFeedback(null), 4500);
  };

  // 1. Backend Health Check
  const checkHealth = useCallback(async () => {
    setHealthStatus('loading');
    try {
      const response = await fetch('/api/v1/health', {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      if (response.ok && data.status === 'ok') {
        setHealthData(data);
        setHealthStatus('connected');
      } else {
        setHealthData(data);
        setHealthStatus(data.status === 'degraded' ? 'connected' : 'unavailable');
      }
    } catch (err) {
      setHealthStatus('unavailable');
    } finally {
      setLastChecked(new Date().toLocaleTimeString());
    }
  }, []);

  // 2. Fetch Authenticated User Profile (/api/v1/auth/me)
  const fetchUserProfile = useCallback(async (activeToken) => {
    if (!activeToken) {
      setUser(null);
      return;
    }
    try {
      const res = await fetch('/api/v1/auth/me', {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Accept: 'application/json',
        },
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.data.user);
      } else {
        // Token invalid or expired
        localStorage.removeItem('silent_sos_token');
        setToken('');
        setUser(null);
      }
    } catch (err) {
      console.error('[User fetch error]:', err);
    }
  }, []);

  // 3. Fetch Emergency Contacts (/api/v1/contacts)
  const fetchContacts = useCallback(async (activeToken) => {
    if (!activeToken) return;
    setContactsLoading(true);
    try {
      const res = await fetch('/api/v1/contacts', {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Accept: 'application/json',
        },
      });

      if (res.ok) {
        const data = await res.json();
        setContacts(data.data.contacts || []);
      } else if (res.status === 401) {
        localStorage.removeItem('silent_sos_token');
        setToken('');
        setUser(null);
      }
    } catch (err) {
      console.error('[Contacts fetch error]:', err);
    } finally {
      setContactsLoading(false);
    }
  }, []);

  // 4. Fetch Active SOS Alert (/api/v1/alerts/active) on startup
  const fetchActiveAlert = useCallback(async (activeToken) => {
    if (!activeToken) {
      setActiveAlert(null);
      return;
    }
    try {
      const res = await fetch('/api/v1/alerts/active', {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Accept: 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.data?.alert) {
          setActiveAlert(data.data.alert);
          setLocationStatus(data.data.alert.location ? 'tracking' : 'unavailable');
        } else {
          setActiveAlert(null);
          setLocationStatus('idle');
        }
      }
    } catch (err) {
      console.error('[Active alert fetch error]:', err);
    }
  }, []);

  // 5. Fetch Delivery Receipts for the Active Alert (/api/v1/alerts/:id/notifications)
  const fetchDeliveryReceipts = useCallback(async (activeToken, alertId, quiet = false) => {
    if (!activeToken || !alertId) {
      setDeliveryReceipts(null);
      return;
    }
    if (!quiet) setReceiptsLoading(true);
    try {
      const res = await fetch(`/api/v1/alerts/${alertId}/notifications`, {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Accept: 'application/json',
        },
      });
      const data = await res.json();
      if (res.ok && data.data) {
        setDeliveryReceipts(data.data);
        setReceiptsError('');
      } else {
        setReceiptsError(data.message || 'Unable to load delivery receipts.');
      }
    } catch (err) {
      setReceiptsError('Network error while loading delivery receipts.');
    } finally {
      if (!quiet) setReceiptsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeAlert?.id || activeAlert.status !== 'active' || !token) {
      setDeliveryReceipts(null);
      setReceiptsError('');
      return;
    }

    fetchDeliveryReceipts(token, activeAlert.id);
    const interval = setInterval(() => {
      fetchDeliveryReceipts(token, activeAlert.id, true);
    }, 15000);

    return () => clearInterval(interval);
  }, [activeAlert?.id, activeAlert?.status, token, fetchDeliveryReceipts]);

  useEffect(() => {
    checkHealth();
    if (token) {
      fetchUserProfile(token);
      fetchContacts(token);
      fetchActiveAlert(token);
    }
  }, [checkHealth, fetchUserProfile, fetchContacts, fetchActiveAlert, token]);

  // Continuous Location Tracking for Active Alert via watchPosition
  useEffect(() => {
    if (!activeAlert?.id || activeAlert?.status !== 'active') {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!('geolocation' in navigator)) {
      setLocationStatus('unavailable');
      setLocationError('Geolocation API not supported by browser.');
      return;
    }

    const alertId = activeAlert.id;
    setLocationStatus('tracking');

    const handlePositionUpdate = async (pos) => {
      const coords = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_meters: pos.coords.accuracy !== null && !isNaN(pos.coords.accuracy) ? pos.coords.accuracy : null,
        altitude_meters: pos.coords.altitude !== null && !isNaN(pos.coords.altitude) ? pos.coords.altitude : null,
        heading_degrees: pos.coords.heading !== null && !isNaN(pos.coords.heading) ? pos.coords.heading : null,
        speed_mps: pos.coords.speed !== null && !isNaN(pos.coords.speed) ? pos.coords.speed : null,
      };

      try {
        const res = await fetch(`/api/v1/alerts/${alertId}/location`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          body: JSON.stringify(coords),
        });

        if (res.ok) {
          const resData = await res.json();
          if (resData.data?.location) {
            setActiveAlert((prev) =>
              prev && prev.id === alertId ? { ...prev, location: resData.data.location } : prev
            );
            setLocationStatus('tracking');
            setLocationError('');
          }
        }
      } catch (err) {
        console.error('[Location update sync error]:', err);
      }
    };

    const handlePositionError = (err) => {
      console.warn('[Geolocation watch warning]:', err.message);
      setLocationError(err.message);
      if (err.code === 1) {
        setLocationStatus('unavailable');
      }
    };

    const watchId = navigator.geolocation.watchPosition(handlePositionUpdate, handlePositionError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    });

    watchIdRef.current = watchId;

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [activeAlert?.id, activeAlert?.status, token]);

  // Auth Handlers
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      const endpoint = authMode === 'register' ? '/api/v1/auth/register' : '/api/v1/auth/login';
      const body = authMode === 'register'
        ? {
            full_name: authForm.full_name,
            email: authForm.email,
            phone_number: authForm.phone_number || undefined,
            password: authForm.password,
          }
        : {
            email: authForm.email,
            password: authForm.password,
          };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || (data.errors ? data.errors.join(', ') : 'Authentication failed'));
      }

      const newToken = data.data.token;
      const newUser = data.data.user;

      localStorage.setItem('silent_sos_token', newToken);
      setToken(newToken);
      setUser(newUser);
      setAuthForm({ full_name: '', email: '', phone_number: '', password: '' });
      showAlert(
        authMode === 'register' ? `Welcome, ${newUser.full_name}! Account created.` : `Welcome back, ${newUser.full_name}!`,
        'success'
      );
      fetchContacts(newToken);
    } catch (err) {
      setAuthError(err.message || 'An error occurred during authentication.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } catch (e) {
      // Ignore network failure on logout
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    localStorage.removeItem('silent_sos_token');
    setToken('');
    setUser(null);
    setContacts([]);
    setActiveAlert(null);
    setLocationStatus('idle');
    showAlert('You have been logged out successfully.', 'info');
  };

  // Step 4: SOS Trigger Handler
  const handleTriggerSos = async (triggerSource = 'manual_ui') => {
    if (sosActivating || activeAlert) return;
    setSosActivating(true);
    setLocationStatus('acquiring');
    setLocationError('');

    const sendTriggerPayload = async (locCoords, locErr) => {
      try {
        const res = await fetch('/api/v1/alerts/trigger', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          body: JSON.stringify({
            trigger_source: triggerSource,
            location: locCoords,
            location_error: locErr,
          }),
        });

        const data = await res.json();
        if (res.ok && data.data?.alert) {
          // Store alert record without saving, logging, or exposing raw tracking token
          const alertRecord = {
            id: data.data.alert.id,
            status: data.data.alert.status,
            triggered_at: data.data.alert.triggered_at,
            location: data.data.alert.location,
          };
          setActiveAlert(alertRecord);
          setLocationStatus(locCoords ? 'tracking' : 'unavailable');
          showAlert('🚨 Silent SOS Emergency Alert Triggered! Location tracking active.', 'error');
        } else {
          showAlert(data.message || 'Failed to trigger emergency alert.', 'error');
        }
      } catch (err) {
        showAlert('Network error while triggering emergency alert.', 'error');
      } finally {
        setSosActivating(false);
      }
    };

    if (!('geolocation' in navigator)) {
      await sendTriggerPayload(null, 'GEOLOCATION_UNSUPPORTED');
      return;
    }

    // Try acquiring GPS with 5s timeout; fall back gracefully if denied or unavailable
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_meters: pos.coords.accuracy !== null && !isNaN(pos.coords.accuracy) ? pos.coords.accuracy : null,
          altitude_meters: pos.coords.altitude !== null && !isNaN(pos.coords.altitude) ? pos.coords.altitude : null,
          heading_degrees: pos.coords.heading !== null && !isNaN(pos.coords.heading) ? pos.coords.heading : null,
          speed_mps: pos.coords.speed !== null && !isNaN(pos.coords.speed) ? pos.coords.speed : null,
        };
        await sendTriggerPayload(coords, null);
      },
      async (geoErr) => {
        const reasonCode =
          geoErr.code === 1 ? 'PERMISSION_DENIED' : geoErr.code === 2 ? 'POSITION_UNAVAILABLE' : 'TIMEOUT';
        setLocationError(geoErr.message || 'Location unavailable');
        // Critical requirement: trigger MUST proceed even when location fails
        await sendTriggerPayload(null, reasonCode);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  };

  // Phase D: Global panic hotkey (Ctrl+Shift+X) disguises the screen and triggers SOS
  useEffect(() => {
    const handlePanicShortcut = (event) => {
      if (!user) return;
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== 'x') return;
      event.preventDefault();
      setStealthOpen(true);
      if (!activeAlert && !sosActivating) {
        handleTriggerSos('panic_hotkey');
      }
    };

    window.addEventListener('keydown', handlePanicShortcut);
    return () => window.removeEventListener('keydown', handlePanicShortcut);
  }, [user, activeAlert, sosActivating, handleTriggerSos]);

  const handleStealthPinSave = async (e) => {
    e.preventDefault();
    const { pin, confirm } = stealthPinForm;
    if (!STEALTH_PIN_PATTERN.test(pin)) {
      setStealthPinError('PIN must be 4 to 8 digits.');
      return;
    }
    if (pin !== confirm) {
      setStealthPinError('PIN entries do not match.');
      return;
    }

    setStealthPinSaving(true);
    try {
      await saveStealthPin(pin);
      setStealthPinConfigured(true);
      setStealthPinEditing(false);
      setStealthPinForm({ pin: '', confirm: '' });
      setStealthPinError('');
      showAlert('Stealth PIN configured for this browser.', 'success');
    } catch (err) {
      setStealthPinError(err.message || 'Unable to save the stealth PIN.');
    } finally {
      setStealthPinSaving(false);
    }
  };

  const handleStealthPinClear = () => {
    clearStealthPin();
    setStealthPinConfigured(false);
    setStealthPinEditing(false);
    setStealthPinForm({ pin: '', confirm: '' });
    setStealthPinError('');
    showAlert('Stealth PIN removed from this browser.', 'info');
  };

  // Step 4: Resolve Alert Handler
  const handleResolveAlert = async (e) => {
    e.preventDefault();
    if (!activeAlert) return;
    setResolveLoading(true);

    try {
      const res = await fetch(`/api/v1/alerts/${activeAlert.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          reason: resolveReason || 'Safe Arrival / Threat Passed',
        }),
      });

      const data = await res.json();
      if (res.ok) {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        setActiveAlert(null);
        setResolveModalOpen(false);
        setLocationStatus('idle');
        showAlert('Emergency alert marked as resolved. You are safe.', 'success');
      } else {
        showAlert(data.message || 'Failed to resolve emergency alert.', 'error');
      }
    } catch (err) {
      showAlert('Network error while resolving emergency alert.', 'error');
    } finally {
      setResolveLoading(false);
    }
  };

  // Contact Modal Handlers
  const openAddContactModal = () => {
    setEditingContact(null);
    setContactForm({
      contact_name: '',
      contact_phone: '',
      contact_email: '',
      priority_order: String(contacts.length + 1),
      notify_email: true,
      notify_sms: true,
    });
    setContactFormError('');
    setContactModalOpen(true);
  };

  const openEditContactModal = (contact) => {
    setEditingContact(contact);
    setContactForm({
      contact_name: contact.contact_name,
      contact_phone: contact.contact_phone || '',
      contact_email: contact.contact_email || '',
      priority_order: String(contact.priority_order),
      notify_email: contact.notify_email !== false,
      notify_sms: contact.notify_sms !== false,
    });
    setContactFormError('');
    setContactModalOpen(true);
  };

  const handleSaveContact = async (e) => {
    e.preventDefault();
    setContactFormError('');
    setContactFormLoading(true);

    try {
      const isEdit = !!editingContact;
      const endpoint = isEdit ? `/api/v1/contacts/${editingContact.id}` : '/api/v1/contacts';
      const method = isEdit ? 'PUT' : 'POST';

      const payload = {
        contact_name: contactForm.contact_name,
        contact_phone: contactForm.contact_phone.trim() || null,
        contact_email: contactForm.contact_email.trim() || null,
        priority_order: contactForm.priority_order ? parseInt(contactForm.priority_order, 10) : undefined,
        notify_email: contactForm.notify_email,
        notify_sms: contactForm.notify_sms,
      };

      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || (data.errors ? data.errors.join(', ') : 'Failed to save contact'));
      }

      setContactModalOpen(false);
      showAlert(
        isEdit ? `Updated contact "${payload.contact_name}".` : `Added "${payload.contact_name}" to emergency contacts.`,
        'success'
      );
      fetchContacts(token);
    } catch (err) {
      setContactFormError(err.message || 'Error saving emergency contact.');
    } finally {
      setContactFormLoading(false);
    }
  };

  const handleDeleteContact = async () => {
    if (!deleteConfirmContact) return;

    try {
      const res = await fetch(`/api/v1/contacts/${deleteConfirmContact.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to delete contact');
      }

      showAlert(`Removed "${deleteConfirmContact.contact_name}" from emergency contacts.`, 'info');
      setDeleteConfirmContact(null);
      fetchContacts(token);
    } catch (err) {
      showAlert(err.message || 'Error removing contact', 'error');
    }
  };

  const milestones = [
    {
      step: 'Step 1',
      name: 'Project Initialization & Safety Guardrails',
      status: 'Completed',
      state: 'completed',
      desc: 'Monorepo scaffolding, React/Vite client, Express baseline, /api/v1/health.',
    },
    {
      step: 'Step 2',
      name: 'Database & Geospatial PostGIS Modeling',
      status: 'Completed',
      state: 'completed',
      desc: 'PostgreSQL 18.6 + PostGIS 3.6.2, migrations (001–007), GiST index, seeds.',
    },
    {
      step: 'Step 3',
      name: 'Secure Authentication & Contacts Management',
      status: 'Completed',
      state: 'completed',
      desc: 'Argon2id hashing, minimal JWT { sub }, rate limiting, multi-tenant contact CRUD.',
    },
    {
      step: 'Step 4',
      name: 'Silent SOS Trigger & Location Engine',
      status: 'Completed',
      state: 'completed',
      desc: 'One-touch SOS activation, PostGIS coordinates, continuous watchPosition telemetry, resolve lifecycle.',
    },
    {
      step: 'Step 5',
      name: 'Real-time Gateway & Notification Channels',
      status: 'Completed',
      state: 'completed',
      desc: 'Socket.IO live telemetry, pg-boss dispatch queue, email, SMS, and browser push delivery.',
    },
    {
      step: 'Step 6',
      name: 'Stealth Mode & Discreet Activation',
      status: 'Completed',
      state: 'completed',
      desc: 'Calculator/notes decoy, SHA-256 PIN trigger, panic hotkeys, and discreet exit.',
    },
  ];

  // Step 5C: Recipient tracking links (?track=<token>) render the public portal
  // and bypass the authenticated app shell entirely
  if (trackingToken) {
    return (
      <RecipientTrackingMap
        token={trackingToken}
        onBackToApp={() => {
          window.location.href = window.location.pathname;
        }}
      />
    );
  }

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

        <div className="header-actions">
          <span className="badge badge-step">Step 6 · Stealth</span>
          {healthStatus === 'connected' && (
            <span className="badge badge-connected">
              <span className="status-dot online"></span> API Online
            </span>
          )}
          {healthStatus === 'unavailable' && (
            <span className="badge badge-unavailable">
              <span className="status-dot offline"></span> API Offline
            </span>
          )}

          {user && (
            <div className="user-badge-profile">
              <div className="user-avatar">
                {user.full_name ? user.full_name.charAt(0).toUpperCase() : 'U'}
              </div>
              <span className="user-badge-name">{user.full_name}</span>
              <button
                className="btn btn-outline btn-sm"
                onClick={handleLogout}
                title="Logout of session"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Safety Notice Banner */}
      <section className="safety-banner">
        <div className="safety-banner-icon">⚠️</div>
        <div>
          <h2 className="safety-banner-title">Safety Constraints & Protocol Notice</h2>
          <p className="safety-banner-text">
            This application is engineered for safety situations. It is strictly supplementary and does not replace official emergency dispatch services (911/112). 
            Background GPS and notifications are subject to device permissions and telecom carrier delivery constraints.
          </p>
        </div>
      </section>

      {/* Global Alert Notification */}
      {alertFeedback && (
        <div className={`alert alert-${alertFeedback.type}`}>
          {alertFeedback.type === 'success' && <span>✓</span>}
          {alertFeedback.type === 'error' && <span>✗</span>}
          {alertFeedback.type === 'info' && <span>ℹ</span>}
          <span>{alertFeedback.message}</span>
        </div>
      )}

      {/* Unauthenticated View: Login / Register Form */}
      {!user ? (
        <section className="card auth-wrapper">
          <div className="auth-tabs">
            <button
              className={`auth-tab-btn ${authMode === 'login' ? 'active' : ''}`}
              onClick={() => {
                setAuthMode('login');
                setAuthError('');
              }}
            >
              Sign In
            </button>
            <button
              className={`auth-tab-btn ${authMode === 'register' ? 'active' : ''}`}
              onClick={() => {
                setAuthMode('register');
                setAuthError('');
              }}
            >
              Create Account
            </button>
          </div>

          {authError && (
            <div className="alert alert-error">
              <span>✗</span>
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit}>
            {authMode === 'register' && (
              <div className="form-group">
                <label className="form-label" htmlFor="register-name">Full Name *</label>
                <input
                  id="register-name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Jane Doe"
                  value={authForm.full_name}
                  onChange={(e) => setAuthForm({ ...authForm, full_name: e.target.value })}
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="auth-email">Email Address *</label>
              <input
                id="auth-email"
                type="email"
                className="form-input"
                placeholder="name@example.com"
                value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                required
              />
            </div>

            {authMode === 'register' && (
              <div className="form-group">
                <label className="form-label" htmlFor="register-phone">Your Phone Number (Optional)</label>
                <input
                  id="register-phone"
                  type="tel"
                  className="form-input"
                  placeholder="+1 (555) 000-0000"
                  value={authForm.phone_number}
                  onChange={(e) => setAuthForm({ ...authForm, phone_number: e.target.value })}
                />
                <span className="form-hint">Used for recipient SMS sender identification</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="auth-password">Password *</label>
              <input
                id="auth-password"
                type="password"
                className="form-input"
                placeholder="••••••••••••"
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                required
                minLength={8}
              />
              <span className="form-hint">
                {authMode === 'register' ? 'Minimum 8 characters (Argon2id encrypted)' : 'Enter your account password'}
              </span>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-full"
              disabled={authLoading}
              style={{ marginTop: '0.75rem' }}
            >
              {authLoading
                ? 'Authenticating...'
                : authMode === 'register'
                ? 'Create Secure Account'
                : 'Sign In to Portal'}
            </button>
          </form>

          {/* Dev helper note */}
          <div style={{ marginTop: '1.5rem', padding: '0.85rem', background: 'rgba(0,0,0,0.25)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-subtle)', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--accent-amber)' }}>Development Seed Account:</strong>
            <br />
            Email: <code>demo.user@example.local</code>
            <br />
            Password: <code>DemoPassword123!</code>
          </div>
        </section>
      ) : (
        <>
          {/* Step 4: Silent SOS Emergency Trigger & Active Emergency Status */}
          {activeAlert ? (
            <section className="sos-active-panel">
              <div className="sos-active-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span className="sos-badge-active">
                    <span className="sos-pulse-dot"></span>
                    Emergency SOS Active
                  </span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    Triggered at {new Date(activeAlert.triggered_at).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`sos-pulse-dot ${locationStatus === 'tracking' ? 'green' : ''}`}></span>
                  <span style={{ fontSize: '0.8rem', color: locationStatus === 'tracking' ? 'var(--accent-green)' : 'var(--accent-amber)', fontWeight: 600 }}>
                    {locationStatus === 'tracking' ? 'Live GPS Streaming' : locationStatus === 'unavailable' ? 'Location Unavailable' : 'Acquiring Fix...'}
                  </span>
                </div>
              </div>

              <div className="sos-location-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Continuous Coordinate Telemetry
                  </span>
                  {activeAlert.location?.logged_at && (
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Fix updated: {new Date(activeAlert.location.logged_at).toLocaleTimeString()}
                    </span>
                  )}
                </div>

                {activeAlert.location ? (
                  <div className="sos-location-grid">
                    <div className="sos-location-item">
                      <span className="sos-location-label">Latitude</span>
                      <span className="sos-location-val">{activeAlert.location.latitude.toFixed(6)}°</span>
                    </div>
                    <div className="sos-location-item">
                      <span className="sos-location-label">Longitude</span>
                      <span className="sos-location-val">{activeAlert.location.longitude.toFixed(6)}°</span>
                    </div>
                    <div className="sos-location-item">
                      <span className="sos-location-label">Accuracy</span>
                      <span className="sos-location-val">
                        {activeAlert.location.accuracy_meters !== null ? `±${activeAlert.location.accuracy_meters.toFixed(1)} m` : 'N/A'}
                      </span>
                    </div>
                    <div className="sos-location-item">
                      <span className="sos-location-label">Altitude</span>
                      <span className="sos-location-val">
                        {activeAlert.location.altitude_meters !== null ? `${activeAlert.location.altitude_meters.toFixed(1)} m` : 'N/A'}
                      </span>
                    </div>
                    <div className="sos-location-item">
                      <span className="sos-location-label">Speed</span>
                      <span className="sos-location-val">
                        {activeAlert.location.speed_mps !== null ? `${activeAlert.location.speed_mps.toFixed(1)} m/s` : '0.0 m/s'}
                      </span>
                    </div>
                    <div className="sos-location-item">
                      <span className="sos-location-label">Heading</span>
                      <span className="sos-location-val">
                        {activeAlert.location.heading_degrees !== null ? `${activeAlert.location.heading_degrees.toFixed(0)}°` : 'N/A'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-sm)', border: '1px dashed rgba(239, 68, 68, 0.3)', fontSize: '0.82rem', color: '#fca5a5' }}>
                    ⚠️ GPS coordinates unavailable ({locationError || 'Device permission denied or timed out'}). Your silent SOS alert was still broadcast to trusted contacts without coordinates.
                  </div>
                )}
              </div>

              <div className="sos-active-actions">
                <button
                  className="btn btn-outline"
                  onClick={() => setResolveModalOpen(true)}
                  style={{ borderColor: 'var(--accent-green)', color: 'var(--accent-green)' }}
                >
                  ✓ Mark Safe & Resolve Emergency
                </button>
              </div>
            </section>
          ) : (
            <section className="sos-trigger-panel">
              <div className="sos-trigger-header">
                <div>
                  <h2 className="sos-trigger-title">
                    <span>🚨</span>
                    <span>Silent SOS Distress Activation</span>
                  </h2>
                  <p className="sos-trigger-desc">
                    One-touch discreet activation. Silently acquires GPS coordinates and dispatches alert records to your priority contacts without audible alerts.
                  </p>
                </div>
              </div>

              <div className="sos-btn-wrapper">
                <button
                  className="btn-sos-trigger"
                  onClick={() => handleTriggerSos()}
                  disabled={sosActivating}
                >
                  {sosActivating ? (
                    <>
                      <span className="sos-pulse-dot" style={{ backgroundColor: '#fff' }}></span>
                      <span>Acquiring GPS & Triggering...</span>
                    </>
                  ) : (
                    <>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                      <span>Trigger Silent SOS</span>
                    </>
                  )}
                </button>
              </div>
            </section>
          )}

          {/* Phase C: Notification Delivery Receipts */}
          {activeAlert && activeAlert.status === 'active' && (
            <section className="card delivery-receipts-card">
              <div className="card-header">
                <div>
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
                    <span>Notification Delivery Receipts</span>
                  </div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    Per-channel delivery status for the contacts alerted by this emergency.
                  </p>
                </div>

                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => fetchDeliveryReceipts(token, activeAlert.id)}
                  disabled={receiptsLoading}
                >
                  {receiptsLoading ? 'Refreshing...' : 'Refresh Receipts'}
                </button>
              </div>

              {receiptsError && (
                <div className="alert alert-error">
                  <span>✗</span>
                  <span>{receiptsError}</span>
                </div>
              )}

              {!deliveryReceipts && receiptsLoading && (
                <div className="receipts-empty">Loading delivery attempts...</div>
              )}

              {deliveryReceipts && (
                <>
                  <div className="receipt-summary">
                    <span className="receipt-summary-item delivered">
                      <strong>{deliveryReceipts.counts.sent}</strong> delivered
                    </span>
                    <span className="receipt-summary-item failed">
                      <strong>{deliveryReceipts.counts.failed}</strong> failed
                    </span>
                    <span className="receipt-summary-item skipped">
                      <strong>{deliveryReceipts.counts.skipped}</strong> skipped
                    </span>
                    <span className="receipt-summary-item">
                      Email {deliveryReceipts.counts.by_channel.email.sent}/
                      {deliveryReceipts.counts.by_channel.email.sent +
                        deliveryReceipts.counts.by_channel.email.failed}
                    </span>
                    <span className="receipt-summary-item">
                      SMS {deliveryReceipts.counts.by_channel.sms.sent}/
                      {deliveryReceipts.counts.by_channel.sms.sent +
                        deliveryReceipts.counts.by_channel.sms.failed}
                    </span>
                  </div>

                  {deliveryReceipts.attempts.length === 0 ? (
                    <div className="receipts-empty">
                      No delivery attempts recorded yet. The dispatch worker retries automatically.
                    </div>
                  ) : (
                    <div className="receipts-table-wrapper">
                      <table className="receipts-table">
                        <thead>
                          <tr>
                            <th>Contact</th>
                            <th>Channel</th>
                            <th>Destination</th>
                            <th>Status</th>
                            <th>Attempted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deliveryReceipts.attempts.map((attempt) => (
                            <tr key={attempt.id}>
                              <td>{attempt.contact?.contact_name || 'Unknown contact'}</td>
                              <td>
                                <span className={`receipt-channel ${attempt.channel}`}>
                                  {attempt.channel}
                                </span>
                              </td>
                              <td className="receipt-destination">{attempt.destination}</td>
                              <td>
                                <span className={`receipt-status ${attempt.status}`}>
                                  {attempt.status}
                                </span>
                                {attempt.error_message && attempt.status !== 'sent' && (
                                  <span className="receipt-error">{attempt.error_message}</span>
                                )}
                              </td>
                              <td>{new Date(attempt.attempted_at).toLocaleTimeString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* Authenticated View: Emergency Contacts Management Dashboard */}
          <section className="card">
          <div className="card-header">
            <div>
              <div className="card-title">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>Trusted Emergency Contacts</span>
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Designated recipients alerted in priority order when an SOS trigger is activated.
              </p>
            </div>

            <button className="btn btn-primary" onClick={openAddContactModal}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Add Emergency Contact</span>
            </button>
          </div>

          {contactsLoading ? (
            <div style={{ color: 'var(--text-secondary)', padding: '2rem 0', textAlign: 'center' }}>
              Loading your trusted contacts securely...
            </div>
          ) : contacts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🛡️</div>
              <h3 className="empty-state-title">No Emergency Contacts Configured</h3>
              <p className="empty-state-desc">
                Add at least one trusted contact (such as a family member, friend, or coworker) who will receive your silent SOS alerts.
              </p>
              <button className="btn btn-primary" onClick={openAddContactModal}>
                + Add Your First Contact
              </button>
            </div>
          ) : (
            <div className="contacts-grid">
              {contacts.map((contact) => (
                <div key={contact.id} className="contact-card">
                  <div className="contact-card-top">
                    <div className="contact-name">{contact.contact_name}</div>
                    <span
                      className={`priority-pill ${
                        contact.priority_order === 1
                          ? 'priority-1'
                          : contact.priority_order === 2
                          ? 'priority-2'
                          : 'priority-other'
                      }`}
                    >
                      Priority {contact.priority_order} {contact.priority_order === 1 ? '• Primary' : ''}
                    </span>
                  </div>

                  <div className="contact-details">
                    {contact.contact_phone && (
                      <div className="contact-detail-row">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="2">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                        </svg>
                        <span>{contact.contact_phone}</span>
                      </div>
                    )}
                    {contact.contact_email && (
                      <div className="contact-detail-row">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                          <polyline points="22,6 12,13 2,6" />
                        </svg>
                        <span>{contact.contact_email}</span>
                      </div>
                    )}
                  </div>

                  <div className="contact-channel-prefs">
                    <span className={`channel-tag ${contact.notify_email && contact.contact_email ? 'on' : 'off'}`}>
                      Email {contact.notify_email && contact.contact_email ? 'on' : 'off'}
                    </span>
                    <span className={`channel-tag ${contact.notify_sms && contact.contact_phone ? 'on' : 'off'}`}>
                      SMS {contact.notify_sms && contact.contact_phone ? 'on' : 'off'}
                    </span>
                  </div>

                  <div className="contact-actions">
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => openEditContactModal(contact)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger-outline btn-sm"
                      onClick={() => setDeleteConfirmContact(contact)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Phase D: Stealth Mode & Panic Hotkeys */}
        <section className="card stealth-settings-card">
          <div className="card-header">
            <div>
              <div className="card-title">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="10" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Stealth Mode & Panic Hotkeys</span>
              </div>
              <p className="stealth-settings-desc">
                Open a harmless calculator and notes decoy. Type your PIN then press{' '}
                <kbd>=</kbd> to silently trigger SOS, or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+
                <kbd>X</kbd> from anywhere in the app. Hold the decoy header for 2 seconds (or{' '}
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>) to exit.
              </p>
            </div>
            <div className="stealth-settings-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setStealthOpen(true)}
              >
                Open Decoy
              </button>
              {stealthPinConfigured && !stealthPinEditing && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setStealthPinEditing(true);
                    setStealthPinError('');
                  }}
                >
                  Change PIN
                </button>
              )}
            </div>
          </div>

          {stealthPinError && (
            <div className="alert alert-error">
              <span>✗</span>
              <span>{stealthPinError}</span>
            </div>
          )}

          {!stealthPinConfigured || stealthPinEditing ? (
            <form className="stealth-pin-form" onSubmit={handleStealthPinSave}>
              <div className="stealth-pin-fields">
                <div className="form-group">
                  <label className="form-label" htmlFor="stealth-pin-new">New PIN (4–8 digits)</label>
                  <input
                    id="stealth-pin-new"
                    className="form-input"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={8}
                    value={stealthPinForm.pin}
                    onChange={(e) =>
                      setStealthPinForm({
                        ...stealthPinForm,
                        pin: e.target.value.replace(/\D/g, '').slice(0, 8),
                      })
                    }
                    placeholder="••••"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="stealth-pin-confirm">Confirm PIN</label>
                  <input
                    id="stealth-pin-confirm"
                    className="form-input"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={8}
                    value={stealthPinForm.confirm}
                    onChange={(e) =>
                      setStealthPinForm({
                        ...stealthPinForm,
                        confirm: e.target.value.replace(/\D/g, '').slice(0, 8),
                      })
                    }
                    placeholder="••••"
                  />
                </div>
              </div>
              <div className="stealth-pin-actions">
                <button className="btn btn-primary btn-sm" type="submit" disabled={stealthPinSaving}>
                  {stealthPinSaving ? 'Hashing…' : 'Save PIN'}
                </button>
                {stealthPinConfigured && (
                  <>
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => {
                        setStealthPinEditing(false);
                        setStealthPinForm({ pin: '', confirm: '' });
                        setStealthPinError('');
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-danger-outline btn-sm"
                      type="button"
                      onClick={handleStealthPinClear}
                    >
                      Remove PIN
                    </button>
                  </>
                )}
              </div>
              <p className="stealth-pin-note">
                The PIN never leaves this device. Only its SHA-256 hash is stored in browser
                storage.
              </p>
            </form>
          ) : (
            <div className="stealth-pin-status">
              <span className="channel-tag on">PIN configured on this device</span>
              <span className="stealth-pin-note">
                The decoy opens without a PIN, but only the configured PIN can trigger SOS.
              </span>
            </div>
          )}
        </section>
        </>
      )}

      {/* Add / Edit Contact Modal */}
      {contactModalOpen && (
        <div className="modal-backdrop" onClick={() => setContactModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {editingContact ? 'Edit Emergency Contact' : 'Add New Emergency Contact'}
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setContactModalOpen(false)}
              >
                ✕
              </button>
            </div>

            {contactFormError && (
              <div className="alert alert-error">
                <span>✗</span>
                <span>{contactFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveContact}>
              <div className="form-group">
                <label className="form-label" htmlFor="contact-name">Contact Full Name *</label>
                <input
                  id="contact-name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Alex Rivera"
                  value={contactForm.contact_name}
                  onChange={(e) => setContactForm({ ...contactForm, contact_name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="contact-phone">Phone Number (SMS Alert Target)</label>
                <input
                  id="contact-phone"
                  type="tel"
                  className="form-input"
                  placeholder="+1 (555) 019-9001"
                  value={contactForm.contact_phone}
                  onChange={(e) => setContactForm({ ...contactForm, contact_phone: e.target.value })}
                />
                <span className="form-hint">At least one contact method (phone or email) is required</span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="contact-email">Email Address (Email Alert Target)</label>
                <input
                  id="contact-email"
                  type="email"
                  className="form-input"
                  placeholder="alex.rivera@example.com"
                  value={contactForm.contact_email}
                  onChange={(e) => setContactForm({ ...contactForm, contact_email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <span className="form-label">Notification Channels</span>
                <div className="channel-prefs">
                  <label className={`channel-pref ${contactForm.notify_email ? 'enabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={contactForm.notify_email}
                      onChange={(e) => setContactForm({ ...contactForm, notify_email: e.target.checked })}
                    />
                    <span>Email alerts</span>
                  </label>
                  <label className={`channel-pref ${contactForm.notify_sms ? 'enabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={contactForm.notify_sms}
                      onChange={(e) => setContactForm({ ...contactForm, notify_sms: e.target.checked })}
                    />
                    <span>SMS alerts</span>
                  </label>
                </div>
                <span className="form-hint">
                  Channels without a saved destination are skipped automatically.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="contact-priority">Notification Priority Order</label>
                <input
                  id="contact-priority"
                  type="number"
                  min="1"
                  className="form-input"
                  placeholder="1"
                  value={contactForm.priority_order}
                  onChange={(e) => setContactForm({ ...contactForm, priority_order: e.target.value })}
                />
                <span className="form-hint">Priority 1 receives alerts first. Lower numbers indicate higher urgency.</span>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setContactModalOpen(false)}
                  disabled={contactFormLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={contactFormLoading}
                >
                  {contactFormLoading ? 'Saving...' : editingContact ? 'Save Changes' : 'Add Contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmContact && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirmContact(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--accent-red)' }}>
                Remove Emergency Contact
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setDeleteConfirmContact(null)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Are you sure you want to remove <strong>{deleteConfirmContact.contact_name}</strong> from your emergency contacts list? They will no longer receive distress alerts.
            </p>

            <div className="modal-actions">
              <button
                className="btn btn-outline"
                onClick={() => setDeleteConfirmContact(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleDeleteContact}
              >
                Confirm Removal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Resolve Emergency Alert Modal */}
      {resolveModalOpen && activeAlert && (
        <div className="modal-backdrop" onClick={() => setResolveModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--accent-green)' }}>
                Resolve Emergency Alert
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setResolveModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Confirm that you are safe. This will terminate continuous location tracking and record an immutable resolution audit event.
            </p>

            <form onSubmit={handleResolveAlert}>
              <div className="form-group">
                <label className="form-label" htmlFor="resolve-reason">Resolution Reason / Status *</label>
                <select
                  id="resolve-reason"
                  className="form-input"
                  value={resolveReason}
                  onChange={(e) => setResolveReason(e.target.value)}
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                >
                  <option value="Safe Arrival / Threat Passed">Safe Arrival / Threat Passed</option>
                  <option value="Assistance Received">Assistance Received from Responders</option>
                  <option value="False Alarm / Accidental Trigger">False Alarm / Accidental Trigger</option>
                  <option value="Other / Situation De-escalated">Other / Situation De-escalated</option>
                </select>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setResolveModalOpen(false)}
                  disabled={resolveLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ backgroundColor: 'var(--accent-green)', borderColor: 'var(--accent-green)' }}
                  disabled={resolveLoading}
                >
                  {resolveLoading ? 'Resolving Alert...' : '✓ Confirm & Mark Safe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Diagnostics Toggle & Card */}
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
            <span>Backend Diagnostics & Health</span>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
            >
              {showDiagnostics ? 'Hide Diagnostics' : 'View Diagnostics'}
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={checkHealth}
              disabled={healthStatus === 'loading'}
            >
              {healthStatus === 'loading' ? 'Checking...' : 'Refresh'}
            </button>
          </div>
        </div>

        {showDiagnostics && healthData && (
          <div className="health-grid">
            <div className="health-item">
              <div className="health-label">API Service</div>
              <div className="health-value" style={{ color: 'var(--accent-green)' }}>
                {healthData.services?.api || healthData.status}
              </div>
            </div>
            <div className="health-item">
              <div className="health-label">PostgreSQL Database</div>
              <div
                className="health-value"
                style={{
                  color: healthData.services?.database === 'ok' ? 'var(--accent-green)' : 'var(--accent-amber)',
                }}
              >
                {healthData.services?.database === 'ok' ? 'Online' : healthData.services?.database || 'Ready'}
              </div>
            </div>
            <div className="health-item">
              <div className="health-label">Database Latency</div>
              <div className="health-value">
                {healthData.databaseLatencyMs !== undefined ? `${healthData.databaseLatencyMs} ms` : 'N/A'}
              </div>
            </div>
            <div className="health-item">
              <div className="health-label">Environment</div>
              <div className="health-value">{healthData.environment}</div>
            </div>
            <div className="health-item">
              <div className="health-label">Uptime</div>
              <div className="health-value">{healthData.uptime}s</div>
            </div>
            <div className="health-item">
              <div className="health-label">Last Probed</div>
              <div className="health-value">{lastChecked || 'Just now'}</div>
            </div>
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
            <span>Incremental Development Roadmap</span>
          </div>
        </div>

        <div className="roadmap-grid">
          {milestones.map((item, idx) => (
            <div
              key={idx}
              className={`roadmap-card ${
                item.state === 'active' ? 'active' : item.state === 'completed' ? 'completed' : ''
              }`}
            >
              <div className="roadmap-card-header">
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: item.state === 'active' ? 'var(--accent-green)' : item.state === 'completed' ? 'var(--accent-blue)' : 'var(--text-muted)',
                    fontWeight: 700,
                  }}
                >
                  {item.step}
                </span>
                <span
                  className={`badge ${
                    item.state === 'active'
                      ? 'badge-connected'
                      : item.state === 'completed'
                      ? 'badge-step'
                      : 'badge-unavailable'
                  }`}
                  style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}
                >
                  {item.status}
                </span>
              </div>
              <h3 className="roadmap-card-title">{item.name}</h3>
              <p className="roadmap-card-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Phase D: Full-screen decoy overlay */}
      {stealthOpen && (
        <StealthMode
          onPanic={() => handleTriggerSos('stealth_pin')}
          onExit={() => setStealthOpen(false)}
        />
      )}

      {/* Footer */}
      <footer className="app-footer">
        <p>Silent SOS Emergency Web App • Step 6: Stealth Mode & Discreet Activation</p>
        <p style={{ marginTop: '0.35rem', color: 'var(--text-muted)' }}>
          Discreet SOS activation • PostGIS coordinate telemetry • Transactional audit logging • Strict multi-tenant isolation
        </p>
      </footer>
    </div>
  );
}
