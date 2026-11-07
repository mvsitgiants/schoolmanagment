# SchoolGiant — build plan by phase

Product plan (vision, pricing, go-to-market): https://claude.ai/artifact/7pWLPDqtDcypPDESqt8fNy
How to build one module: see "How each module is built" at the end, and `CLAUDE.md`.

Every module below is **already declared** in `packages/shared/src/catalog.js`: plans, roles and
menus know it, and its pages open a "coming soon" placeholder until the screens are built.
"Reuse" names the Hospital Samadhan code (`../hospital-management`) to port or copy from.

| Phase | Dates | Goal | Gate to start the next phase |
| --- | --- | --- | --- |
| 0 — Platform | done 7 Nov 2026 | Multi-tenant SaaS core | — |
| 1 — MVP | 16 Nov 2026 – 30 Apr 2027 | The 10 modules every school uses daily | 10 paying schools |
| 2 — Growth | May – Oct 2027 | Full school ERP + college core + mobile apps | 50 institutions, 3 colleges live |
| 3 — Full suite | Nov 2027 – Apr 2028 | Campus operations, accreditation, placements | 100 institutions, ₹2.5 crore ARR |
| 4 — Scale | May – Oct 2028 | Languages, AI depth, marketplace, certifications | ISO 27001, international pilots |

---

## Phase 0 — Platform (done)

| Area | What is ready |
| --- | --- |
| Tenancy | One database, every query filtered by institution automatically (fail-closed); campuses |
| Sign-in and security | Password + email code, 2-step, sessions, lockout, audit log of every change |
| Roles | Role designer with page/action permissions, data scopes (own, class, department, campus, all), 16 school role templates |
| SaaS | 4 plans with student limits, trials, GST invoices, Razorpay for subscriptions, superadmin console |
| Admin screens | Profile, campuses, departments, users, modules, settings, number series, custom fields, form builder, approvals, print templates, notification rules, API keys and webhooks |
| Engines | Family notifications (SMS, WhatsApp, email), approvals, forms, print/PDF, Excel import, background jobs |
| Quality | 39 automated tests, English locale files, one-command dev setup (`npm run dev`) |

---

## Phase 1 — MVP (16 Nov 2026 – 30 Apr 2027)

Three squads, eleven 2-week sprints. Pilot schools go live on **1 Feb 2027** with students,
attendance and messages; fees and exams join them in March. Order follows dependencies:
academic setup and students first, because everything else points at a student.

### Sprint timeline

| Sprint (2 weeks) | Squad A — Academics | Squad B — Money & communication | Squad C — Apps |
| --- | --- | --- | --- |
| 1 · 16 Nov | Academic setup ✅ done 7 Nov | Communication hub | App shell, OTP sign-in (PWA) |
| 2 · 30 Nov | Students (SIS) ✅ done 7 Nov | Communication hub | Parent app: profile, notices |
| 3 · 14 Dec | Students (SIS) | Communication hub — chat | Parent app: messages, chat |
| 4 · 28 Dec | Students (SIS) — import, TC, ID cards | Fees — heads, structures | Parent app: attendance |
| 5 · 11 Jan | Attendance | Fees — collection, receipts | Parent app: homework |
| 6 · 25 Jan | Attendance — reports · **pilots start 1 Feb** | Fees — concessions, approvals | Parent app: fees + online payment |
| 7 · 8 Feb | Exams — setup, schedule, marks | Fees — online payment, dues reminders | Parent app: results |
| 8 · 22 Feb | Exams — results, report cards | Fees — refunds, day-end | React Native wrapper (Android) |
| 9 · 8 Mar | Exams — hall tickets, formats | Certificates | React Native (iOS), store listing |
| 10 · 22 Mar | Homework & lessons | Dashboard & reports | App polish, push notifications |
| 11 · 5 Apr | Release candidate: load test, security review, onboarding scripts, pilot feedback fixes | ← | ← |
| 30 Apr | **Gate 1: 10 paying schools** | | |

### Modules

