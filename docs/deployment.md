# Silent SOS — Deployment Guide

This guide deploys the app to a public HTTPS URL that works on any phone or
device. The stack is a single Node service (Express serves the built React app,
Socket.IO, and the pg-boss worker) plus one PostgreSQL database with PostGIS.

Recommended path: **Render** (free web service) + **Neon** (free PostGIS
database). Both are free to start, connect over TLS, and give you a public
`https://` URL, which is required for geolocation and Web Push.

---

## 1. Why this shape

| Requirement | Consequence |
| --- | --- |
| Socket.IO WebSockets stay open | Host must run a long-lived Node process (not serverless functions) |
| pg-boss worker runs in-process | Same long-lived process; jobs live in PostgreSQL |
| `geography` columns from PostGIS | Database must allow `CREATE EXTENSION postgis` |
| Geolocation, Service Worker, Web Push | Page must be served over HTTPS (Render provides it) |
| Single-service client delivery | Express serves `client/dist`, so no separate frontend host |

Hosts such as Vercel or Netlify cannot run this backend (no long-lived
WebSocket server or background worker). Render, Railway, Fly.io, or a VPS can.

---

## 2. Create the database (Neon)

1. Sign in at <https://neon.com> and create a project.
2. Open **Connect** and copy the **direct** connection string (not the pooled
   one — pg-boss keeps long-lived sessions). It looks like:
   ```
   postgresql://neondb_owner:...@ep-xxx-yyy.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
3. No manual PostGIS setup is needed: migration `001_enable_extensions.sql`
   runs `CREATE EXTENSION IF NOT EXISTS postgis;` on first boot.

Supabase also works (enable/keep the default PostGIS extension). Use its
**session/direct** connection string, not the transaction pooler.

---

## 3. Generate secrets

```bash
# JWT signing secret (Render can also generate this automatically)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Web Push VAPID key pair (persist both keys; recipients break if they change)
cd server && npx web-push generate-vapid-keys
```

Never commit `.env` files or these values. Render stores them as encrypted
environment variables.

---

## 4. Deploy on Render

The repository contains [`render.yaml`](../render.yaml), so Render can configure
the service automatically.

1. Push the repository to GitHub (already required for Render).
2. In Render: **New +** → **Blueprint** → select the repository.
3. When prompted, provide:
   - `DATABASE_URL` — the Neon direct connection string from step 2.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — from step 3 (optional, but
     required for recipient push notifications).
   - `VAPID_SUBJECT` — e.g. `mailto:you@example.com` (optional).
   - No origin configuration is needed: `RENDER_EXTERNAL_URL` is automatically
     allowed for CORS/Socket.IO and used for email tracking links. Set
     `APP_BASE_URL` and `CORS_ORIGIN` only when you attach a custom domain.
4. Apply the blueprint. Render runs:
   - Build: `npm run install:all && npm run build`
   - Start: `npm --prefix server run db:migrate && npm start`
   - Health check: `/api/v1/health`

Migrations are idempotent (`schema_migrations`), so they run safely on every
boot. Health returns `200` only when PostgreSQL is reachable; `503` otherwise.

### Manual service setup (instead of the blueprint)

Create a **Web Service** and use the values above with:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm run install:all && npm run build` |
| Start command | `npm --prefix server run db:migrate && npm start` |
| Health check path | `/api/v1/health` |
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |
| `DATABASE_URL` | Neon direct URL |
| `DATABASE_SSL` | `true` |
| `JWT_SECRET` | generated secret |

---

## 5. Open it on your phone

1. Wait for the first deploy to finish, then open
   `https://<your-service>.onrender.com`.
2. Allow **location** when prompted (needed for live tracking breadcrumbs).
3. Register an account, add an emergency contact, then trigger SOS.
4. Copy the tracking link from the dashboard and open it on another device or
   phone — the recipient portal streams live location over Socket.IO.
5. Optionally enable push notifications on the tracking page (HTTPS required,
   which Render provides).
6. Add the page to your phone's home screen for one-tap access.

You can also delegate a **custom domain** in Render → Settings → Custom Domains,
then set `APP_BASE_URL` and `CORS_ORIGIN` to `https://your-domain`.

---

## 6. Notification providers (optional)

Without providers the app still records alerts, live location, and in-app
delivery status, but external messages are skipped.

**Email (SMTP).** Production never fakes delivery: without `SMTP_HOST`, health
reports `email: unavailable` and email attempts are skipped. Set:

```
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM="Silent SOS" <no-reply@your-domain>
```

**SMS (Twilio).** Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
`TWILIO_FROM_NUMBER` (E.164). Trial accounts can only message verified numbers.

**Web Push.** Set all three VAPID values. Generate the pair once and reuse it;
changing keys invalidates every existing subscription.

The health endpoint reports which channels are live:

```bash
curl -s https://<your-service>.onrender.com/api/v1/health | jq .services
```

---

## 7. Post-deploy verification

- [ ] `/api/v1/health` returns `status: "ok"` with `database: "ok"` and
      `queue: "ok"`.
- [ ] Register and log in from a phone browser.
- [ ] Add a contact with an email/phone, trigger SOS, and confirm the alert is
      active.
- [ ] Open the tracking link on a second device: map loads, live location
      updates, and resolution reflects in both views.
- [ ] Set a stealth PIN, press `Ctrl`+`Shift`+`X`, and confirm the decoy appears
      and the alert is created with `trigger_source: "panic_hotkey"`.
- [ ] `grep -c "tracking"` never reveals raw tokens in Render logs.

---

## 8. Free-tier caveats

- **Render free instances sleep** after a period of inactivity; the next visit
  takes roughly a minute to wake. That is acceptable for a demo but not for a
  real emergency service. Upgrade the instance or use an always-on host before
  relying on it.
- **Neon free compute suspends when idle** and resumes on the next connection.
  Quotas and limits change; check the provider's current pricing page.
- **No backups or SLA on free plans.** For coursework/demo use that is fine;
  document it as such.
- Do **not** run `npm run db:seed` against a public deployment: the seeds are
  development fixtures with known demo credentials.

---

## 9. Alternative: quick phone test without deploying

For a short-lived test from a phone on any network, run the production build
locally and expose it through a tunnel:

```bash
npm run build
# Public HTTPS URL, e.g. https://random-name.trycloudflare.com
cloudflared tunnel --url http://localhost:5000
```

Set the tunnel URL as the public origin before starting the server, otherwise
same-origin POST requests and the Socket.IO handshake are rejected:

```bash
# Windows (Git Bash) example
CORS_ORIGIN=https://random-name.trycloudflare.com \
APP_BASE_URL=https://random-name.trycloudflare.com \
NODE_ENV=production npm start
```

The tunnel URL changes on each restart, and your machine must stay awake, so
use this only for demos; Render is the persistent option.
