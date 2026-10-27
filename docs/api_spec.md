# Silent SOS — REST API Specification (`/api/v1`)

All API routes follow the `/api/v1` namespace convention.

---

## 1. Security & Authentication Standards

### A. Authorization Header
All protected endpoints require a standard HTTP Authorization header containing a Bearer JSON Web Token (JWT):
```http
Authorization: Bearer <jwt_access_token>
```

### B. Minimal-Claim JWT Payload Design
To respect privacy and prevent identity leakage, JWT access tokens contain **ONLY** the subject claim:
```json
{
  "sub": "a0000000-0000-0000-0000-000000000001",
  "iat": 1787910000,
  "exp": 1787996400
}
```
*No personal data (email, phone, name, password hash, contacts, or roles) is stored in the token payload.*

### C. Password Security
- Passwords are encrypted using **Argon2id** (`m=65536, t=3, p=4`).
- Plaintext passwords and `password_hash` strings are strictly excluded from all API responses and application logs.

### D. Logout Behavior
- `POST /api/v1/auth/logout` explicitly signals session termination.
- In this stateless JWT milestone, the client must clear the access token from local storage. Token blacklist/revocation mechanisms will be added in future Redis milestones.

### E. Multi-Tenant Contact Ownership
- Authenticated users can only read, update, or delete contacts they own.
- Contact endpoints derive identity solely from `req.user.id` (extracted from the validated JWT token).
- Accessing or modifying another user's contact ID returns `404 Not Found` to prevent data enumeration.

### F. Transport & Request Hardening
- JSON and URL-encoded request bodies are limited to **64 KB**; larger payloads return `413` with `{ "status": "error" }`.
- `X-Powered-By` is disabled; Helmet sets CSP, `X-Content-Type-Options: nosniff`, frame, and referrer protections.
- All `/api` responses carry `Cache-Control: no-store`.
- Malformed JSON returns `400` and unknown API routes return `404`, both as JSON without stack traces outside development.
- Public endpoints are rate-limited: recipient tracking and push subscription routes at 60 requests / 15 minutes / IP (`trackingRateLimiter`), and push configuration at 60 requests / 15 minutes / IP (`pushConfigRateLimiter`).

---

## 2. Implemented Endpoints

### 1. System Health & Database Diagnostics
Check operational status of the API server and PostgreSQL + PostGIS database connection pool.

- **Route:** `GET /api/v1/health`
- **Authentication:** None (Public)
- **Response Headers:** `Content-Type: application/json`

#### Healthy Response (`200 OK`):
```json
{
  "status": "ok",
  "service": "silent-sos-api",
  "version": "v1",
  "timestamp": "2026-08-29T12:00:00.000Z",
  "environment": "development",
  "uptime": 124,
  "services": {
    "api": "ok",
    "database": "ok"
  },
  "databaseLatencyMs": 4
}
```

---

### 2. User Registration
Registers a new user account with Argon2id password hashing and returns an initial JWT session.

- **Route:** `POST /api/v1/auth/register`
- **Authentication:** None (Public, Rate Limited)
- **Request Body:**
```json
{
  "full_name": "Jane Doe",
  "email": "jane.doe@example.com",
  "phone_number": "+15551234567",
  "password": "SecurePassword123!"
}
```
- **Success Response (`201 Created`):**
```json
{
  "status": "ok",
  "message": "User registered successfully.",
  "data": {
    "user": {
      "id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
      "full_name": "Jane Doe",
      "email": "jane.doe@example.com",
      "phone_number": "+15551234567",
      "created_at": "2026-08-29T12:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```
- **Error Responses:**
  - `400 Bad Request`: Validation failure (missing name/email/password or short password).
  - `409 Conflict`: Account with this email already exists.
  - `429 Too Many Requests`: Rate limit exceeded.

---

### 3. User Login
Authenticates an existing user via Argon2id hash verification and issues a minimal-claim JWT.

