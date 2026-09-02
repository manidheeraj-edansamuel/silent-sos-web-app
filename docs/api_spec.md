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

## 3. Planned Routes for Future Milestones

### SOS Alert Lifecycle (`/api/v1/alerts`) — *Step 4 & 5*
- `POST /api/v1/alerts/trigger` — Silently initiate emergency alert
- `POST /api/v1/alerts/:id/location` — Push updated coordinate breadcrumb
- `POST /api/v1/alerts/:id/resolve` — Mark alert as safe/resolved
- `GET /api/v1/alerts/track/:token` — Secure recipient tracking query
