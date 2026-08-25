# Silent SOS — Safety Constraints & Failure Handling Specifications

Emergency systems require rigorous threat modeling and graceful failure handling. The following safety policies and constraints guide every phase of development.

---

## 1. Safety Non-Guarantees (Explicit Limitations)

To avoid false expectations that could endanger users, the following limitations are explicitly recognized:

1. **Not Official Emergency Dispatch:** The web application does NOT replace official 911/112 emergency services.
2. **No Instant Delivery Guarantee:** Under real-world network congestion and SMS carrier filtering, delivery times cannot be guaranteed to occur within two seconds.
3. **Background Location Constraints:** Modern mobile browsers (iOS Safari, Android Chrome) severely throttle or suspend background JavaScript when tabs are not active. Continuous background GPS cannot be assumed on all devices.
4. **Offline Limits:** If the client loses all cellular/WiFi connectivity prior to transmitting an alert, local caching can queue the alert, but delivery requires an active network path.

---

## 2. Mandatory Graceful Failure Handling

The application must handle the following fault modes gracefully without crashing or hanging:

### A. Geolocation Failures
- **Permission Denied (`PERMISSION_DENIED`):** The alert MUST still be triggered and transmitted immediately with a flag indicating `location_unavailable`.
- **Location Timeout / Signal Loss:** If GPS lock takes longer than a threshold (e.g. 5 seconds), send the alert with last known cached location (marked with timestamp age) or trigger without location and update asynchronously once locked.
- **Inaccurate Fix:** Accuracy radius (in meters) must be captured and displayed so responders understand confidence bounds.

### B. Network & Connection Failures
- **WebSocket Disconnection:** Automatic reconnection with exponential backoff and transparent fallback to REST polling.
- **Failed SOS Transmission:** Automatic retry queue with IndexedDB persistence in the browser.
- **Third-Party Notification Failure:** BullMQ worker retries (with jitter and exponential backoff); fall back to secondary communication channels (e.g., email fallback if SMS fails).

### C. Security & Tracking Protection
- **Tracking URL Predictability:** Never use sequential IDs (e.g., `/track/123`). Always use unguessable, high-entropy tokens (e.g., UUIDv4 or 32-character nanoids: `/track/a8f9c2...`).
- **Token Expiration:** Tracking links must automatically expire after alert resolution or after a configurable safety window (e.g., 24 hours).
- **Duplicate Trigger Prevention:** Idempotency keys must prevent duplicate SOS triggers caused by panic tapping or network resends.
- **Sensitive Data Exposure:** Never log plain text passwords, coordinates, or tokens in application log files or client telemetry.
