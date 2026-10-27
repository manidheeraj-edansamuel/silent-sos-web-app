# Silent SOS Emergency Web App

A safety-focused emergency alerting web application designed to allow individuals to silently trigger an emergency alert when they are unable to make a voice call or speak safely.

---

## ⚠️ Important Safety & Reliability Disclaimers

This is an emergency-oriented web application and is engineered with strict safety constraints in mind:

- **Not a Replacement for Emergency Services:** This application is not a substitute for official emergency response services (e.g., 911 / 112 / local police and emergency dispatch).
- **No Instant Delivery Guarantee:** The system does not guarantee SMS, email, or push notification delivery within 2 seconds due to telecom, carrier, and network variability.
- **Browser Background GPS Limitations:** Web browsers and mobile operating systems impose aggressive battery and lifecycle restrictions. Background location tracking is not guaranteed when the browser tab is closed, suspended, or denied permissions.
- **Graceful Degradation:** The architecture is designed to handle GPS permission denials, missing coordinates, network dropouts, database connectivity disruptions, WebSocket disconnects, and unauthorized tracking attempts safely.

---

## 🏗️ Incremental Development Status

> **Current Phase: Phase C — Multi-Channel Notifications (Completed)**
> 
> Emergency alerts dispatch through three channels. Email and SMS are delivered by the `alert.dispatch` pg-boss worker; browser push is delivered to recipients who opt in from the tracking portal. Email uses SMTP when configured and nodemailer's JSON transport in development; SMS uses Twilio's REST API and is skipped safely when credentials are absent.
>
> Each emergency contact can opt out of email or SMS independently (migration 011), and every send attempt is recorded in `notification_attempts` with a masked destination. The alert owner can follow live delivery receipts in the dashboard (`GET /api/v1/alerts/:id/notifications`).
>
> Recipients viewing the tracking portal can subscribe to browser push for that single alert. Live location pushes are throttled (`PUSH_LOCATION_INTERVAL_SECONDS`, default 120 seconds) and a final notification fires on resolution. Click-through URLs are rebuilt from per-subscription encrypted tracking tokens (AES-256-GCM), so plaintext tokens are never stored; stale endpoints (403/404/410) are deleted automatically, and all subscriptions are removed once the alert is resolved.
>
> Recipient addresses, phone numbers, push endpoints, and raw tracking tokens are never logged or written to audit records; dispatch jobs carrying the raw token are purged after one hour, and the database still stores only the SHA-256 token hash for alert lookup. All-failed deliveries retry with exponential backoff, and each dispatch records a per-channel delivery summary. The suite covers 104 tests across 14 suites.