- **Route:** `POST /api/v1/auth/login`
- **Authentication:** None (Public, Rate Limited)
- **Request Body:**
```json
{
  "email": "jane.doe@example.com",
  "password": "SecurePassword123!"
}
```
- **Success Response (`200 OK`):**
```json
{
  "status": "ok",
  "message": "Login successful.",
  "data": {
    "user": {
      "id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
      "full_name": "Jane Doe",
      "email": "jane.doe@example.com",
      "phone_number": "+15551234567",
      "created_at": "2026-08-29T12:00:00.000Z",
      "last_login_at": "2026-08-29T12:05:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```
- **Error Responses:**
  - `401 Unauthorized`: Generic `"Invalid email or password."` (prevents user enumeration).
  - `429 Too Many Requests`: Rate limit exceeded.

---

### 4. Current User Profile
Retrieves the safe authenticated user record.

- **Route:** `GET /api/v1/auth/me`
- **Authentication:** `Bearer <token>` (Required)
- **Success Response (`200 OK`):**
```json
{
  "status": "ok",
  "data": {
    "user": {
      "id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
      "full_name": "Jane Doe",
      "email": "jane.doe@example.com",
      "phone_number": "+15551234567",
      "created_at": "2026-08-29T12:00:00.000Z",
      "last_login_at": "2026-08-29T12:05:00.000Z"
    }
  }
}
```
- **Error Responses:**
  - `401 Unauthorized`: Missing, expired, or invalid token.

---

### 5. User Logout
Signals session logout for client state termination.

- **Route:** `POST /api/v1/auth/logout`
- **Authentication:** None / Optional
- **Success Response (`200 OK`):**
```json
{
  "status": "ok",
  "message": "Logged out successfully. Please remove your access token from client storage."
}
```

---

### 6. List Emergency Contacts
Returns all trusted emergency contacts for the authenticated user, ordered by priority.

