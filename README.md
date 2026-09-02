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

> **Current Phase: Step 3 — Secure Authentication & Emergency Contact Management**
> 
> In this phase, secure Argon2id password hashing, minimal-claim JWT authentication (`{ sub: userId }`), authentication rate limiting, current user `/api/v1/auth/me` inspection, and protected emergency contacts CRUD with strict tenant ownership isolation and priority ordering have been implemented across the backend and frontend.

### Completed in Step 1, Step 2 & Step 3
- [x] Multi-package workspace directory structure (`client/`, `server/`, `database/`, `docs/`)
- [x] React + Vite frontend with responsive layout and real-time backend health connectivity display
- [x] Node.js + Express backend skeleton with security headers (`helmet`), CORS configuration, and `/api/v1/health` endpoint
- [x] PostgreSQL 18.6 & PostGIS 3.6.2 database schema definitions (migrations 001–007)
- [x] Migration 008: Added `password_hash` and `last_login_at` to `users`
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
- [x] Modern, responsive frontend authentication & contact management UI
- [x] Automated unit and integration test suites for Security, Auth, Contacts, and Health

### Planned for Future Milestones (Step 4+)
- ❌ Silent SOS activation triggers & stealth UI — *Step 4*
- ❌ GPS / Geolocation capture & live tracking — *Step 4*
- ❌ Socket.IO / WebSocket real-time live coordinate streaming — *Step 5*
- ❌ Redis caching & BullMQ async notification queues — *Step 5*
- ❌ SMS (Twilio), Email (SES/SendGrid), and Web Push integrations — *Step 5*
- ❌ Interactive Leaflet map components & recipient tracking view — *Step 5*

---

## 📁 Project Structure

```text
silent-sos_web_app/
├── client/                     # Frontend Application (React + Vite)
│   ├── public/                 # Static web assets
│   ├── src/
│   │   ├── App.jsx             # Root UI with health status monitor
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
│   │   │   └── health.js       # Health check route (/api/v1/health)
│   │   ├── middleware/
│   │   │   └── errorHandler.js # Global error handler
│   │   ├── app.js              # Express app setup & middleware
│   │   └── server.js           # Server bootstrap & port listener
│   ├── tests/
│   │   ├── health.test.js      # Automated health endpoint test
│   │   └── database.test.js    # Automated database & PostGIS schema test
│   ├── package.json
│   └── .env.example
├── database/                   # Database Architecture (PostgreSQL + PostGIS)
│   ├── migrations/             # Deterministic SQL migration files (001 - 007)
│   │   ├── 001_enable_extensions.sql
│   │   ├── 002_create_users.sql
│   │   ├── 003_create_emergency_contacts.sql
│   │   ├── 004_create_alerts.sql
│   │   ├── 005_create_alert_locations.sql
│   │   ├── 006_create_alert_events.sql
│   │   └── 007_create_notification_attempts.sql
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

# Apply migrations 001 through 007 in order
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
