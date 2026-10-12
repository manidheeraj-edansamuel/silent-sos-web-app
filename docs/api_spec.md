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
  "priority_order": 2
}
```
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
  "priority_order": 1
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

## 3. Planned Routes for Future Milestones

### Recipient Public Tracking & Real-Time Gateway — *Step 5*
- `GET /api/v1/alerts/track/:token` — Secure recipient tracking query via SHA-256 token lookup
- `WSS /socket.io` — Real-time bidirectional coordinate streaming
