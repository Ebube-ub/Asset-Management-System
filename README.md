# I4nnova Asset Management System — Release 1

An internal asset-management platform built from the Release 1 PRD: requests climb the reporting
lines, the stock manager issues what is in stock, shortfalls go through vendor quotations and a
financial decision, purchases are recorded (buying stays manual) and every physical item is tracked
from registration to disposal.

## Running it

```bash
npm install
npm run dev        # API on http://127.0.0.1:4000, web on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173. The database is created and seeded on first start.

```bash
npm run build      # type-check the server, build the client into dist/client
npm start          # serve API + built client from http://127.0.0.1:4000
npm run typecheck  # both TypeScript projects
npm run seed       # create/verify demo data (no-op if data already exists)
```

### Demo accounts

Every seeded account uses the password **`Password123!`**.

| Role | Email | Name |
| --- | --- | --- |
| Administrator | grace.okafor@i4nnova.com | Grace Okafor |
| Stock Manager | fatima.bello@i4nnova.com | Fatima Bello |
| Financial Executive | ngozi.adeyemi@i4nnova.com | Ngozi Adeyemi |
| Second financial approver / COO | chinedu.balogun@i4nnova.com | Chinedu Balogun |
| Line Manager (Head of Operations) | emeka.nwosu@i4nnova.com | Emeka Nwosu |
| Team Lead | ibrahim.musa@i4nnova.com | Ibrahim Musa |
| Staff Member | zainab.yusuf@i4nnova.com | Zainab Yusuf |

## Stack

- **Frontend** — React 18, TypeScript, Vite, Tailwind CSS v4, TanStack Query, Recharts, React Router.
- **Backend** — Node + Express, TypeScript, Zod validation, role-based authorisation enforced on every
  mutating endpoint (hiding a button is never the only control).
- **Database** — PostgreSQL. Development and demo runs use **PGlite**, the embedded PostgreSQL engine
  compiled to WebAssembly, so the app needs no separately installed database server while still using
  real Postgres `uuid`, `timestamptz`, `numeric`, `check` constraints, sequences and transactions.
  Data persists in `data/pglite`. The schema in `server/db/schema.sql` is standard PostgreSQL and can
  be pointed at a server (`PG`/`DATABASE_URL`) by swapping the connection in `server/db/index.ts`.
- **Auth** — server-side sessions in the database, `httpOnly` cookie, `scrypt` password hashing.
- **Uploads** — quotation and receipt documents plus asset photos stored under `uploads/` and served at
  `/uploads`. Image uploads are type-checked (PNG/JPEG/WebP) and size-limited (5 MB) before being written.

## Layout

```
server/
  db/schema.sql        PostgreSQL schema (Organisation, Requisition, Procurement, Asset Register, Settings)
  db/index.ts          PGlite connection, parameterised query helper, transactions
  db/migrations.ts     idempotent migrations for existing databases, tracked in _migration
  db/seed.ts           demo data (runs only when the organisation table is empty)
  lib/auth.ts          sessions, password hashing, role guards
  lib/repo.ts          shared rules: settings, refs, history, status derivation, hierarchy
  domains/             one module per bounded context: requests, stock, quotes, finance,
                       purchases, assets, assetconfig, disposals, organisation, dashboard, reports,
                       notifications
  lib/mailer.ts        optional email delivery (Resend or webhook) with email_log dedupe
  routes.ts            HTTP surface, one guard per action
shared/domain.ts       vocabulary shared by client and server (statuses, weights, scoring, navigation)
client/src/            React app: pages, layout, design-system components
```

Bounded contexts are kept separate and reference each other by ID only. Request and asset history are
written as log rows (`request_history`, `asset_history`); nothing is rebuilt from events.

## Email notifications

Email is optional and configured entirely on the server — no credentials are ever sent to the browser.
Every notice is written to `email_log` first with a deterministic dedupe key, so a repeated action never
sends the same notice twice, and a delivery failure is recorded without rolling back the request or stock
change it describes. When no provider is configured, messages are marked `skipped` and logged.

| Variable | Purpose |
| --- | --- |
| `MAIL_FROM` | Verified sender, e.g. `I4nnova <Assets@i4nnova.com>` |
| `RESEND_API_KEY` | Sends through `https://api.resend.com` (no extra dependency) |
| `MAIL_WEBHOOK_URL` | Alternative: POST `{ from, to, subject, text }` to an internal relay |
| `MAIL_WEBHOOK_TOKEN` | Optional bearer token for that relay |
| `APP_URL` | Public origin used in links (default `http://127.0.0.1:5173`) |