### Completed in Steps 1–5C
- [x] Multi-package workspace directory structure (`client/`, `server/`, `database/`, `docs/`)
- [x] React + Vite frontend with responsive layout and real-time backend health connectivity display
- [x] Node.js + Express backend skeleton with security headers (`helmet`), CORS configuration, and `/api/v1/health` endpoint
- [x] PostgreSQL 18.6 & PostGIS 3.6.2 database schema definitions (migrations 001–007)
- [x] Migration 008: Added `password_hash` and `last_login_at` to `users`
- [x] Migration 009: Added `tracking_token_hash` to `alerts`
- [x] Idempotent migration runner (`database/scripts/migrate.js`) with `schema_migrations` tracking
- [x] Development mock seed runner (`database/scripts/seed.js`) with Argon2id seed password
- [x] Backend `pg.Pool` connection layer (`server/src/config/database.js`) with graceful error handling
- [x] Argon2id password hashing service (`server/src/services/passwordService.js`)
- [x] Minimal-claim JWT token generator & verification service (`server/src/services/tokenService.js`)
- [x] JWT authentication middleware (`server/src/middleware/auth.js`)
- [x] Authentication rate limiter (`server/src/middleware/rateLimiter.js`)
- [x] Auth REST API (`POST /register`, `POST /login`, `POST /logout`, `GET /me`)
- [x] Emergency contacts REST API (`GET`, `POST`, `GET :id`, `PUT :id`, `DELETE :id`) with transactional priority management
- [x] Strict tenant ownership isolation preventing cross-user contact access
- [x] Silent SOS Alert Activation (`POST /api/v1/alerts/trigger`) with location fallback
- [x] PostGIS coordinate breadcrumb telemetry (`POST /api/v1/alerts/:id/location`)
- [x] Active alert restoration query (`GET /api/v1/alerts/active`)
- [x] Alert resolution lifecycle with resolution reasons (`POST /api/v1/alerts/:id/resolve`)
- [x] Audit trail recording (`alert_events`) for triggers, breadcrumbs, and resolutions
- [x] Public Recipient Tracking REST API (`GET /api/v1/alerts/track/:token`) via SHA-256 token lookup
- [x] Public tracking rate limiting (`trackingRateLimiter`, 60 req/15 min)
- [x] Strict recipient privacy model (omits user IDs, token hashes, credentials, contact phones/emails)
- [x] Chronological GPS coordinate history and 24-hour safety expiration window for resolved alerts
- [x] Socket.IO Real-Time Gateway (`/socket.io`) with cryptographic token room subscriptions
- [x] Isolated alert rooms (`alert:<id>`) with zero global broadcasting
- [x] Interactive Leaflet recipient tracking portal (`/?track=<token>`) with live breadcrumbs, accuracy circles, and resolution handling
- [x] pg-boss asynchronous dispatch queue (`alert.dispatch`) with retry/backoff and post-commit enqueueing
- [x] `notification_dispatched` delivery-attempt audit events written by the queue worker
- [x] Queue depth reporting in `/api/v1/health` and graceful queue shutdown
- [x] Email notification channel via nodemailer (SMTP in production, JSON transport fallback in development)
- [x] Per-contact emergency emails containing private live-tracking links
- [x] Per-channel delivery summaries in audit events (counts + contact IDs, never recipient addresses or tokens)
- [x] Email transport visibility in `/api/v1/health` and `APP_BASE_URL`-aware tracking links
- [x] Tracking-token redaction in HTTP request logs (`/alerts/track/:token` and `?track=...`)
- [x] Web Push channel with VAPID keys and a `push`/`notificationclick` service worker (`client/public/sw.js`)
- [x] Alert-scoped push subscriptions (`push_subscriptions`, migration 010) authorized by raw tracking token
- [x] Per-subscription AES-256-GCM encrypted tracking tokens for push click-through (no plaintext tokens at rest)
- [x] Throttled live-location pushes and a final resolution push with automatic stale-endpoint cleanup
- [x] Recipient opt-in / opt-out push card in the tracking portal with graceful blocked/unsupported states
- [x] Push configuration visibility in `/api/v1/health` and `GET /api/v1/alerts/push/config`
- [x] SMS notification channel via Twilio REST with E.164 normalization and graceful skip when unconfigured
- [x] Per-contact notification preferences (`notify_email`, `notify_sms`, migration 011) enforced by the dispatcher
- [x] Masked per-attempt delivery ledger in `notification_attempts` (no raw addresses or phone numbers stored)
- [x] Alert-owner delivery receipts API (`GET /api/v1/alerts/:id/notifications`) with tenant isolation
- [x] Delivery receipts dashboard card with per-channel counts, masked destinations, and statuses
- [x] SMS transport visibility in `/api/v1/health`
- [x] Single-service production deployment (Express serves `client/dist` with SPA fallback and CSP for map tiles/WebSockets)
- [x] Automated test suites covering Health, Database, Security, Auth, Contacts, Alerts, Socket.IO, Dispatch Queue, Email, Web Push, SMS, and Delivery Receipts (104 passing tests)

### Planned for Future Milestones (Phase D+)
- ❌ Step 6: Stealth mode decoy calculator/notes UI & panic hotkeys
- ❌ Phase E: production hardening and final verification

---

## 📁 Project Structure