- **Route:** `GET /api/v1/contacts`
- **Authentication:** `Bearer <token>` (Required)
- **Success Response (`200 OK`):**
```json
{
  "status": "ok",
  "data": {
    "contacts": [
      {
        "id": "c0000000-0000-0000-0000-000000000001",
        "user_id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
        "contact_name": "Alex Rivera",
        "contact_phone": "+15550199001",
        "contact_email": "alex.rivera@example.local",
        "priority_order": 1,
        "notify_email": true,
        "notify_sms": true,
        "created_at": "2026-08-29T12:00:00.000Z",
        "updated_at": "2026-08-29T12:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

---

### 7. Create Emergency Contact
Creates a new trusted contact with automatic priority ordering and collision resolution.

- **Route:** `POST /api/v1/contacts`
- **Authentication:** `Bearer <token>` (Required)
- **Request Body:**
```json
{
  "contact_name": "Jordan Taylor",
  "contact_phone": "+15550199002",
  "contact_email": "jordan.taylor@example.local",
  "priority_order": 2,
  "notify_email": true,
  "notify_sms": false
}
```
`notify_email` and `notify_sms` are optional booleans that default to `true`. A channel is skipped at dispatch time when the preference is false or the matching destination is missing.
- **Success Response (`201 Created`):**
```json
{
  "status": "ok",
  "message": "Emergency contact added successfully.",
  "data": {
    "contact": {
      "id": "c0000000-0000-0000-0000-000000000002",
      "user_id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
      "contact_name": "Jordan Taylor",
      "contact_phone": "+15550199002",
      "contact_email": "jordan.taylor@example.local",
      "priority_order": 2,
      "notify_email": true,
      "notify_sms": false,
      "created_at": "2026-08-29T12:10:00.000Z",
      "updated_at": "2026-08-29T12:10:00.000Z"
    }
  }
}
```

---

### 8. Get Single Emergency Contact
Retrieves a specific contact by UUID with strict ownership verification.

- **Route:** `GET /api/v1/contacts/:id`
- **Authentication:** `Bearer <token>` (Required)
- **Success Response (`200 OK`):**
```json
{
  "status": "ok",
  "data": {
    "contact": {
      "id": "c0000000-0000-0000-0000-000000000001",
      "user_id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
      "contact_name": "Alex Rivera",
      "contact_phone": "+15550199001",
      "contact_email": "alex.rivera@example.local",
      "priority_order": 1,
      "notify_email": true,
      "notify_sms": true,
      "created_at": "2026-08-29T12:00:00.000Z",
      "updated_at": "2026-08-29T12:00:00.000Z"
    }
  }
}
```
- **Error Responses:**
  - `404 Not Found`: Contact does not exist or belongs to another user.

---

### 9. Update Emergency Contact
Updates contact details or shifts priority position transactionally.

- **Route:** `PUT /api/v1/contacts/:id`
- **Authentication:** `Bearer <token>` (Required)
- **Request Body:**
```json
{
  "contact_name": "Alex Rivera (Updated)",
  "contact_phone": "+15550199999",
  "priority_order": 1,
  "notify_email": false
}
```
- **Success Response (`200 OK`):**
```json
{
  "status": "ok",
  "message": "Emergency contact updated successfully.",
  "data": {
    "contact": {
      "id": "c0000000-0000-0000-0000-000000000001",
      "user_id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
      "contact_name": "Alex Rivera (Updated)",
      "contact_phone": "+15550199999",
      "contact_email": "alex.rivera@example.local",
      "priority_order": 1,
      "notify_email": false,
      "notify_sms": true,
      "created_at": "2026-08-29T12:00:00.000Z",
      "updated_at": "2026-08-29T12:15:00.000Z"
    }
  }
}
```

---

### 10. Delete Emergency Contact
Removes a contact and automatically recompactions priority ordering (1, 2, 3...).

- **Route:** `DELETE /api/v1/contacts/:id`
- **Authentication:** `Bearer <token>` (Required)
- **Success Response (`200 OK`):**
```json
{
  "status": "ok",
  "message": "Emergency contact removed successfully."
}
```

---

### 11. Trigger Silent SOS Alert
Silently creates an emergency alert session, generates an unguessable 192-bit tracking token, stores its SHA-256 hash in PostgreSQL, records initial PostGIS geography coordinates (if available), and creates an immutable audit event.

- **Route:** `POST /api/v1/alerts/trigger`
- **Authentication:** `Bearer <token>` (Required)
- **Request Body:**
```json
{
  "trigger_source": "manual_ui",
  "location": {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "accuracy_meters": 8.5,
    "altitude_meters": 15.0,
    "heading_degrees": 180.0,
    "speed_mps": 1.2
  },
  "location_error": null
}
```
*Note: If location is unavailable or denied by user, `location` may be `null` and `location_error` can be provided (e.g. `"PERMISSION_DENIED"`). The alert will still be created with audit event status `location_status: "unavailable"`.*

- **Success Response (`201 Created`):**
```json
{
  "status": "ok",
  "message": "Emergency SOS alert triggered successfully.",
  "data": {
    "alert": {
      "id": "5f4153bf-6b3d-4b7f-b4e4-09d59d816767",
      "status": "active",
      "triggered_at": "2026-09-21T07:10:00.000Z",
      "tracking_token": "j8q-Z_92kd18X74lq9vB...",
      "location": {
        "id": "d1a2b3c4-0000-0000-0000-000000000001",
        "latitude": 37.7749,
        "longitude": -122.4194,
        "accuracy_meters": 8.5,
        "altitude_meters": 15.0,
        "heading_degrees": 180.0,
        "speed_mps": 1.2,
        "logged_at": "2026-09-21T07:10:00.000Z"
      }
    }
  }
}
```

---

### 12. Push Alert Location Coordinate Breadcrumb
Records a new PostGIS geography point breadcrumb for an active alert session.

- **Route:** `POST /api/v1/alerts/:id/location`
- **Authentication:** `Bearer <token>` (Required)
- **Request Body:**
```json
{
  "latitude": 37.7755,
  "longitude": -122.4185,
  "accuracy_meters": 5.0,
  "speed_mps": 2.1
}
```
- **Success Response (`200 OK`):**
```json
{
  "status": "ok",
  "message": "Location breadcrumb recorded successfully.",
  "data": {
    "location": {
      "id": "d1a2b3c4-0000-0000-0000-000000000002",
      "alert_id": "5f4153bf-6b3d-4b7f-b4e4-09d59d816767",
      "latitude": 37.7755,
      "longitude": -122.4185,
      "accuracy_meters": 5.0,
      "altitude_meters": null,
      "heading_degrees": null,
      "speed_mps": 2.1,
      "logged_at": "2026-09-21T07:10:15.000Z"
    }
  }
}
```
- **Error Responses:**
  - `400 Bad Request`: Validation failure (out-of-bounds coordinates) or alert status is not `'active'`.
  - `404 Not Found`: Alert not found or owned by another user.

---

### 13. Resolve Emergency Alert
Marks an active alert as `'resolved'`, records resolution timestamp and reason, and creates an audit event.

- **Route:** `POST /api/v1/alerts/:id/resolve`
- **Authentication:** `Bearer <token>` (Required)
- **Request Body:**
```json
{
  "reason": "Safe Arrival / Threat Passed"
}
```
- **Success Response (`200 OK`):**
```json
{
  "status": "ok",
  "message": "Emergency alert marked as resolved.",
  "data": {
    "alert": {
      "id": "5f4153bf-6b3d-4b7f-b4e4-09d59d816767",
      "user_id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
      "status": "resolved",
      "triggered_at": "2026-09-21T07:10:00.000Z",
      "resolved_at": "2026-09-21T07:15:00.000Z",
      "created_at": "2026-09-21T07:10:00.000Z",
      "updated_at": "2026-09-21T07:15:00.000Z"
    }
  }
}
```
- **Error Responses:**
  - `404 Not Found`: Alert not found or owned by another user.

---

### 14. Get Active Emergency Alert
Retrieves the currently active SOS alert for the authenticated user, including the most recent PostGIS location fix.

- **Route:** `GET /api/v1/alerts/active`
- **Authentication:** `Bearer <token>` (Required)
- **Success Response (`200 OK` - Active Alert Exists):**
```json
{
  "status": "ok",
  "data": {
    "alert": {
      "id": "5f4153bf-6b3d-4b7f-b4e4-09d59d816767",
      "user_id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
      "status": "active",
      "triggered_at": "2026-09-21T07:10:00.000Z",
      "location": {
        "id": "d1a2b3c4-0000-0000-0000-000000000002",
        "latitude": 37.7755,
        "longitude": -122.4185,
        "accuracy_meters": 5.0,
        "logged_at": "2026-09-21T07:10:15.000Z"
      }
    }
  }
}
```
- **Success Response (`200 OK` - No Active Alert):**
```json
{
  "status": "ok",
  "data": {
    "alert": null
  }
}
```

---

### 15. Track Emergency Alert (Public Recipient View)
Public endpoint accessed by trusted emergency recipients holding an unguessable cryptographic tracking token link. Resolves the alert via SHA-256 token lookup in PostgreSQL and returns privacy-hardened alert telemetry without requiring authentication.

- **Route:** `GET /api/v1/alerts/track/:token`
- **Authentication:** None (Public; secured by high-entropy unguessable token and `trackingRateLimiter`)
- **Rate Limit:** 60 requests per 15 minutes per IP (`trackingRateLimiter`)
- **Token Format:** Base64url string, 16–128 characters (`/^[A-Za-z0-9_-]{16,128}$/`). The raw token is hashed with SHA-256 server-side before querying the database; raw tokens and token hashes are never stored, logged, or returned.
- **Privacy Policy:** Internal `user_id`, `email`, `phone_number`, `password_hash`, and `tracking_token_hash` are strictly excluded. Only the permitted victim display name (`victim_name`) and public alert status are returned.
- **Resolved Alert Retention Policy:** Active alerts are live-trackable. Resolved or false-alarm alerts remain accessible for a configurable 24-hour safety window (`TRACKING_RESOLVED_WINDOW_HOURS`, default 24h) so responders can confirm safe arrival, after which the link automatically expires with `404 Not Found`.

#### Success Response (`200 OK` - Active Alert with Location Breadcrumbs):
```json
{
  "status": "ok",
  "data": {
    "alert": {
      "id": "5f4153bf-6b3d-4b7f-b4e4-09d59d816767",
      "status": "active",
      "victim_name": "Alex Rivera",
      "triggered_at": "2026-09-21T07:10:00.000Z",
      "acknowledged_at": null,
      "resolved_at": null,
      "current_location": {
        "id": "d1a2b3c4-0000-0000-0000-000000000002",
        "latitude": 37.7755,
        "longitude": -122.4185,
        "accuracy_meters": 5.0,
        "altitude_meters": null,
        "heading_degrees": null,
        "speed_mps": 2.1,
        "logged_at": "2026-09-21T07:10:15.000Z"
      },
      "locations": [
        {
          "id": "d1a2b3c4-0000-0000-0000-000000000001",
          "latitude": 37.7749,
          "longitude": -122.4194,
          "accuracy_meters": 8.5,
          "altitude_meters": 15.0,
          "heading_degrees": 180.0,
          "speed_mps": 1.2,
          "logged_at": "2026-09-21T07:10:00.000Z"
        },
        {
          "id": "d1a2b3c4-0000-0000-0000-000000000002",
          "latitude": 37.7755,
          "longitude": -122.4185,
          "accuracy_meters": 5.0,
          "altitude_meters": null,
          "heading_degrees": null,
          "speed_mps": 2.1,
          "logged_at": "2026-09-21T07:10:15.000Z"
        }
      ]
    }
  }
}
```

#### Success Response (`200 OK` - Resolved Alert within 24h Window):
```json
{
  "status": "ok",
  "data": {
    "alert": {
      "id": "5f4153bf-6b3d-4b7f-b4e4-09d59d816767",
      "status": "resolved",
      "victim_name": "Alex Rivera",
      "triggered_at": "2026-09-21T07:10:00.000Z",
      "acknowledged_at": null,
      "resolved_at": "2026-09-21T07:35:00.000Z",
      "current_location": {
        "id": "d1a2b3c4-0000-0000-0000-000000000002",
        "latitude": 37.7755,
        "longitude": -122.4185,
        "accuracy_meters": 5.0,
        "altitude_meters": null,
        "heading_degrees": null,
        "speed_mps": 0.0,
        "logged_at": "2026-09-21T07:34:50.000Z"
      },
      "locations": [...]
    }
  }
}
```

#### Success Response (`200 OK` - Alert with No Initial Location):
```json
{
  "status": "ok",
  "data": {
    "alert": {
      "id": "5f4153bf-6b3d-4b7f-b4e4-09d59d816767",
      "status": "active",
      "victim_name": "Alex Rivera",
      "triggered_at": "2026-09-21T07:10:00.000Z",
      "acknowledged_at": null,
      "resolved_at": null,
      "current_location": null,
      "locations": []
    }
  }
}
```

#### Error Responses:
- **`400 Bad Request`**: Malformed or illegal token format (e.g. invalid characters, length < 16 or > 128).
```json
{
  "status": "error",
  "message": "Validation error: Invalid tracking token format."
}
```
- **`404 Not Found`**: Unknown token or expired tracking link (resolved more than 24 hours ago).
```json
{
  "status": "error",
  "message": "Emergency tracking session not found or link has expired."
}
```
- **`429 Too Many Requests`**: Rate limit exceeded (more than 60 requests in 15 minutes per IP).
```json
{
  "status": "error",
  "message": "Too many tracking requests. Please try again after 15 minutes."
}
```

---

### 16. Get Delivery Receipts
Returns per-attempt notification receipts for one alert owned by the authenticated user.

- **Route:** `GET /api/v1/alerts/:id/notifications`
- **Authentication:** `Bearer <token>` (Required)
- **Success Response (`200 OK`):**
```json
{
  "status": "ok",
  "data": {
    "alert_id": "a000d49d-9f30-4019-a358-b4cff4fe4611",
    "alert_status": "active",
    "triggered_at": "2026-10-27T07:00:00.000Z",
    "counts": {
      "total": 2,
      "sent": 1,
      "failed": 1,
      "skipped": 0,
      "by_channel": {
        "email": { "sent": 1, "failed": 0, "skipped": 0 },
        "sms": { "sent": 0, "failed": 1, "skipped": 0 }
      }
    },
    "attempts": [
      {
        "id": "d4c1...",
        "channel": "sms",
        "destination": "+15***9001",
        "status": "failed",
        "provider_message_id": null,
        "attempt_number": 1,
        "error_message": "carrier rejected",
        "attempted_at": "2026-10-27T07:00:02.000Z",
        "delivered_at": null,
        "contact": { "id": "c000...", "contact_name": "Alex Rivera" }
      }
    ]
  }
}
```
- Destinations are masked at write time; raw emails and phone numbers are never returned.
- **`400 Bad Request`**: malformed alert UUID.
- **`404 Not Found`**: alert does not exist or belongs to another user.
- **`401 Unauthorized`**: missing or invalid JWT.

---

## 3. Real-Time Location Gateway (`Socket.IO`) — Step 5B (Implemented)

The Silent SOS real-time gateway enables bidirectional coordinate telemetry and status streaming to authorized emergency recipients via WebSocket/polling (`/socket.io`).

### Connection & Transport
- **URL**: `ws://localhost:5000` (or `http://localhost:5000/socket.io`)
- **Transports**: `['websocket', 'polling']`
- **CORS**: Enforces origin matching aligned with REST API (`CORS_ORIGIN`).

