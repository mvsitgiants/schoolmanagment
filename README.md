# SchoolGiant

Full-suite, multi-tenant SaaS for schools, colleges and coaching institutes: admissions,
students, attendance, exams and report cards, fees, staff and payroll, transport, hostel,
library, parent app, accreditation and placements — one platform, sold per institution.

- **Product plan** (modules, roadmap, pricing, go-to-market): https://claude.ai/artifact/7pWLPDqtDcypPDESqt8fNy
- **Build plan** (every phase: modules, order, sprints, reuse, gates): [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- **Built on** the platform layer of Hospital Samadhan (`../hospital-management`): same stack,
  same tenancy, roles, subscription and engines — clinical modules removed.

## Status

| Phase | What | State |
| --- | --- | --- |
| 0 — Platform | Tenancy, sign-in, roles & permissions, plans & subscription, superadmin console, administration screens, notification / approval / form / print / number-series engines | **Done** (this repo) |
| 1 — MVP | Academic setup, Students, Attendance, Homework, Exams & report cards, Fees, Certificates, Communication hub, Parent & student app | Next |
| 2–4 | Admissions, timetable, LMS, HR & payroll, transport, library, college modules, AI … | Planned — every module is already in the catalog |

Every module in the plan is declared in `packages/shared/src/catalog.js`, so roles, plans and
the menu already know about it; a page without a screen yet opens a placeholder that shows
what it will do and what the user's role may do there.

## Stack

| Layer | Choice |
| --- | --- |
| Web | React 18, Vite 5, Tailwind CSS 3, React Router 6, TanStack Query 5 |
| API | Node.js 20+, Express 5, Zod |
| Database | MongoDB 7 replica set, Mongoose (transactions) |
| Shared | `@schoolgiant/shared` — catalog, permissions, plans, settings, engines' constants |
| Language | JavaScript (ES modules) |
| Translations | i18next — English only at launch, every string in locale files |
| Tests | Vitest + Supertest + mongodb-memory-server |

```
packages/shared   @schoolgiant/shared — used by both sides
backend           @schoolgiant/backend — Express API
  src/platform      tenancy (fail-closed tenant plugin), auth, access, jobs, pdf, storage, realtime
  src/models        tenant.js, platform.js, engines.js, students.js …
  src/services      users, roles, modules, subscription, notify, approvals, forms, printing …
  src/routes        auth, core (administration), superadmin, public, files, hooks
frontend          @schoolgiant/frontend — React app
  src/pages         Auth, Core (administration), Superadmin, Home, Me, ModulePage
  src/components    system (UI kit), ui (shell), roles, approvals, forms, print …
  src/i18n          locales/en/*.json — all UI text
docker            MongoDB, Mailpit and Gotenberg (PDF) for local use
```

## Run it locally

Needs Node 20+.

```bash
npm install
npm run dev             # starts MongoDB (:27018), adds demo data, then the API (:4100) and the app (:5190)
```

Open http://localhost:5190. `npm run dev` reuses anything already running on those ports, and
Ctrl+C stops what it started.

To run the backend and frontend separately, each in its own terminal:

```bash
cd backend  && npm run dev   # MongoDB (:27018, started if not running) + demo data + API (:4100)
cd frontend && npm run dev   # web app (:5190)
```

The same from the project folder: `npm run dev:api` and `npm run dev:web`. `npm start` in
`backend/` is the plain production start (no database, no reload). `npm run seed -- --reset` wipes the database
and recreates the demo data.

Ports differ from Hospital Samadhan (27017 / 4000 / 5180), so both can run side by side.
Docker alternative: `docker compose -f docker/docker-compose.yml up -d` (MongoDB :27018,
Mailpit :8026, Gotenberg :3001).

Demo sign-ins (also listed on the login page in development):

| Who | Email | Password |
| --- | --- | --- |
| Platform owner (SaaS console) | owner@schoolgiant.test | Owner@123 |
| St. Thomas School, Lucknow — admin (CBSE + UP Board campuses) | admin@stthomas.test | Admin@123 |
| Principals / class teacher / accountant / admissions / front desk | principal.cbse@ / principal.up@ / teacher@ / accounts@ / admissions@ / frontdesk@stthomas.test | Demo@123 |
| Subject teachers (after `npm run seed:demo`) | neha@ / ritu@ / kavita@ / amit@ / seema@ / pradeep@ … stthomas.test | Demo@123 |

## Checks

```bash
npm test            # backend tests (in-memory MongoDB)
npm run build       # frontend production build
npm run lint:i18n   # every key present in every supported language
npm run lint:pages  # page layout conventions
```

## Languages

English only for now, but no text is hard-coded: everything a user reads comes from
`frontend/src/i18n/locales/en/*.json`. To add a language later, switch it on in
`packages/shared/src/languages.js` (the rows are ready, commented out) and add
`locales/<code>/` with the same files — `npm run lint:i18n` then checks it is complete.
See `frontend/src/i18n/README.md`.
