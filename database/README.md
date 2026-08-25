# Silent SOS — Database Architecture, Migrations & Geospatial Modeling

This directory manages the PostgreSQL 18.6 + PostGIS 3.6.2 database architecture, deterministic migration pipeline, development seed scripts, and schema definitions for the **Silent SOS Emergency Web App**.

---

## 1. Prerequisites

- **PostgreSQL**: Version 18.6 or higher installed and running locally on port `5432`.
- **PostGIS Extension**: Version 3.6.2 or higher installed and available on PostgreSQL.
- **Node.js**: v18+ (tested on Node.js v20/v24).

---

## 2. Security Guardrails

> [!CAUTION]
> **Zero Credential Commitment**:
> - Never store real passwords or database secrets in version control.
> - Never commit `.env` files containing credentials.
> - Configure database credentials strictly via local environment variables (`.env` ignored in `.gitignore`).

---

## 3. Environment Variables Configuration

Copy `.env.example` in the project root or `server/.env.example` to `.env`:

```bash
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=silent_sos
DATABASE_USER=postgres
DATABASE_PASSWORD=your_local_postgres_password
```

| Variable | Default | Description |
|---|---|---|
| `DATABASE_HOST` | `localhost` | PostgreSQL server hostname / IP address |
| `DATABASE_PORT` | `5432` | PostgreSQL server port |
| `DATABASE_NAME` | `silent_sos` | Application database name |
| `DATABASE_USER` | `postgres` | Database username for local development |
| `DATABASE_PASSWORD` | *(empty)* | Database password from local environment |
| `DATABASE_POOL_MAX` | `20` | Max clients in the connection pool |
| `DATABASE_IDLE_TIMEOUT` | `30000` | Idle connection timeout in milliseconds |
| `DATABASE_CONNECT_TIMEOUT`| `3000` | Connection attempt timeout in milliseconds |

---

## 4. Schema Architecture & Migrations

Migrations are stored in `database/migrations/` and execute in deterministic numerical sequence. Applied migrations are tracked idempotently in the `schema_migrations` table.

```
database/
├── migrations/
│   ├── 001_enable_extensions.sql       # pgcrypto & postgis extensions
│   ├── 002_create_users.sql            # users table & identity indexes
│   ├── 003_create_emergency_contacts.sql # trusted contacts & priority constraints
│   ├── 004_create_alerts.sql           # alerts table & alert_status enum
│   ├── 005_create_alert_locations.sql  # PostGIS geography coordinates & GiST index
│   ├── 006_create_alert_events.sql     # immutable audit trail for alert actions
│   └── 007_create_notification_attempts.sql # notification delivery tracking
├── seeds/
│   └── 001_dev_seed.sql                # isolated mock development seed data
├── scripts/
│   ├── init-db.js                      # safe idempotent database creator
│   ├── migrate.js                      # transactional migration runner
│   └── seed.js                         # dev seed runner
└── README.md
```

### Table Specifications

#### 1. `users` (Migration 002)
- `id` (UUID PRIMARY KEY, default `gen_random_uuid()`)
- `full_name` (VARCHAR(150) NOT NULL)
- `phone_number` (VARCHAR(30)) — Indexed (`idx_users_phone_number`)
- `email` (VARCHAR(255)) — Case-insensitive unique index (`idx_users_email_unique`)
- `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())

#### 2. `emergency_contacts` (Migration 003)
- `id` (UUID PRIMARY KEY, default `gen_random_uuid()`)
- `user_id` (UUID NOT NULL REFERENCES `users(id)` ON DELETE CASCADE)
- `contact_name` (VARCHAR(150) NOT NULL)
- `contact_phone` (VARCHAR(30))
- `contact_email` (VARCHAR(255))
- `priority_order` (INTEGER NOT NULL DEFAULT 1, CHECK `priority_order > 0`)
- `created_at`, `updated_at` (TIMESTAMPTZ)
- **Constraints**: At least one communication method (`contact_phone IS NOT NULL OR contact_email IS NOT NULL`), unique priority per user (`UNIQUE(user_id, priority_order)`).

#### 3. `alerts` (Migration 004)
- `id` (UUID PRIMARY KEY, default `gen_random_uuid()`)
- `user_id` (UUID NOT NULL REFERENCES `users(id)` ON DELETE RESTRICT)
- `status` (ENUM `alert_status`: `'active'`, `'acknowledged'`, `'resolved'`, `'false_alarm'`)
- `triggered_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- `acknowledged_at`, `resolved_at` (TIMESTAMPTZ NULL)
- `created_at`, `updated_at` (TIMESTAMPTZ)
- **Indexes**: `user_id`, `status`, `triggered_at DESC`, partial index for `status = 'active'`.