### Authentication & Room Isolation Architecture
1. **Zero Client Trust**: Room subscription is authenticated exclusively via cryptographic tracking tokens (`192-bit base64url`). The client-supplied token is hashed with SHA-256 and matched against `alerts.tracking_token_hash` in PostgreSQL.
2. **Alert Room Scoping**: Sockets join isolated rooms named `alert:<alert_id>`. Clients never join rooms based on unverified alert IDs alone.
3. **No Global Broadcasting**: GPS coordinates and status updates are emitted strictly to `io.to('alert:<alert_id>')`. Sockets outside the room receive zero events.
4. **Data Minimization**: Emitted telemetry payloads contain only coordinates, accuracy radius, status, and timestamps. Sensitive attributes (`user_id`, `email`, `phone_number`, `password_hash`, `tracking_token_hash`, and raw tokens) are never broadcast over WebSockets.

### Client-to-Server Events

#### 1. Handshake Authentication (Optional on Connect)
- **Options**: `{ auth: { token: "<tracking_token>" } }`
- **Behavior**: Verifies token during handshake. Automatically joins the alert room on successful connection. Rejects connection with `connect_error` if token is invalid or expired.

#### 2. Event-Based Subscription: `subscribe:alert`
Subscribes an already connected socket to a specific emergency alert room.
- **Payload**:
```json
{
  "token": "oFB2djvKKbrdnD8LlWEQAo5hLiqj-2oA",
  "alert_id": "a000d49d-9f30-4019-a358-b4cff4fe4611"
}
```
*(Note: `alert_id` is optional; if provided, it must match the alert resolved from `token` or the subscription is rejected).*
- **Acknowledgment Callback / `subscription:confirmed` Event**:
```json
{
  "status": "ok",
  "message": "Successfully subscribed to real-time emergency alert stream.",
  "alert_id": "a000d49d-9f30-4019-a358-b4cff4fe4611",
  "alert_status": "active"
}
```
- **Error Callback / `subscription:error` Event**:
```json
{
  "status": "error",
  "message": "Emergency tracking session not found or link has expired."
}
```