| # | Module | What we build | Reuse from Hospital Samadhan | Weeks | Squad |
| --- | --- | --- | --- | --- | --- |
| 1 | Academic setup ✅ | Academic years and terms, classes and sections, subjects, grading schemes, teacher allocation | Masters engine, Excel import | 2 | A |
| 2 | Students (SIS) ✅ (ID cards pending) | Admission form, directory, Student 360, guardians, documents, promotion, TC, ID cards, bulk import | Patient registry patterns, files, ID card designs, import | 6 | A |
| 3 | Attendance | Daily or period-wise marking (phone-friendly), absence alerts, student leave, registers, reports | Notification engine, HR attendance screens | 3 | A |
| 4 | Exams & report cards | Exam setup, schedule, marks entry and locking, grading, results publishing, report card designer (CBSE / state formats), hall tickets | Print/PDF engine, approvals | 6 | A |
| 5 | Homework & lessons | Lesson plans, syllabus tracker, homework with attachments and submissions | Files and comments | 2 | A |
| 6 | Communication hub | Notices and circulars, bulk SMS / WhatsApp / email, delivery log, parent–teacher chat | Messaging providers, staff chat (comms) | 6 | B |
| 7 | Fees | Fee heads and structures, installments, concessions with approval, collection counter, receipts, Razorpay / UPI online payment, dues reminders, refunds, day-end | Billing, receipts, day-end, payments integration, approvals | 8 | B |
| 8 | Certificates | Bonafide, character, leaving certificates; QR verification; register | Certificates, public verify page | 2 | B |
| 9 | Dashboard & reports | Principal command centre (attendance, fee collection, results), report library | Analytics, report builder | 3 | B |
| 10 | Parent & student app | Attendance, homework, fees and payment, results, notices, chat; OTP sign-in. PWA first, then React Native | Patient portal, OTP sign-in | 12 | C |

---

## Phase 2 — Growth (May – Oct 2027)

Completes the school ERP, adds the college core, and ships native mobile apps. HR & payroll and
accounts are mostly ports — the hospital versions are mature.

| Module | What we build | Reuse | Weeks |
| --- | --- | --- | --- |
| Admissions CRM | Enquiries (website, ads, walk-in), follow-ups, online application, entrance test, merit list, seat allotment | Forms engine, public pages | 6 |
| Timetable | Constraint-based generator, substitutions, rooms | Scheduling engine, roster | 6 |
| LMS | Courses and material, live classes (Zoom / Meet / Jitsi), question bank | Files | 5 |
| Online tests | MCQ and written tests, timer, basic proctoring, auto-evaluation | Forms engine (scoring) | 4 |
| Accounts | Ledgers, journals, expenses, bank reconciliation, GST, Tally export | Finance module — port | 4 |
| Staff & HR | Staff records, staff attendance (biometric), leave, recruitment, appraisal | HRMS — port | 4 |
| Payroll | Salary structures, runs, payslips, PF / ESI / TDS, bank exports | Payroll — port | 3 |
| Transport | Routes, stops, vehicles, student assignment, GPS live tracking, pickup alerts | Ambulance (maps, vehicles) | 5 |
| Library | Catalogue, barcode issue/return, fines | Inventory patterns | 3 |
| Events & calendar | Calendar, PTM slot booking, gallery | Appointments / scheduling | 3 |
| Analytics | Academic performance, fee collection, campus comparison | Analytics, charts | 3 |
| AI assistant | Question paper generator, report-card remarks, assistant over own data (Claude API) | — new | 5 |
| Integrations | School's own Razorpay, WhatsApp / SMS providers, biometric and RFID devices, delivery reports | Integrations — port | 3 |
| Programs & OBE (college) | Programs, regulations, CBCS credits, CO–PO mapping, attainment | — new | 5 |
| Semester registration (college) | Course and elective registration, prerequisites, credit limits, add/drop | — new | 4 |
| Exam controller (college) | Internal / external marks, moderation, revaluation, SGPA / CGPA, grade cards, transcripts | Builds on Exams | 5 |
| Mobile apps | Native teacher app (attendance, marks offline-first) | React Native from Phase 1 | 6 |