Set `RESEND_API_KEY` or `MAIL_WEBHOOK_URL` (not both). Notices cover: request submitted, received for
review, approved, rejected, returned, resubmitted; approval requested and given; financial decision;
purchase recorded; asset issued, handed over, collected, returned; and stock levels changed.

## Database migrations

`server/db/schema.sql` is the full, idempotent definition used for a new database. Changes to existing
tables live in `server/db/migrations.ts`, applied once each and tracked in `_migration`; they only add
columns/tables or relax a status constraint, and backfill the Asset Class → Asset Category hierarchy from the
existing `asset_type.category` text. Existing requests, assets and history are preserved; no configuration row is
dropped.

## Interface behaviour

- **Navigation follows permission.** The sidebar, dashboard cards and every in-page link only offer
  modules the signed-in person can open. Staff members without a role see Dashboard, Requests, Assets and
  Transfers & Returns; their requests and assets are scoped to them by the server.
- **Theme.** Light, Dark or System, chosen in Settings → Appearance or from the profile menu. The choice is
  stored per device in `localStorage` and System follows the operating system's preference live. The dark
  palette is implemented by inverting the neutral ramp in `client/src/index.css`, so no component carries
  its own colour branch.
- **Notification feed.** The bell lists the 30 most recent request and asset events the person is entitled
  to see, plus a "Needs you" digest of their open queues. Read state is stored per person in
  `notification_read`; "Mark all read" moves the watermark.
- **Invalid input.** Pressing a confirm/submit button with a field missing or wrong scrolls to and focuses
  the first offending field. `Field` propagates `required` to its control, and errored controls carry
  `aria-invalid`, so the behaviour works for every form and dialog without per-page plumbing.

## Implemented business rules

- Reporting-line review: a request climbs one manager at a time, stops at the first **line manager**,
  whose pass sends it to the stock check. A line manager's own request goes to the next line manager
  above them; staff with no manager skip review. If the reporting line changes while a request waits,
  the next action detects it, restarts the review with the new manager and records it.
- **Return for editing.** A team lead, line manager or approval-level holder can return a request instead
  of rejecting it. The requester is notified, can change the justification, priority and items, then
  resubmit; it resumes at the review or approval stage it came from. Returning records who returned it,
  when, why, and when it was resubmitted. A returned request is never treated as rejected or closed.
- **Group requests.** A line manager can raise one request for several team members. Each unit is
  allocated to a person, keeps its own asset record, and the request follows the same review and
  approval workflow. Recipients must be in the manager's own team (enforced on the server).
- **Configurable approval levels.** Asset Configuration is a four-level hierarchy: **Asset Class → Asset
  Category → Asset Type → Individual Asset**. An approval rule (role plus order) and a minimum request role
  can be set on a class, a category or a type; the most specific one wins, so different classes can carry
  genuinely different approval requirements. After the reporting-line review, any outstanding rule that has
  not already been exercised becomes a pending approval stage; the request waits until a holder of that role
  approves it, then moves to the stock check. Restrictions are enforced on the server, even via the API.
- Rejecting closes the request; a returned request stays open.
- Priority ordering (Critical → High → Medium → Low → earliest raised) in the stock check, quotation
  queue and pending approvals; parked items marked due come first.
- No reservations; issuing is per individual item and each asset keeps its own history.
- Partial stock: issue what exists, send the shortfall for quotations, items tracked individually and
  request status derived from items (never set by hand).
- Quotation scoring with configurable weights (must total 100%), recommendation, tie-breaks, a reason
  required when choosing against the recommendation, weights saved with each choice.
- Financial decisions (approve / decline / defer) per request line with approved amount linked to the
  chosen quotation; declined items close automatically; deferred items park and become due after the
  configured period; the financial executive cannot decide their own request.
- Purchase recording with automated over-budget comparison and a prominent warning; approved amounts
  are never silently changed.
- **Asset Configuration** — asset classes, categories inside them, asset types inside categories, and
  type-specific fields (text, number, dropdown, date, yes/no; required flags; display order). Approval and
  request restrictions can be set at class, category or type level and are inherited when left blank.
  Configuration records linked to assets or request history cannot be deleted; they are deactivated instead and
  stay readable on historical records while disappearing from new requests. Removing a field retires it without
  deleting values already captured.
- **Stock release and handover** — issuing names the authorising person (who must differ from the issuer
  and hold an authorising role; configurable in Settings) and records issuer, authoriser, recipient,
  date and handover state on `asset_release`. Issuing is not collecting: the stock manager records
  *handed over* or *collected*, and the asset lifecycle label reflects it. Returned assets go back to
  stock and are never re-issued automatically.