#### 3. Event-Based Unsubscription: `unsubscribe:alert`
Leaves the specified alert room.
- **Payload**: `{ "alert_id": "a000d49d-9f30-4019-a358-b4cff4fe4611" }`
- **Acknowledgment**: `{ "status": "ok", "message": "Unsubscribed from alert stream." }`

### Server-to-Client Real-Time Emission Events

#### 1. Real-Time Location Coordinate: `location:update`
Emitted immediately after a new GPS coordinate breadcrumb is successfully committed to PostgreSQL via `POST /api/v1/alerts/:id/location`.
```json
{
  "alert_id": "a000d49d-9f30-4019-a358-b4cff4fe4611",
  "status": "active",
  "latitude": 37.7760,
  "longitude": -122.4180,
  "accuracy_meters": 6.2,
  "altitude_meters": 14.5,
  "heading_degrees": 180.0,
  "speed_mps": 1.8,
  "logged_at": "2026-10-12T07:45:00.000Z"
}
```

#### 2. Emergency Alert Resolved: `alert:resolved`
Emitted immediately after an emergency alert is marked as resolved via `POST /api/v1/alerts/:id/resolve`.
```json
{
  "alert_id": "a000d49d-9f30-4019-a358-b4cff4fe4611",
  "status": "resolved",
  "resolved_at": "2026-10-12T07:50:00.000Z"
}
```