#### 4. `alert_locations` (Migration 005)
- `id` (UUID PRIMARY KEY, default `gen_random_uuid()`)
- `alert_id` (UUID NOT NULL REFERENCES `alerts(id)` ON DELETE CASCADE)
- `location` (`GEOGRAPHY(POINT, 4326)` NOT NULL)
- `accuracy_meters` (DOUBLE PRECISION, CHECK `>= 0`)
- `altitude_meters` (DOUBLE PRECISION NULL)
- `heading_degrees` (DOUBLE PRECISION NULL, CHECK `0 <= heading <= 360`)
- `speed_mps` (DOUBLE PRECISION NULL, CHECK `>= 0`)
- `logged_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- **Spatial Index**: GiST index `idx_alert_locations_location_gist` on `location`.

#### 5. `alert_events` (Migration 006)
- `id` (UUID PRIMARY KEY, default `gen_random_uuid()`)
- `alert_id` (UUID NOT NULL REFERENCES `alerts(id)` ON DELETE CASCADE)
- `event_type` (VARCHAR(50) NOT NULL, e.g., `triggered`, `notification_queued`, `location_updated`, `resolved`)
- `event_data` (JSONB NULL)
- `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())

#### 6. `notification_attempts` (Migration 007)
- `id` (UUID PRIMARY KEY, default `gen_random_uuid()`)
- `alert_id` (UUID NOT NULL REFERENCES `alerts(id)` ON DELETE CASCADE)
- `emergency_contact_id` (UUID REFERENCES `emergency_contacts(id)` ON DELETE SET NULL)
- `channel` (VARCHAR(30) NOT NULL: `sms`, `email`, `push`, `whatsapp`)
- `destination` (VARCHAR(255) NOT NULL)
- `status` (VARCHAR(30) NOT NULL: `queued`, `sent`, `delivered`, `failed`)
- `provider_message_id` (VARCHAR(255) NULL)
- `attempt_number` (INTEGER NOT NULL DEFAULT 1, CHECK `> 0`)
- `error_message` (TEXT NULL)
- `attempted_at`, `delivered_at` (TIMESTAMPTZ)

---

## 5. Development CLI Commands

Run these commands from the repository root:

```bash
# 1. Create the database if it doesn't exist (non-destructive)
npm run db:init

# 2. Run all pending migrations in sequential order
npm run db:migrate

# 3. Populate development baseline seed data (safe mock entities only)
npm run db:seed

# 4. Run automated test suite
npm test
```

---

## 6. Development Seed Data

The development seed (`database/seeds/001_dev_seed.sql`) creates:
- **1 Demo User**: `demo.user@example.local` (`+15550199000`)
- **2 Emergency Contacts**: `Alex Rivera` (Priority 1) and `Jordan Taylor` (Priority 2)
- **1 Resolved Sample Alert**: Complete with 3 PostGIS geography location points (Empire State Building to Bryant Park)
- **6 Audit Events**: Complete chronological event trail (`triggered` -> `notification_queued` -> `notification_sent` -> `location_updated` -> `acknowledged` -> `resolved`)
- **2 Notification Attempts**: SMS and Email mock delivery records.
