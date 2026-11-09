# CollectAssist: deployment and running guide

- **Repository:** https://github.com/samartiwari/collect-assist
- **Live app:** https://collect-assist.onrender.com (Render free plan: the first request after 15 idle minutes takes about 30–60 s to wake up)

## Demo logins

Every account uses the password **`Demo@1234`**. The sign-in page also lists them as tap-to-fill chips.

| Role | Email | What to try |
|---|---|---|
| Field officer (Indore City, Hindi UI) | `rahul@demo.in` | Today's prioritised list, call/map, log an outcome in three taps, go offline and log, then sync |
| Field officer (Indore City, English UI) | `neha@demo.in` | Same as above; owns sample loan LN-10871 (27 DPD) |
| Field officer | `imran@demo.in` | Owns LN-11930, which has a broken promise from 31 Oct |
| Branch manager, Indore City | `manager.indore@demo.in` | CSV import and auto-assignment, roll-rate view, promise tracker, team lists (pin/reassign), activity log |
| Head of collections (all branches) | `head@demo.in` | Roll rates by branch, model back-test |

Other officers: `pooja@`, `arjun@`, `sana@`, `vikram@`, `meena@demo.in`. Other branch managers: `manager.pithampur@demo.in`, `manager.dewas@demo.in`.

### Reviewing outside 8 am – 7 pm IST

RBI rules allow borrower contact only from 8 am to 7 pm IST, and the app enforces that: outside those hours, calls, outcome logging and borrower reminders are blocked. If you review in the evening, use the **Demo time** pill in the top bar and set a time such as 11:00. That moves the server and every phone to that time for the demo. Set it back to "Real time" when you're done. You can turn it off in production with `DEMO_MODE=false`.

### Trying offline logging

1. Sign in as `rahul@demo.in` and open **Today**.
2. In Chrome DevTools → Network, set **Offline**, or switch the phone to airplane mode.
3. Log outcomes for a few borrowers. They move to "Done today" straight away, and the top bar shows the number waiting to sync.
4. Go back online. The outbox syncs automatically within seconds, or tap **Sync now** on the Sync screen. Each item shows its server result: synced, already synced, blocked (outside hours) or not saved (with the reason).

### Trying the CSV import

Sign in as `manager.indore@demo.in` → **Import** → **Download sample CSV**, then upload the same file. The sample has today's loans with DPD +1, six new loans, a few loans missing (they get closed as cured), and two broken rows that show row-level errors.

## Run locally

Prerequisites: **Node.js 18.18 or newer (tested on 18.19 and 20)** and npm. No database server is needed, because SQLite is embedded.

```bash
git clone https://github.com/samartiwari/collect-assist.git
cd collect-assist
npm install
npm run seed        # creates ./data/collect.db with demo data (re-run any time to reset)
npm run dev         # API on :3001 and web app on :5173
```

Open http://localhost:5173. To try it on a phone on the same Wi-Fi, run `npx vite --host` instead of `npm run dev:web` and open the printed network URL.

Run the tests (unit and API, about 3 s):

```bash
npm test
npm run typecheck
```

Production build locally:

```bash
npm run build
JWT_SECRET=$(openssl rand -hex 32) npm start   # serves the API and the built app on http://localhost:3001
```

If the database file is empty on start, the server loads the demo data itself.

## How it is deployed

One Node web service on **Render** serves both the API (`/api/*`) and the built React app (static files plus the service worker). It is defined in [`render.yaml`](render.yaml):

- Build: `npm ci --include=dev && npm run build` (Vite builds the app and service worker into `dist/`)
- Start: `npm start` (Express + SQLite, `NODE_ENV=production`, secure cookies)
- Health check: `GET /api/health`

To deploy your own copy: Render dashboard → **New → Blueprint** → pick this repository → **Apply**. Render generates `JWT_SECRET`.

**Data persistence:** on the free plan the instance disk is temporary, so the SQLite file resets on every redeploy or restart and the demo data reloads. For real use, attach a persistent disk and point `DATABASE_PATH` at it, or move to managed Postgres. See "What I would do next" in the TDD.

## Environment variables

Names only, never values. Copy `.env.example` for local overrides.

| Name | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | Yes in production | Signs the session cookie. A long random string. In development a local default is used if unset. |
| `PORT` | No (default `3001`) | Port the server listens on. Render sets it. |
| `DATABASE_PATH` | No (default `./data/collect.db`) | SQLite file location. |
| `DEMO_MODE` | No (default `true`) | Shows the demo clock control. Set `false` for real use. |
| `NODE_ENV` | Set by `npm start` | `production` enables secure cookies and static file serving. |
| `NODE_VERSION` | Render only | Node version for the Render build (`20.18.0`). |

No third-party API keys are needed. The scoring model runs inside the app. Messages, payments and geocoding are mocked.