---

## 4. Web Push Subscription API — Phase C (Implemented)

These public endpoints let a recipient of a tracking link opt into browser push notifications for that single alert. The raw tracking token authorizes both endpoints and is never echoed back.

### `GET /api/v1/alerts/push/config`
Returns the VAPID public key and whether push is enabled. Only the public key is exposed.
```json
{
  "status": "ok",
  "data": {
    "enabled": true,
    "public_key": "BEl6...",
    "vapid_configured": false
  }
}
```
- `vapid_configured` is `false` when development uses ephemeral keys; production refuses to start push without real VAPID keys.
- `429 Too Many Requests` applies via `trackingRateLimiter`.

### `POST /api/v1/alerts/track/:token/push-subscriptions`
Registers (or refreshes) a browser `PushSubscription` for the alert identified by the token.
- **Request body**:
```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/abc123",
    "expirationTime": null,
    "keys": {
      "p256dh": "BNcRd...",
      "auth": "tBHIt..."
    }
  }
}
```
- **`201 Created`**: `endpoint`, keys, and the raw token are never returned.
```json
{
  "status": "ok",
  "message": "Push subscription registered successfully.",
  "data": {
    "subscription": {
      "id": "d4c1...",
      "created_at": "2026-10-27T07:00:00.000Z",
      "updated_at": "2026-10-27T07:00:00.000Z"
    }
  }
}
```
- **`400 Bad Request`**: invalid token format or subscription (endpoint must be HTTPS, ≤ 2048 chars; `p256dh`/`auth` must be base64url).
- **`404 Not Found`**: unknown or expired tracking link.
- **`409 Conflict`**: the alert is no longer active, so push opt-in is rejected.
- Re-registering the same endpoint for the same alert updates the existing row (unique on `alert_id, endpoint`) instead of duplicating it.

