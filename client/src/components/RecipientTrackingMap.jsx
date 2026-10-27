/**
 * ==============================================================================
 * Silent SOS - Recipient Tracking Map Component
 * Description: Interactive real-time emergency tracking view for trusted contacts
 * and responders. Utilizes Leaflet + OpenStreetMap for live GPS breadcrumbs
 * and Socket.IO for authenticated bidirectional location telemetry streaming.
 * ==============================================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io } from 'socket.io-client';

// Fix Leaflet default icon path issues in bundled environments
const defaultMarkerSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="#e11d48">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
</svg>
`;

const liveMarkerIcon = L.divIcon({
  className: 'live-marker-container',
  html: `
    <div class="live-pulse-ring"></div>
    <div class="live-pin-icon">
      ${defaultMarkerSvg}
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36],
});

const breadcrumbIcon = L.divIcon({
  className: 'breadcrumb-marker',
  html: `<div class="breadcrumb-dot"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export default function RecipientTrackingMap({ token, onBackToApp }) {
  // Alert Data State
  const [alert, setAlert] = useState(null);
  const [locations, setLocations] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(null);

  // Connection & Lifecycle State
  const [fetchLoading, setFetchLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  const [lastUpdateReceived, setLastUpdateReceived] = useState(null);

  // Web Push State
  const [pushStatus, setPushStatus] = useState('checking'); // checking | available | subscribed | denied | error | unsupported | unavailable
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const pushPublicKeyRef = useRef(null);

  // Map & Socket Refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const accuracyCircleRef = useRef(null);
  const polylineRef = useRef(null);
  const breadcrumbMarkersRef = useRef([]);
  const socketRef = useRef(null);

  // Helper: Format ISO timestamp to readable time string
  const formatTime = (isoString) => {
    if (!isoString) return 'N/A';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return 'N/A';
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return '';
    try {
      return new Date(isoString).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  // 1. Fetch initial alert telemetry via REST API
  const fetchAlertData = useCallback(async () => {
    if (!token) {
      setFetchError({
        type: 'invalid_token',
        message: 'No emergency tracking token provided. Please check the emergency link.',
      });
      setFetchLoading(false);
      return;
    }

    try {
      setFetchLoading(true);
      setFetchError(null);

      const res = await fetch(`/api/v1/alerts/track/${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json' },
      });

      const data = await res.json();

      if (res.ok && data.status === 'ok' && data.data?.alert) {
        const alertData = data.data.alert;
        setAlert(alertData);

        const locs = Array.isArray(alertData.locations) ? alertData.locations : [];
        setLocations(locs);

        const latest = alertData.current_location || (locs.length > 0 ? locs[locs.length - 1] : null);
        setCurrentLocation(latest);
        if (latest) {
          setLastUpdateReceived(new Date());
        }
      } else if (res.status === 404) {
        setFetchError({
          type: 'expired',
          message: data.message || 'This emergency tracking session not found or link has expired.',
        });
      } else if (res.status === 400) {
        setFetchError({
          type: 'invalid_token',
          message: data.message || 'The tracking link format is invalid.',
        });
      } else if (res.status === 429) {
        setFetchError({
          type: 'rate_limited',
          message: data.message || 'Rate limit exceeded. Please wait a few moments before retrying.',
        });
      } else {
        setFetchError({
          type: 'server_error',
          message: data.message || 'Unable to retrieve tracking telemetry. Server returned an error.',
        });
      }
    } catch (err) {
      setFetchError({
        type: 'network_error',
        message: 'Network error connecting to emergency tracking gateway. Check your internet connection.',
      });
    } finally {
      setFetchLoading(false);
    }
  }, [token]);

  // Initial fetch on mount
  useEffect(() => {
    fetchAlertData();
  }, [fetchAlertData]);

  // 1b. Inspect Web Push availability and restore any existing subscription
  useEffect(() => {
    if (!token) return undefined;

    let cancelled = false;

    async function inspectPushSupport() {
      const supported =
        window.isSecureContext &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window;

      if (!supported) {
        setPushStatus('unsupported');
        return;
      }

      try {
        const res = await fetch('/api/v1/alerts/push/config', {
          headers: { Accept: 'application/json' },
        });
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok || !data?.data?.enabled || !data.data.public_key) {
          setPushStatus('unavailable');
          return;
        }

        pushPublicKeyRef.current = data.data.public_key;
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (cancelled) return;

        if (existing) {
          setPushStatus('subscribed');
          setPushMessage('This device is registered for emergency updates.');
        } else if (Notification.permission === 'denied') {
          setPushStatus('denied');
        } else {
          setPushStatus('available');
        }
      } catch {
        if (!cancelled) setPushStatus('error');
      }
    }

    inspectPushSupport();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // 2. Initialize Leaflet Map Instance
  // The first render is the loading state (no map div in DOM), so initialization
  // must wait until fetching completes and the container is actually mounted.
  useEffect(() => {
    if (fetchLoading) return;
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return; // Prevent duplicate initialization

    // Default center (World view if no coordinates yet)
    const initialLat = currentLocation?.latitude || 20.0;
    const initialLng = currentLocation?.longitude || 0.0;
    const initialZoom = currentLocation ? 16 : 2;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: initialZoom,
      zoomControl: true,
      attributionControl: true,
    });

    // OpenStreetMap tile layer with mandatory attribution
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
      accuracyCircleRef.current = null;
      polylineRef.current = null;
      breadcrumbMarkersRef.current = [];
    };
  }, [fetchLoading]); // Run once the map container is rendered

  // 3. Render and Update Marker, Breadcrumbs & Accuracy Circle on Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // A. If no valid coordinates exist yet, clean up markers safely
    if (!currentLocation || typeof currentLocation.latitude !== 'number' || typeof currentLocation.longitude !== 'number') {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
      if (accuracyCircleRef.current) {
        map.removeLayer(accuracyCircleRef.current);
        accuracyCircleRef.current = null;
      }
      if (polylineRef.current) {
        map.removeLayer(polylineRef.current);
        polylineRef.current = null;
      }
      breadcrumbMarkersRef.current.forEach((m) => map.removeLayer(m));
      breadcrumbMarkersRef.current = [];
      return;
    }

    const { latitude, longitude, accuracy_meters } = currentLocation;

    // Validate coordinate numbers
    if (isNaN(latitude) || isNaN(longitude)) return;

    // B. Update or create live current location marker
    if (markerRef.current) {
      markerRef.current.setLatLng([latitude, longitude]);
    } else {
      const marker = L.marker([latitude, longitude], { icon: liveMarkerIcon }).addTo(map);
      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 0.85rem; line-height: 1.4;">
          <strong>Live Location Fix</strong><br/>
          Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}<br/>
          Accuracy: ±${accuracy_meters ? Math.round(accuracy_meters) + 'm' : 'Unknown'}<br/>
          Time: ${formatTime(currentLocation.logged_at)}
        </div>
      `);
      markerRef.current = marker;
    }

    // C. Update or create accuracy circle (if accuracy is provided and positive)
    if (accuracy_meters && typeof accuracy_meters === 'number' && accuracy_meters > 0) {
      if (accuracyCircleRef.current) {
        accuracyCircleRef.current.setLatLng([latitude, longitude]);
        accuracyCircleRef.current.setRadius(accuracy_meters);
      } else {
        const circle = L.circle([latitude, longitude], {
          radius: accuracy_meters,
          color: '#e11d48',
          fillColor: '#e11d48',
          fillOpacity: 0.15,
          weight: 1.5,
        }).addTo(map);
        accuracyCircleRef.current = circle;
      }
    } else if (accuracyCircleRef.current) {
      map.removeLayer(accuracyCircleRef.current);
      accuracyCircleRef.current = null;
    }

    // D. Update historical breadcrumb polyline
    const validCoords = locations
      .filter((loc) => loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number' && !isNaN(loc.latitude) && !isNaN(loc.longitude))
      .map((loc) => [loc.latitude, loc.longitude]);

    if (validCoords.length > 1) {
      if (polylineRef.current) {
        polylineRef.current.setLatLngs(validCoords);
      } else {
        const polyline = L.polyline(validCoords, {
          color: '#e11d48',
          weight: 4,
          opacity: 0.8,
          dashArray: '6, 8',
          lineCap: 'round',
        }).addTo(map);
        polylineRef.current = polyline;
      }
    } else if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    // Center map smoothly on the latest coordinate
    map.panTo([latitude, longitude], { animate: true, duration: 0.75 });
  }, [currentLocation, locations]);

  // 4. Real-Time Socket.IO Telemetry Subscription
  useEffect(() => {
    if (!token || fetchError) return;

    // Initialize single socket connection with handshake auth
    const socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      auth: { token },
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('connected');
      // Subscribe explicitly using the tracking token
      socket.emit('subscribe:alert', { token }, (ack) => {
        if (ack?.status === 'ok') {
          setConnectionStatus('connected');
        } else if (ack?.status === 'error') {
          setConnectionStatus('disconnected');
        }
      });
    });

    socket.on('subscription:confirmed', () => {
      setConnectionStatus('connected');
    });

    socket.on('subscription:error', (err) => {
      setConnectionStatus('disconnected');
    });

    // Handle real-time incoming location updates
    socket.on('location:update', (data) => {
      if (!data || typeof data.latitude !== 'number' || typeof data.longitude !== 'number') return;
      if (isNaN(data.latitude) || isNaN(data.longitude)) return;

      setLastUpdateReceived(new Date());

      // Update current location fix
      setCurrentLocation(data);

      // Append to breadcrumb trail preventing duplicates
      setLocations((prev) => {
        const isDuplicate = prev.some(
          (loc) =>
            (data.id && loc.id === data.id) ||
            (loc.logged_at === data.logged_at && loc.latitude === data.latitude && loc.longitude === data.longitude)
        );
        if (isDuplicate) return prev;
        return [...prev, data];
      });
    });

    // Handle alert resolution broadcast
    socket.on('alert:resolved', (data) => {
      setAlert((prev) => (prev ? { ...prev, status: 'resolved', resolved_at: data.resolved_at } : null));
    });

    socket.on('disconnect', (reason) => {
      setConnectionStatus('reconnecting');
    });

    socket.on('connect_error', () => {
      setConnectionStatus('reconnecting');
    });

    // On reconnect, resynchronize full state from REST API
    socket.io.on('reconnect', () => {
      setConnectionStatus('connected');
      fetchAlertData();
    });

    // Cleanup listeners and disconnect socket on unmount
    return () => {
      socket.off('connect');
      socket.off('subscription:confirmed');
      socket.off('subscription:error');
      socket.off('location:update');
      socket.off('alert:resolved');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, fetchError, fetchAlertData]);

  // Web Push Opt-In / Opt-Out
  const handleEnablePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    setPushMessage('');

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus('denied');
        setPushMessage('Notification permission was not granted.');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushPublicKeyRef.current),
        });
      }

      const res = await fetch(
        `/api/v1/alerts/track/${encodeURIComponent(token)}/push-subscriptions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        }
      );

      if (!res.ok) throw new Error('push_registration_failed');

      setPushStatus('subscribed');
      setPushMessage('This device will now receive emergency updates.');
    } catch {
      setPushStatus('error');
      setPushMessage('Could not enable notifications on this device. Keep this tab open for live updates.');
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch(`/api/v1/alerts/track/${encodeURIComponent(token)}/push-subscriptions`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => null);
        await subscription.unsubscribe();
      }
      setPushStatus('available');
      setPushMessage('Push notifications are disabled on this device.');
    } catch {
      setPushMessage('Could not disable notifications here. You can revoke them in your browser settings.');
    } finally {
      setPushBusy(false);
    }
  };

  // Center Map View Helper
  const handleRecenter = () => {
    if (mapInstanceRef.current && currentLocation) {
      mapInstanceRef.current.setView([currentLocation.latitude, currentLocation.longitude], 17, {
        animate: true,
      });
    }
  };

  // Render Loading State
  if (fetchLoading) {
    return (
      <div className="tracking-container">
        <div className="tracking-card tracking-loading-card">
          <div className="tracking-spinner"></div>
          <h2 className="tracking-title">Connecting to Emergency Tracking Gateway</h2>
          <p className="tracking-subtitle">
            Establishing secure recipient session and loading PostGIS geospatial breadcrumbs...
          </p>
        </div>
      </div>
    );
  }

  // Render Error States
  if (fetchError) {
    return (
      <div className="tracking-container">
        <div className="tracking-card tracking-error-card">
          <div className="tracking-error-icon">⚠️</div>
          <h2 className="tracking-title">
            {fetchError.type === 'expired'
              ? 'Tracking Link Expired'
              : fetchError.type === 'invalid_token'
              ? 'Invalid Emergency Link'
              : fetchError.type === 'rate_limited'
              ? 'Too Many Requests'
              : 'Connection Error'}
          </h2>
          <p className="tracking-subtitle">{fetchError.message}</p>
          <div className="tracking-error-actions">
            <button className="btn btn-outline" onClick={fetchAlertData}>
              ↻ Retry Connection
            </button>
            {onBackToApp && (
              <button className="btn btn-primary" onClick={onBackToApp}>
                Return to App
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isResolved = alert?.status === 'resolved' || alert?.status === 'false_alarm';
  const hasCoordinates = currentLocation !== null && typeof currentLocation.latitude === 'number';

  return (
    <div className="tracking-container">
      {/* Header Bar */}
      <header className="tracking-header">
        <div className="tracking-header-left">
          <div className="tracking-brand">
            <span className="tracking-badge-beacon"></span>
            <span className="tracking-logo-text">SILENT SOS</span>
            <span className="tracking-tag">RECIPIENT PORTAL</span>
          </div>
          <h1 className="tracking-heading">
            Live Emergency Tracking: {alert?.victim_name || 'Individual in Distress'}
          </h1>
        </div>

        <div className="tracking-header-right">
          {/* Status Badge */}
          <div className={`tracking-status-badge ${isResolved ? 'resolved' : 'active'}`}>
            <span className={`sos-pulse-dot ${isResolved ? 'green' : ''}`}></span>
            <span>{isResolved ? 'SAFE / RESOLVED' : 'ACTIVE DISTRESS ALERT'}</span>
          </div>

          {/* WebSocket Connection Badge */}
          <div className={`tracking-connection-badge ${connectionStatus}`}>
            <span className="connection-dot"></span>
            <span className="connection-label">
              {connectionStatus === 'connected'
                ? 'LIVE TELEMETRY'
                : connectionStatus === 'reconnecting'
                ? 'RECONNECTING...'
                : 'OFFLINE'}
            </span>
          </div>

          {onBackToApp && (
            <button className="btn btn-outline btn-sm" onClick={onBackToApp}>
              Exit Portal
            </button>
          )}
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="tracking-grid">
        {/* Map Panel */}
        <section className="tracking-map-panel">
          <div className="tracking-map-wrapper">
            <div
              id="recipient-map"
              ref={mapContainerRef}
              className="tracking-map-canvas"
              role="region"
              aria-label="Real-time emergency tracking map"
            ></div>

            {/* Overlay if GPS coordinates are not yet available */}
            {!hasCoordinates && (
              <div className="tracking-no-coords-overlay">
                <div className="no-coords-card">
                  <div className="no-coords-icon">📡</div>
                  <h3>Awaiting GPS Telemetry</h3>
                  <p>
                    The emergency alert has been activated, but GPS coordinates have not yet been acquired by the
                    sender's device.
                  </p>
                  <p className="no-coords-hint">
                    This map will automatically update the moment a location fix is recorded.
                  </p>
                </div>
              </div>
            )}

            {/* Floating Map Controls */}
            {hasCoordinates && (
              <div className="tracking-map-controls">
                <button
                  className="btn btn-sm btn-map-recenter"
                  onClick={handleRecenter}
                  title="Center map on latest coordinate fix"
                >
                  🎯 Recenter on Fix
                </button>
              </div>
            )}
          </div>

          {/* Accuracy & OpenStreetMap Legal Notice */}
          <div className="tracking-map-footer">
            <div className="tracking-accuracy-notice">
              <span>ℹ️ GPS accuracy is estimated and may vary based on device hardware and cellular reception.</span>
            </div>
          </div>
        </section>

        {/* Telemetry Sidebar */}
        <aside className="tracking-sidebar">
          {/* Emergency Summary Card */}
          <div className="tracking-sidebar-card">
            <h2 className="sidebar-card-title">Emergency Session Details</h2>
            <div className="sidebar-info-grid">
              <div className="sidebar-info-item">
                <span className="info-label">Sender Identity</span>
                <span className="info-value highlight">{alert?.victim_name || 'Protected User'}</span>
              </div>
              <div className="sidebar-info-item">
                <span className="info-label">Triggered At</span>
                <span className="info-value">
                  {formatTime(alert?.triggered_at)}
                  <small className="info-subtext">{formatDate(alert?.triggered_at)}</small>
                </span>
              </div>
              {alert?.resolved_at && (
                <div className="sidebar-info-item">
                  <span className="info-label">Resolved At</span>
                  <span className="info-value" style={{ color: 'var(--accent-green)' }}>
                    {formatTime(alert?.resolved_at)}
                    <small className="info-subtext">{formatDate(alert?.resolved_at)}</small>
                  </span>
                </div>
              )}
              <div className="sidebar-info-item">
                <span className="info-label">Alert Status</span>
                <span className="info-value" style={{ textTransform: 'capitalize' }}>
                  {alert?.status || 'active'}
                </span>
              </div>
            </div>
          </div>

          {/* Web Push Opt-In Card */}
          {!isResolved && !['checking', 'unsupported', 'unavailable'].includes(pushStatus) && (
            <div className="tracking-sidebar-card push-notification-card">
              <h2 className="sidebar-card-title">Emergency Push Alerts</h2>
              <p className="push-card-description">
                Get notified on this device when the live location changes or the alert is resolved,
                even if this tab is closed. Notifications stop when the alert ends.
              </p>
              {pushStatus === 'subscribed' ? (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={handleDisablePush}
                  disabled={pushBusy}
                >
                  {pushBusy ? 'Updating...' : 'Disable on this device'}
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleEnablePush}
                  disabled={pushBusy || pushStatus === 'denied'}
                >
                  {pushBusy
                    ? 'Enabling...'
                    : pushStatus === 'denied'
                    ? 'Notifications Blocked'
                    : pushStatus === 'error'
                    ? 'Retry Enabling Push'
                    : 'Enable Push Notifications'}
                </button>
              )}
              {pushMessage && <p className="push-card-status">{pushMessage}</p>}
              {pushStatus === 'denied' && !pushMessage && (
                <p className="push-card-status">
                  Allow notifications in your browser's site settings, then reload this page.
                </p>
              )}
            </div>
          )}

          {/* Live GPS Coordinates Card */}
          <div className="tracking-sidebar-card">
            <h2 className="sidebar-card-title">Latest Location Telemetry</h2>
            {hasCoordinates ? (
              <div className="sidebar-coords-grid">
                <div className="coord-box">
                  <span className="coord-label">Latitude</span>
                  <span className="coord-value">{currentLocation.latitude.toFixed(6)}°</span>
                </div>
                <div className="coord-box">
                  <span className="coord-label">Longitude</span>
                  <span className="coord-value">{currentLocation.longitude.toFixed(6)}°</span>
                </div>
                <div className="coord-box">
                  <span className="coord-label">Accuracy Radius</span>
                  <span className="coord-value">
                    {currentLocation.accuracy_meters !== null
                      ? `±${Math.round(currentLocation.accuracy_meters)} m`
                      : 'Not Reported'}
                  </span>
                </div>
                <div className="coord-box">
                  <span className="coord-label">Speed</span>
                  <span className="coord-value">
                    {currentLocation.speed_mps !== null
                      ? `${(currentLocation.speed_mps * 3.6).toFixed(1)} km/h`
                      : 'Stationary / N/A'}
                  </span>
                </div>
                <div className="coord-box full-width">
                  <span className="coord-label">Last Recorded Fix</span>
                  <span className="coord-value">{formatTime(currentLocation.logged_at)}</span>
                </div>
              </div>
            ) : (
              <div className="sidebar-pending-state">
                <p>No GPS coordinates logged for this emergency session yet.</p>
              </div>
            )}
          </div>

          {/* Breadcrumbs Trail Log Card */}
          <div className="tracking-sidebar-card">
            <h2 className="sidebar-card-title">
              Breadcrumbs Trail ({locations.length} {locations.length === 1 ? 'Point' : 'Points'})
            </h2>
            <div className="tracking-breadcrumbs-list">
              {locations.length > 0 ? (
                [...locations].reverse().slice(0, 10).map((loc, idx) => (
                  <div key={loc.id || idx} className="breadcrumb-log-item">
                    <span className="breadcrumb-index">#{locations.length - idx}</span>
                    <div className="breadcrumb-details">
                      <span className="breadcrumb-coords">
                        {loc.latitude.toFixed(4)}°, {loc.longitude.toFixed(4)}°
                      </span>
                      <span className="breadcrumb-time">
                        {formatTime(loc.logged_at)} • ±{loc.accuracy_meters ? Math.round(loc.accuracy_meters) + 'm' : 'unk'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="sidebar-pending-state">
                  <p>Trail will populate as coordinates are received.</p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="tracking-footer">
        <p>Silent SOS Emergency Web App • Step 5C &amp; Phase C: Recipient Tracking, Real-Time Gateway &amp; Push Alerts</p>
        <p style={{ marginTop: '0.25rem', color: 'var(--text-muted)' }}>
          Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors • WebSocket telemetry streaming via Socket.IO
        </p>
      </footer>
    </div>
  );
}