**Gate 2 (31 Oct 2027):** 50 institutions, 3 colleges live.

---

## Phase 3 — Full suite (Nov 2027 – Apr 2028)

| Module | What we build | Reuse | Weeks |
| --- | --- | --- | --- |
| Hostel | Rooms and beds, allotment, outpasses, mess, hostel attendance | Bed board patterns (IPD) | 4 |
| Store & assets | Items, stock, purchase orders, uniform / book sales, asset register | Inventory, procurement, assets — port | 4 |
| Health & infirmary | Health records, vaccinations, sick-room visits, incidents | Forms engine, quality incidents | 3 |
| Front office | Visitor log, gate passes, complaints | Front office, feedback complaints | 2 |
| Surveys & feedback | Parent / student surveys, teacher evaluation, polls | Feedback module — port | 2 |
| Website | Institution website with notice board and admission form | Public site API | 4 |
| Accreditation | NAAC (SSR, AQAR), NBA, NIRF, AISHE reports; evidence repository | Quality (NABH) patterns | 6 |
| Training & placements | Companies, drives, eligibility, rounds, offers, statistics | — new | 4 |
| Faculty workload & mentoring | Teaching load, appraisal scores, mentor–mentee logs, at-risk flags | HR performance | 3 |
| Scholarships | Government and institutional scholarships, NSP status, disbursement | — new | 3 |
| Government IDs | APAAR / ABC credit upload, DigiLocker / NAD for degrees, UDISE+ export | Integration patterns (ABDM-style) | 4 |
| AI predictions | At-risk students, fee default prediction, lesson-plan generator | Analytics data | 4 |

**Gate 3 (30 Apr 2028):** 100 institutions, ₹2.5 crore ARR.

---

## Phase 4 — Scale (May – Oct 2028)

| Item | What we build |
| --- | --- |
| Canteen & wallet | Menu, pre-orders, RFID cashless wallet, parent top-up |
| Research | Publications, projects and grants, patents, PhD scholars |
| Alumni | Directory, events, donations, mentoring, job board |
| AI depth | Auto-grading of written answers (teacher approves), admission lead scoring |
| Languages | Hindi first, then regional languages: switch rows on in `languages.js`, translate `locales/<code>/` |
| Marketplace & API | Public API for partners, integrations marketplace, SSO for groups |
| Certifications | ISO 27001 audit, SOC 2 Type II for enterprise and international |
| International | Gulf / Africa pilots: currency, tax and board settings per tenant |

---

## How each module is built

**Steps** (details in `CLAUDE.md`):

1. Confirm the module's pages and actions in `packages/shared/src/catalog.js`.
2. Models with `tenantPlugin` → service → routes with `requirePermission('<module>.<page>.<action>')`.
3. Screens in `frontend/src/pages/<Module>/`, page ids added to `frontend/src/catalog/built.js`.
4. All text in `frontend/src/i18n/locales/en/<module>.json`; run `npm run gen:locales` when the
   catalog, settings or notification events change.
5. Hook into the engines it needs: notifications, approvals, number series, print templates,
   files, masters hub, starter data at provisioning.
6. Tests in `backend/tests/<module>.test.js`; demo data in the seed.

**Definition of done** for every module:

- [ ] Every action checks its permission on the server; data scopes respected
- [ ] Works on a phone screen (teachers and parents use phones)
- [ ] Every change written to the audit log; money and marks changes need approval where set
- [ ] No hard-coded text; `npm run lint:i18n` passes
- [ ] Tests for the main flows and tenant isolation; `npm test` and `npm run build` pass
- [ ] Demo data in the seed; shown to at least one pilot school before release

**Team and rhythm**

- Three squads of 3 (2 developers + 1 shared QA/design): A Academics, B Money & communication, C Apps & platform.
- 2-week sprints; demo to pilot schools every sprint end.
- Release every week to staging, every sprint to production (after pilot sign-off).
- Product owner prioritises from pilot feedback at each sprint planning.