### `DELETE /api/v1/alerts/track/:token/push-subscriptions`
Removes a subscription.
- **Request body**: `{ "endpoint": "https://fcm.googleapis.com/fcm/send/abc123" }`
- **`200 OK`**: always returned even if no row matched, so callers cannot probe for subscription existence.

### Delivery Behavior
- `location_update` pushes are throttled per subscription by `last_notified_at` (`PUSH_LOCATION_INTERVAL_SECONDS`, default 120 seconds).
- A `resolved` push is sent once when the alert is resolved, after which all subscriptions for the alert are deleted.
- Subscription endpoints returning `403`, `404`, or `410` are deleted automatically as stale.
- Click-through URLs are rebuilt from per-subscription AES-256-GCM encrypted tracking tokens; plaintext tokens are never stored.

---

## 5. Planned Routes for Future Milestones

### Hardening — *Phase E (Completed)*
- 64 KB request body limits, `no-store` API responses, removed framework fingerprinting, rate-limited push configuration, and security regression tests

### Client-Only Features (No API Surface)
- Stealth mode decoy calculator/notes UI, SHA-256 PIN trigger, and panic hotkeys are implemented entirely in the browser; the only API call is the existing `POST /api/v1/alerts/trigger`, which receives `trigger_source: "stealth_pin"` or `"panic_hotkey"` *(completed)*
- SMS delivery channel via Twilio *(completed)*
- Recipient notification preferences and delivery receipts UI *(completed)*
- Interactive Leaflet recipient tracking portal with live GPS breadcrumb rendering *(completed)*
- pg-boss asynchronous worker pipeline over PostgreSQL *(completed)*
- Email and Web Push notification channels *(completed)*