```text
silent-sos_web_app/
├── client/                     # Frontend Application (React + Vite)
│   ├── public/                 # Static web assets (sw.js service worker)
│   ├── src/
│   │   ├── App.jsx             # Root UI with SOS trigger, contacts & auth
│   │   ├── main.jsx            # Application entry point
│   │   └── index.css           # Core styling tokens & dark theme
│   ├── index.html
│   ├── vite.config.js          # Vite config with API proxy
│   ├── package.json
│   └── .env.example
├── server/                     # Backend Application (Node.js + Express)
│   ├── src/
│   │   ├── config/
│   │   │   └── database.js     # PostgreSQL connection pool & health checker
│   │   ├── routes/
│   │   │   ├── health.js       # Health check route (/api/v1/health)
│   │   │   ├── auth.js         # Authentication routes (/api/v1/auth)
│   │   │   ├── contacts.js     # Emergency contacts routes (/api/v1/contacts)
│   │   │   └── alerts.js       # SOS emergency alerts routes (/api/v1/alerts)
│   │   ├── middleware/
│   │   │   ├── auth.js         # JWT auth middleware
│   │   │   ├── rateLimiter.js  # Brute-force rate limiting
│   │   │   └── errorHandler.js # Global error handler
│   │   ├── services/
│   │   │   ├── passwordService.js # Argon2id password hashing
│   │   │   ├── tokenService.js    # JWT generation & verification
│   │   │   ├── socketService.js   # Socket.IO real-time location gateway
│   │   │   ├── queueService.js    # pg-boss alert dispatch worker
│   │   │   ├── emailService.js    # SMTP/JSON alert email delivery
│   │   │   ├── smsService.js      # Twilio SMS delivery & phone normalization
│   │   │   ├── notificationLedger.js # Masked per-attempt delivery receipts
│   │   │   └── webPushService.js  # VAPID web push delivery, throttling & token encryption
│   │   ├── app.js              # Express app setup & middleware
│   │   └── server.js           # HTTP & Socket.IO server bootstrap
│   ├── tests/
│   │   ├── health.test.js      # Automated health endpoint test
│   │   ├── database.test.js    # Automated database & PostGIS schema test
│   │   ├── security.test.js    # Argon2id & JWT security tests
│   │   ├── auth.test.js        # Authentication endpoints test
│   │   ├── contacts.test.js    # Emergency contacts test
│   │   ├── alerts.test.js      # Emergency alerts & location test
│   │   ├── socket.test.js      # Real-time Socket.IO gateway tests
│   │   ├── queue.test.js       # pg-boss dispatch queue integration tests
│   │   ├── email.test.js       # Email template, escaping & transport tests
│   │   ├── webpush.test.js     # Push subscriptions, throttling & delivery tests
│   │   ├── sms.test.js         # SMS content, normalization & transport tests
│   │   └── notifications.test.js # Delivery receipts API & tenant isolation tests
│   ├── package.json
│   └── .env.example
├── database/                   # Database Architecture (PostgreSQL + PostGIS)
│   ├── migrations/             # Deterministic SQL migration files (001 - 011)
│   │   ├── 001_enable_extensions.sql
│   │   ├── 002_create_users.sql
│   │   ├── 003_create_emergency_contacts.sql
│   │   ├── 004_create_alerts.sql
│   │   ├── 005_create_alert_locations.sql
│   │   ├── 006_create_alert_events.sql
│   │   ├── 007_create_notification_attempts.sql
│   │   ├── 008_add_user_authentication.sql
│   │   ├── 009_add_tracking_token_to_alerts.sql
│   │   ├── 010_create_push_subscriptions.sql
│   │   └── 011_add_contact_notification_preferences.sql
│   ├── seeds/
│   │   └── 001_dev_seed.sql    # Development mock baseline data
│   ├── scripts/
│   │   ├── init-db.js          # Safe database creation script
│   │   ├── migrate.js          # Transactional migration runner
│   │   └── seed.js             # Dev seed data runner
│   └── README.md               # Detailed database & schema documentation
├── docs/                       # Technical & Architectural Documentation
│   ├── architecture.md         # System architecture, ERD & component design
│   ├── safety_constraints.md   # Critical safety & failure-handling constraints
│   └── api_spec.md             # REST API specifications (/api/v1)
├── .gitignore
├── .env.example                # Root environment template
├── package.json                # Root orchestration & DB scripts
└── README.md                   # Project overview & documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **PostgreSQL**: v18.6+ running locally on port 5432
- **PostGIS**: v3.6.2+ installed on PostgreSQL

### 1. Install Dependencies
```bash
npm run install:all
```

### 2. Environment Configuration
Copy environment templates to local `.env` files (never commit real credentials):
```bash
# Server configuration
cp server/.env.example server/.env
```

Configure your PostgreSQL password in `.env` or set `DATABASE_PASSWORD` in your environment:
```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=silent_sos
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password_here
```

### 3. Initialize Database & Run Migrations
```bash
# Create database if it does not exist
npm run db:init

# Apply migrations 001 through 011 in order
npm run db:migrate

# Populate development mock seed data
npm run db:seed
```

### 4. Run Development Servers
```bash
# Run backend (port 5000) and frontend (port 5173) concurrently:
npm run dev
```

Or run individually:
```bash
# Start Backend
npm run dev:server

# Start Frontend
npm run dev:client
```

### 5. Run Automated Tests
```bash
npm test
```

---

## 🔒 Security Principles
- **No Plaintext Passwords or Hardcoded Secrets**: Secrets must only be provided via environment variables.
- **Strict Role Separation**: Local dev uses `postgres`, production will use a dedicated least-privilege role.
- **Secure Random Tracking Tokens**: Public predictable IDs must never be used for location tracking URLs.
- **Security Headers & CORS**: Standard defense-in-depth headers applied via `helmet` and strict origin policies.
- **Immutable Audit Trail**: Emergency events and transitions are preserved in `alert_events`.
