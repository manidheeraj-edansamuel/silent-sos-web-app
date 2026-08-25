# Silent SOS — REST API Specification (`/api/v1`)

All API routes follow the `/api/v1` namespace convention.

---

## Implemented Endpoints

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
  "timestamp": "2026-08-25T12:00:00.000Z",
  "environment": "development",
  "uptime": 124,
  "services": {
    "api": "ok",
    "database": "ok"
  },
  "databaseLatencyMs": 4
}
```

#### Degraded / Database Unavailable Response (`503 Service Unavailable`):
```json
{
  "status": "degraded",
  "service": "silent-sos-api",
  "version": "v1",
  "timestamp": "2026-08-25T12:00:00.000Z",
  "environment": "development",
  "uptime": 124,
  "services": {
    "api": "ok",
    "database": "unavailable"
  }
}
```

---

## Planned Routes for Future Milestones

### Authentication (`/api/v1/auth`) — *Step 3*
- `POST /api/v1/auth/register` — Create user account
- `POST /api/v1/auth/login` — Authenticate and receive session token
- `POST /api/v1/auth/logout` — Invalidate session

### Trusted Emergency Contacts (`/api/v1/contacts`) — *Step 3*
- `GET /api/v1/contacts` — List trusted emergency contacts
- `POST /api/v1/contacts` — Add a trusted contact
- `PUT /api/v1/contacts/:id` — Update contact information or priority order
- `DELETE /api/v1/contacts/:id` — Remove a trusted contact

### SOS Alert Lifecycle (`/api/v1/alerts`) — *Step 4 & 5*
- `POST /api/v1/alerts/trigger` — Silently initiate emergency alert
- `POST /api/v1/alerts/:id/location` — Push updated coordinate breadcrumb
- `POST /api/v1/alerts/:id/resolve` — Mark alert as safe/resolved
- `GET /api/v1/alerts/track/:token` — Secure recipient tracking query
