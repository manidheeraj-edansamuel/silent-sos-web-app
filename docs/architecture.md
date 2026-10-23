# Silent SOS — Architecture Specification

## 1. System Overview

The **Silent SOS Emergency Web App** provides a covert, fast, and reliable mechanism for individuals in distress to activate an SOS alert and share their location with trusted contacts without alerting nearby individuals through audible sounds.

```
                    ┌─────────────────────────┐
                    │      Client Device      │
                    │   React + Vite (PWA)    │
                    │  Silent Trigger & GPS   │
                    └───────────┬─────────────┘
                                │ HTTPS / WSS
                                ▼
                    ┌─────────────────────────┐
                    │      Backend API        │
                    │ Node.js / Express / v1  │
                    │   Socket.IO Gateway     │
                    └────┬──────┬──────────┬──┘
                         │      │          │
         ┌───────────────┘      │          └────────────────┐
         ▼                      ▼                           ▼
┌──────────────────┐  ┌──────────────────┐        ┌──────────────────┐
│   PostgreSQL +   │  │  Redis Cache &   │        │ Notification Svc │
│     PostGIS      │  │  BullMQ Queue    │        │  (Twilio / SES)  │
│ (Users & Alerts) │  │  (Real-time Pub) │        │  (SMS / Email)   │
└──────────────────┘  └──────────────────┘        └─────────┬────────┘
                                                            │
                                                            ▼
                                                  ┌──────────────────┐
                                                  │ Trusted Contacts │
                                                  │ Tracking Portal  │
                                                  └──────────────────┘
```

---

## 2. Core Subsystems & Incremental Milestones

### Phase 1: Project Initialization (Completed)
- React/Vite frontend skeleton with responsive layout & health dashboard
- Node.js/Express backend baseline with `/api/v1` routing & `/api/v1/health`
- Workspace structure, `.gitignore`, `.env.example`, and baseline verification

### Phase 2: Database & Geospatial Modeling (Completed)
- PostgreSQL 18.6 relational schemas with PostGIS 3.6.2 spatial extension
- Tables: `users`, `emergency_contacts`, `alerts`, `alert_locations`, `alert_events`, `notification_attempts`
- Spatial index: GiST index on `alert_locations (location)`
- Idempotent migration runner (`database/scripts/migrate.js`) with `schema_migrations` tracking
- Development mock seeds (`database/scripts/seed.js`)
- Backend `pg.Pool` connection layer with `/api/v1/health` diagnostic integration

### Phase 3: Authentication & User Profiles (Completed)
- Secure user registration and login with Argon2id password hashing (`m=65536, t=3, p=4`)
- Minimal-claim JWT session issuance (`{ sub: userId }`) with auth middleware
- Rate limiting on authentication endpoints (10 requests / 15 minutes)
- Multi-tenant emergency contacts CRUD with strict per-user ownership and transactional priority collision handling
- React authentication UI and contacts management dashboard

### Phase 4: Silent SOS Alert Trigger & Geolocation Tracking (Completed)
- One-touch silent SOS distress activation with graceful location fallback (continues even if GPS is denied)
- Cryptographically secure 192-bit tracking token generation with SHA-256 hash storage in PostgreSQL (Migration 009)
- PostGIS geography coordinate storage (`ST_MakePoint`) and coordinate range validation
- Continuous browser geolocation streaming via `navigator.geolocation.watchPosition` with automatic cleanup
- Active alert restoration across page refreshes (`GET /api/v1/alerts/active`)
- Alert resolution lifecycle with resolution reason and immutable audit trail logging (`alert_events`)

### Phase 5: Real-time Streaming, Recipient Tracking & Notification Queues
- **Step 5A (Completed):** Public Recipient Tracking REST API (`GET /api/v1/alerts/track/:token`) with SHA-256 token lookup, rate limiting, strict privacy guarantees, chronological PostGIS coordinate breadcrumbs, and 24-hour resolved safety window.
- **Step 5B (Completed):** Socket.IO real-time bidirectional location telemetry and status gateway (`ws://.../socket.io`) with cryptographic token-authenticated room subscriptions (`alert:<id>`), zero global coordinate broadcasts, and automated disconnect/reconnect resilience.
- **Step 5C (Completed):** Interactive Leaflet map recipient tracking portal (`/?track=<token>`) with live breadcrumbs, accuracy circles, and resolution handling. pg-boss asynchronous dispatch queue (`alert.dispatch`) backed by PostgreSQL with post-commit enqueueing, retry with exponential backoff, `notification_dispatched` audit events, and queue depth reporting in the health endpoint. Production client build served by Express for single-service deployment.

### Phase 6: PWA, Offline Capabilities & Stealth Mode (Future Milestone)
- Service worker caching, offline capability, installability
- Offline emergency alert queuing with IndexedDB synchronization
- Decoy calculator/notes stealth UI and panic hotkeys

---

## 3. Database Entity-Relationship Architecture

```mermaid
erDiagram
    users ||--o{ emergency_contacts : "has trusted"
    users ||--o{ alerts : "initiates"
    alerts ||--o{ alert_locations : "logs coordinates"
    alerts ||--o{ alert_events : "generates audit trail"
    alerts ||--o{ notification_attempts : "triggers notifications"
    emergency_contacts ||--o{ notification_attempts : "receives"

    users {
        uuid id PK
        varchar full_name
        varchar phone_number
        varchar email
        varchar password_hash
        timestamptz last_login_at
        timestamptz created_at
        timestamptz updated_at
    }

    emergency_contacts {
        uuid id PK
        uuid user_id FK
        varchar contact_name
        varchar contact_phone
        varchar contact_email
        integer priority_order
        timestamptz created_at
        timestamptz updated_at
    }

    alerts {
        uuid id PK
        uuid user_id FK
        alert_status status
        varchar tracking_token_hash
        timestamptz triggered_at
        timestamptz acknowledged_at
        timestamptz resolved_at
        timestamptz created_at
        timestamptz updated_at
    }

    alert_locations {
        uuid id PK
        uuid alert_id FK
        geography location
        double_precision accuracy_meters
        double_precision altitude_meters
        double_precision heading_degrees
        double_precision speed_mps
        timestamptz logged_at
    }

    alert_events {
        uuid id PK
        uuid alert_id FK
        varchar event_type
        jsonb event_data
        timestamptz created_at
    }

    notification_attempts {
        uuid id PK
        uuid alert_id FK
        uuid emergency_contact_id FK
        varchar channel
        varchar destination
        varchar status
        varchar provider_message_id
        integer attempt_number
        text error_message
        timestamptz attempted_at
        timestamptz delivered_at
    }
```

---

## 4. Technology Stack

| Layer | Component | Description |
|---|---|---|
| **Frontend** | React 18+, Vite | Fast, modern client-side rendering with SPA/PWA capabilities |
| **Backend** | Node.js, Express.js | High-throughput REST & WebSocket event coordinator |
| **Realtime** | Socket.IO | Bidirectional event transport for live coordinate streaming |
| **Database** | PostgreSQL 18.6 + PostGIS 3.6.2 | ACID transactional integrity with native geographic coordinates & GiST spatial indexing |
| **Queue/Cache** | Redis + BullMQ | Non-blocking background notification queues & active session cache |
| **Mapping** | Leaflet | Lightweight, privacy-respecting client mapping |
| **Security** | Helmet, CORS, JWT | Layered perimeter and session security |
