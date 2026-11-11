# SchoolGiant — working notes for Claude

Multi-tenant school / college SaaS. npm workspaces: `packages/shared`, `backend`, `frontend`.
Product plan: https://claude.ai/artifact/7pWLPDqtDcypPDESqt8fNy. Reference codebase for patterns:
`/Users/admin/uday/hospital-management` (same platform; clinical modules there).

## Rules

- **No hard-coded UI text.** Every string a user sees goes in `frontend/src/i18n/locales/en/<namespace>.json`
  and is read with `useTranslation('<namespace>')`. English is the only language today; others come later.
- **Catalog first.** A module's pages and actions live in `packages/shared/src/catalog.js`; permission key =
  `<module>.<page>.<action>`. After changing the catalog, settings (`settings.js`) or notification events
  (`notifications.js`), run `npm run gen:locales --workspace @schoolgiant/frontend`.
- **Tenancy is automatic and fail-closed.** Tenant models use `tenantPlugin` (`backend/src/platform/db.js`);
  never pass `tenantId` from the request. System jobs use `runAsTenant` / `runAsSystem`.
- Words: institution (not school-only), campus = `Branch` / `branchId` internally, student, guardian / family,
  staff. Money in paise. Dates as `YYYY-MM-DD` strings in the institution's timezone.

## Adding a module (pattern)

1. Catalog entry exists already — check pages/actions still fit. Reference module to copy: Academic setup
   (`models/academics.js`, `services/academics.js`, `routes/academics.js`, `pages/Academics/*`, `tests/academics.test.js`).
   Pickers on other screens: `GET /api/v1/academics/lookup`; "My classes" scope: `mySectionIds()` in services/academics.js.
2. Model(s) in `backend/src/models/<module>.js` with `tenantPlugin`.
3. Service in `backend/src/services/<module>.js`, routes in `backend/src/routes/<module>.js`
   (`requirePermission('<module>.<page>.<action>')`), mounted in `backend/src/app.js`.
4. Screens in `frontend/src/pages/<Module>/`, routes in `frontend/src/App.jsx`, page ids in
   `frontend/src/catalog/built.js`, text in `locales/en/<module>.json`.
5. Optional hooks: masters (`services/masters.js` MASTER_SOURCES), files (`services/files.js` RECORDS),
   documents (`documents/registry.js` + `PRINT_DOCS`), notifications (`NOTIFY_EVENTS` + `emit(event)`),
   approvals (`APPROVAL_TYPES`), number series (`DOC_TYPES`), starter data (`services/provisioning.js`).
6. Tests in `backend/tests/<module>.test.js` (helpers: `startDb`, `newInstitution`, `signIn`).

## Commands

`npm run dev` (db + seed + api + web) · `npm test` · `npm run build` · `npm run lint:i18n` · `npm run lint:pages` ·
`npm run dev:db` / `dev:api` / `dev:web` · `npm run seed -- --reset` · `npm run seed:demo` (fills St. Thomas School — CBSE and UP Board campuses — with data in every module through the API; re-runnable, skips what's there — extend `backend/src/seed/demoStThomas.js` when a module is added)
Dev ports: MongoDB 27018, API 4100, web 5190.
