# CareerBoard

Personal job application organizer — mint-and-navy productivity board for an active job search.

A personal full-stack portfolio MVP: plain HTML/CSS/JavaScript frontend, Python standard-library backend and SQLite. It runs independently with its own database. All sample data is fictional; there are no real users, clients or production deployments.

## Run it
Requires Python 3.10+ only — no pip packages, no npm, no CDN. From this folder:

```
py server.py --port 8002               # Windows
python3 server.py --port 8002          # macOS / Linux
py server.py --port 8002 --seed-demo   # optional: add the fictional demo account
```
Open http://localhost:8002 and stop with Ctrl+C. The database `data.sqlite3` is created on first launch (override with `DB_PATH`). To run all five projects at once use `start-all.bat` / `stop-all.bat` in the parent folder.

**Demo access (optional, local only):** `--seed-demo` creates `demo@example.com` / `DemoPass123!` (override with `DEMO_PASSWORD`) filled with clearly fictional sample data, marked in the UI with a "Demo workspace" banner. Seeding is refused when `APP_ENV=production`, and never overwrites an existing demo account. Any visitor can also register a fresh, empty, private account.

## Tests
```
py -m unittest discover -s tests
```
Integration tests start the real server on a free port with a throwaway database and exercise it over HTTP: registration/login/logout, session invalidation after logout, CSRF and origin rejection, login rate limiting, account isolation, the domain rules below, CSV formula neutralisation and persistence across a restart.

## Features
- **Applications**: company, role, job posting URL, source, location, work mode, salary range + currency, status, application date, follow-up date, notes. Create/edit/delete with confirmation.
- **Dense application table** with step indicators, search, filters (status, source, work mode, active only, follow-up due within 7 days), sorting and CSV export of the filtered rows.
- **Detail drawer** per application: one-click status changes, linked interviews, status history.
- **Interviews** linked to an application: date/time (your local time), duration, format, round, interviewer/contact, preparation notes and outcome. Interview list with upcoming/outcome filters.
- **Calendar**: month grid (agenda list on mobile) showing follow-ups and interviews; previous/next/today navigation.
- **Dashboard metrics** from your records: active applications, applied this week, response rate, upcoming/completed interviews, offers, follow-ups due/overdue, pipeline by stage and application sources.

## Domain rules (enforced on the server)
- Any status beyond "Saved" requires an application date; application dates can't be in the future; salary minimum ≤ maximum; job URLs must be http(s).
- Logging an interview on a Saved/Applied/Screening application moves it to Interviewing (recorded in its history).
- Response rate = applications that progressed past "Applied" (screening, interview, offer, or an interview logged) ÷ applications with an application date.
- Interviews can only be linked to your own applications and are deleted with their application.

## Data model
```
users ─< applications ─┬─< interviews
                       └─< status_history
```
`applications(company, role, job_url, source, location, work_mode, salary_min, salary_max, currency, status, applied_on, follow_up, notes)` · `interviews(application_id, scheduled_at, duration_min, format, round_name, contact, prep_notes, outcome)` · `status_history(application_id, from_status, to_status, note, created)`

## API
JSON over HTTP; authenticated with the session cookie plus `X-CSRF-Token` on mutations. Auth: `POST /api/register|login|logout`, `GET /api/session`, `GET /api/health`, `GET /api/meta`.
`GET /api/dashboard` · `GET /api/calendar?month=YYYY-MM` · `GET|POST /api/applications` · `GET|PUT|DELETE /api/applications/:id` · `POST /api/applications/:id/status` · `GET|POST /api/interviews` · `PUT|DELETE /api/interviews/:id` · `GET /api/export/applications`

## Project structure
`server.py` domain schema, migrations, validation and routes · `core.py` shared foundation (identical in all five projects) · `frontend/` `index.html`, `style.css`, `app.js` (this product's UI) and `lib.js` (shared helpers) · `tests/` integration tests.

## Security & reliability (shared foundation in `core.py`)
- Passwords hashed with PBKDF2-HMAC-SHA256 (200,000 iterations, per-user salt); constant-time comparison.
- Sessions: random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); only a SHA-256 hash is stored. Sessions expire after 8 hours (`SESSION_TTL_SECONDS`) and are deleted on logout, so a copied cookie stops working.
- CSRF: every POST/PUT/DELETE needs the per-session `X-CSRF-Token` header and a same-origin `Origin`; JSON-only request bodies.
- Login rate limiting: 5 failed attempts per email+IP and 30 per IP per 15 minutes (HTTP 429). Registration: 10 accounts per IP per hour.
- Account isolation: every query is scoped to the signed-in user's id; other users' IDs return 404.
- Server-side validation with field-level messages; parameterised SQL everywhere; each mutating request runs in one `BEGIN IMMEDIATE` transaction (all related writes succeed or none do).
- Consistent errors: `{"error": "...", "code": "...", "fields": {...}}` with appropriate HTTP status codes.
- CSV exports neutralise spreadsheet formulas (cells starting with `= + - @ |`, tab or CR are prefixed with `'`).
- Static files are served with a strict Content-Security-Policy (no inline scripts), `nosniff`, `DENY` framing and path-traversal protection.
- Schema migrations are versioned (`PRAGMA user_version`); an existing database is copied to `data.backup-v<N>-<timestamp>.sqlite3` before migrating. Data from the original single-table version (`records`) is migrated into the new tables and the old table is kept as `legacy_records`.

## Limitations
CareerBoard is an organizer only: it does not submit applications, scrape or fetch live vacancies, or sync with calendars or email. Salary period (monthly/annual) is free text in notes; no currency conversion.
Other: single-user accounts, no password reset, no pagination beyond sensible limits, English UI only, dates displayed in the browser's locale. Visual design was checked in a desktop browser and at mobile width, but not across every browser.

## Production deployment requirements
This is a local portfolio MVP. Before exposing it publicly you would need at least:
- HTTPS termination (reverse proxy such as Caddy/Nginx) and `APP_ENV=production` (enables `Secure` cookies and disables demo seeding).
- A production WSGI/ASGI-grade server or a hardened proxy in front of `ThreadingHTTPServer`, request timeouts and process supervision (systemd, a container restart policy, etc.).
- Persistent storage with scheduled backups for the SQLite file (or migration to PostgreSQL for concurrent multi-instance use).
- Account recovery (password reset by email), email verification and optionally MFA — none are implemented.
- Centralised logging/monitoring, and a shared rate-limit store if running more than one instance.
- Review of privacy/data-retention obligations for the data you store.