- **Asset images and attributes** — a photo can be taken or uploaded when registering, purchasing or
  editing an asset (PNG/JPEG/WebP, 5 MB limit, type-validated). Photos show in the register, on the asset
  page and at full size. Type-specific fields are captured per asset and shown on the asset page.
- Asset register with custody settings per type, assignment/transfer/return confirmed by the stock
  manager, blocked re-assignment, disposal proposal → approval → completion (buyer and proceeds for
  sales and auctions).
- Staff departure: blocked by direct reports, held assets or pending reviews; on departure records are
  preserved, sign-in is disabled, outstanding requests are cancelled and unissued items closed.
- Settings: weights, parked review period, second approver, and whether a stock release must be
authorised.

## Acceptance scenarios (seeded)

| # | Scenario | Where to look |
| --- | --- | --- |
| 1 | In stock, issued and fulfilled | REQ for Daniel Eze (monitor) — `Fulfilled`, asset in the register against him |
| 2 | No stock → quotes → approval → purchase → issue | Halima Sani's laptop: awaiting decision with three quotes; Ifeoma's laptop: purchased and ready to issue |
| 3 | Partial stock (3 of 5 issued, 2 on order) | Zainab Yusuf's five laptops — `In progress`, 3 issued, 2 awaiting quotation |
| 4 | Declined request | Samuel Ojo's IP phones — declined, items closed, request closed |
| 5 | Deferred request | Peter Akpan's laptop — parked and already **due for review** |
| 6 | Return | Peter's monitor has a pending return for the stock manager to confirm |
| 7 | Disposal | One pending, one approved, one completed donation, one rejected (asset back to Available) |
| 8 | Quote comparison | Halima's line: three quotes, recommendation computed; choosing another needs a reason |
| — | Over-budget purchase | Server-room switch: approved ₦620,000, cost ₦705,000 — flagged red |
| — | New hire request | Administrator raised a laptop + monitor for Somtochukwu Ibe (never signed in) |
| — | Second approver | Chinedu Balogun is configured as the second financial approver |

Operations that require a different role are hidden in the UI and rejected by the API. To walk a full
chain, sign in as Zainab (raise), Ibrahim (team-lead review), Emeka (line-manager review), Fatima
(stock), Ngozi (finance), Fatima again (purchase, issue).

## Assumptions awaiting business confirmation

The PRD lists open decisions; these are built as configurable behaviour or explicitly conservative:

1. **Executives and second approver** — names/roles are placeholders in the demo data. The second
   approver for the financial executive's own requests is a Settings value, not hard-coded.
2. **Pre-marking assets for disposal** — not implemented. A disposal is proposed with its method; only
   available assets can be proposed and the asset moves to *Awaiting disposal approval*. No separate
   "For disposal" status exists.
3. **Whole-line financial approval** — implemented as whole request lines, with no partial approval.
   To receive fewer items the executive declines and the requester raises a new request.
4. **Re-quoting parked items** — implemented: while an item is parked, the stock manager can send it
   back for new quotations; the previous choice is cleared and a new choice sets a new approved amount.
5. **Disposal approver independence** — not enforced. The stock manager approves; the PRD has not
   confirmed whether the approver must differ from the proposer.
6. **Scope sign-off** — Release 1 only. Purchase orders, funds release, goods-received checks,
   depreciation, barcode/QR, maintenance and automated quote collection are not built. Email delivery is
   implemented and enabled by environment variables; without them the bell still shows in-app activity.
7. A staff member's own request that reaches them as the configured second approver is decided by the
   second approver (same-if-self edge case is not resolved by the PRD).

## Release 1 exclusions honoured

No purchase orders, automated funds release, goods-received checks, depreciation, barcode/QR scanning or
maintenance management. Purchasing is manual; the system records the outcome.

## Prototype feedback (27 November meeting)

- Request form asks for nothing about "who it is for": staff request for themselves, admins can raise for a
  new hire who has never signed in, and line managers can use a group request for their own team.
- Priorities carry plain-English guidance, Medium stays the default, and High/Critical still require a
  justification and business impact from whoever raises or escalates them.
- Approvals → **Purchase Request** in navigation; the queue shows reporting-line reviews and category
  approval levels separately.
- Asset Types → **Asset Configuration** (asset classes, categories, types, fields, approval and request
  restrictions).
- Charts use a distinct colour per series and per status, with labels, legends and readable values.
