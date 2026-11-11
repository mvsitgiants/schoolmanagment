import { Router } from 'express'
import {
  CANDIDATE_SOURCES, CANDIDATE_STAGES, EMPLOYEE_CATEGORIES, EMPLOYMENT_TYPES, EXIT_TYPES, GENDERS, LEAVE_ACCRUALS, LEAVE_APPROVER_TYPES,
  LEAVE_CALENDAR_KINDS, LEAVE_CHAIN_MAX_STEPS, LEAVE_STATUSES, MARKABLE, NO_LEAVE_MODES, REQUISITION_STATUSES, SALARY_MODES,
} from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { email, mobile, objectId, optionalText, pageParams, printImage, z } from '../platform/validate.js'
import {
  addHolidays, cancelExit, createEmployee, createLogin, deleteHoliday, exitEmployee, exportEmployees, getEmployee, hrmsMeta, importEmployees, linkLogin,
  listEmployees, listHolidays, myRecord, recordsFromLogins, saveHoliday, sensitive, setSalary, setSensitive, updateEmployee, updateMyRecord,
} from '../services/hrms.js'
import { dayRegister, exportMonth, importAttendance, monthRegister, myMonth, saveDay } from '../services/hrmsAttendance.js'
import {
  adjustBalance, applyFor, applyMine, balanceBoard, calendarSuggestions, cancelLeave, creditCompOff, decideLeave, deleteCalendarDay, employeeBalances, getLeave,
  leaveSummary, ledgerFor, listCalendarDays, listLeaveTypes, listLeaves, myLeave, previewFor, runYearEnd, saveCalendarDay, saveLeaveType, teamCalendar,
  waitingForMe, yearEndPreview,
} from '../services/hrmsLeave.js'
import { deleteLeaveApprovalRule, leaveApprovalOptions, listLeaveApprovalRules, saveLeaveApprovalRule } from '../services/hrmsLeaveApprovals.js'
import {
  evaluateCandidate, getCandidate, hireCandidate, listCandidates, listRequisitions, moveCandidate, offerCandidate, saveCandidate, saveRequisition, setRequisitionStatus,
} from '../services/hrmsHiring.js'
import { closeCycle, cycleReviews, getReview, launchCycle, listCycles, myReviews, saveCycle, setReviewer, submitManager, submitSelf } from '../services/hrmsPerformance.js'

// Staff & HR: /api/v1/hrms/*  (self-service under /me needs no HR permission — only a linked staff record)
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('hrms'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const ym = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM')
const id = (req) => objectId.parse(req.params.id)
const blank = (s) => s.optional().or(z.literal('').transform(() => undefined))
const optId = objectId.optional().nullable().or(z.literal('').transform(() => null))
const paise = z.coerce.number().int().min(0).max(1e11)
const values = (list) => list.map((x) => x.value ?? x)
const csv = (res, name, text) => res.type('text/csv').attachment(name).send(`﻿${text}`)
const EMP = 'hrms.employees'
// one page of a list: 50 rows by default, at most 100 (the platform's clamp)
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }

// ───────────────────────────────────────────────────────── staff

router.get('/meta', requirePermission(`${EMP}.view`, 'hrms.attendance.view', 'hrms.leave.view', 'hrms.hiring.view', 'hrms.performance.view', 'hrms.holidays.view'), async (req, res) => {
  res.json({ data: await hrmsMeta(req.auth) })
})

const addressSchema = z.object({ line: optionalText(200), city: optionalText(80), state: optionalText(80), pincode: optionalText(10) }).partial()
const emergencySchema = z.object({ name: optionalText(100), relation: optionalText(40), phone: optionalText(20) }).partial()
const employeeSchema = z.object({
  employeeCode: optionalText(20),
  name: z.string().trim().min(2, 'Enter the name').max(120),
  gender: blank(z.enum(values(GENDERS))), dob: blank(ymd), bloodGroup: optionalText(4),
  mobile: blank(mobile), email: blank(email), address: addressSchema.optional(), emergencyContact: emergencySchema.optional(),
  qualifications: optionalText(300), experienceYears: z.coerce.number().min(0).max(60).optional().or(z.literal('').transform(() => undefined)),
  subjects: z.array(z.string().trim().max(60)).max(20).optional(),
  designation: optionalText(80), departmentId: optId, branchId: optId, reportingManagerId: optId,
  category: z.enum(values(EMPLOYEE_CATEGORIES)), employmentType: z.enum(values(EMPLOYMENT_TYPES)),
  joiningDate: ymd, confirmationDate: blank(ymd),
  weeklyOffDays: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).max(3).optional(),
  geofenceExempt: z.boolean().optional(), // field staff: may check in from their phone anywhere
  photo: printImage,
  notes: optionalText(2000),
  userId: optId,
  login: z.object({ email: blank(email), roleIds: z.array(objectId).min(1, 'Pick a role'), invite: z.boolean().default(true), password: optionalText(100) }).optional(),
})

router.get('/employees', requirePermission(`${EMP}.view`), async (req, res) => {
  const q = z.object({ search: optionalText(100), status: optionalText(20), category: optionalText(20), employmentType: optionalText(20), departmentId: objectId.optional(), branchId: objectId.optional() }).parse(req.query)
  res.json(await listEmployees(q, pageParams(req.query), req.auth))
})
router.get('/employees/export', requirePermission(`${EMP}.export`), async (req, res) => {
  csv(res, 'staff.csv', await exportEmployees(req.query, req.auth))
})
router.post('/employees', requirePermission(`${EMP}.create`), async (req, res) => {
  res.status(201).json({ data: await createEmployee(employeeSchema.parse(req.body), req.auth, req) })
})
router.post('/employees/import', requirePermission(`${EMP}.import`), async (req, res) => {
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.string(), z.any())).min(1).max(2000), dryRun: z.boolean().default(false) }).parse(req.body)
  res.json({ data: await importEmployees(rows, { dryRun }, req.auth, req) })
})
router.post('/employees/from-logins', requirePermission(`${EMP}.create`), async (req, res) => {
  res.json({ data: await recordsFromLogins(req.auth, req) })
})
router.get('/employees/:id', requirePermission(`${EMP}.view`), async (req, res) => {
  res.json({ data: await getEmployee(id(req), req.auth) })
})
router.patch('/employees/:id', requirePermission(`${EMP}.edit`), async (req, res) => {
  const input = employeeSchema.omit({ login: true, userId: true }).partial().extend({ effectiveDate: blank(ymd), changeNote: optionalText(300) }).parse(req.body)
  res.json({ data: await updateEmployee(id(req), input, req.auth, req) })
})
router.get('/employees/:id/sensitive', requirePermission(`${EMP}.view_sensitive`), async (req, res) => {
  res.json({ data: await sensitive(id(req), req.auth, req) })
})
router.put('/employees/:id/sensitive', requirePermission(`${EMP}.edit`), async (req, res) => {
  const v = (re, msg, max = 30) => z.string().trim().max(max).regex(re, msg).optional().nullable().or(z.literal('').transform(() => ''))
  const input = z.object({
    pan: v(/^[A-Z]{5}\d{4}[A-Z]$/i, 'Like ABCDE1234F'), aadhaar: v(/^\d{4}\s?\d{4}\s?\d{4}$/, '12 digits'), uan: v(/^\d{12}$/, '12 digits'), esi: v(/^\d{10,17}$/, '10 to 17 digits'),
    bankName: optionalText(80), ifsc: v(/^[A-Z]{4}0[A-Z0-9]{6}$/i, 'Like SBIN0001234'), accountName: optionalText(100), account: v(/^\d{6,20}$/, '6 to 20 digits'),
  }).parse(req.body)
  res.json({ data: await setSensitive(id(req), input, req.auth, req) })
})
router.put('/employees/:id/salary', requirePermission(`${EMP}.edit`), async (req, res) => {
  const input = z.object({
    paymentMode: z.enum(SALARY_MODES).default('BANK'), ctcAnnual: paise.optional(), grossMonthly: paise, basicMonthly: paise.optional(),
    pf: z.boolean().default(true), esi: z.boolean().default(false), pt: z.boolean().default(true), effectiveFrom: blank(ymd),
  }).parse(req.body)
  res.json({ data: await setSalary(id(req), input, req.auth, req) })
})
router.put('/employees/:id/login', requirePermission(`${EMP}.edit`), async (req, res) => {
  const { userId } = z.object({ userId: optId }).parse(req.body)
  res.json({ data: await linkLogin(id(req), userId, req.auth, req) })
})
router.post('/employees/:id/login', requirePermission(`${EMP}.edit`), async (req, res) => {
  const input = z.object({ email: blank(email), roleIds: z.array(objectId).min(1, 'Pick a role'), invite: z.boolean().default(true), password: optionalText(100) }).parse(req.body)
  res.status(201).json({ data: await createLogin(id(req), input, req.auth, req) })
})
router.post('/employees/:id/exit', requirePermission(`${EMP}.terminate`), async (req, res) => {
  const input = z.object({ type: z.enum(values(EXIT_TYPES)), noticeDate: blank(ymd), lastWorkingDate: ymd, reason: optionalText(500), deactivateLogin: z.boolean().default(true) }).parse(req.body)
  res.json({ data: await exitEmployee(id(req), input, req.auth, req) })
})
router.post('/employees/:id/exit/cancel', requirePermission(`${EMP}.terminate`), async (req, res) => {
  res.json({ data: await cancelExit(id(req), req.auth, req) })
})
router.get('/employees/:id/leave', requirePermission('hrms.leave.view', `${EMP}.view`), async (req, res) => {
  res.json({ data: await employeeBalances(id(req), req.auth) })
})
router.get('/employees/:id/leave/ledger', requirePermission('hrms.leave.view'), async (req, res) => {
  res.json({ data: await ledgerFor(id(req), req.query.leaveTypeId, req.auth) })
})
router.post('/employees/:id/leave/adjust', requirePermission('hrms.leave.edit'), async (req, res) => {
  const input = z.object({
    leaveTypeId: objectId, days: z.coerce.number().min(-365).max(365).refine((n) => n !== 0 && Math.abs(n * 2) % 1 === 0, 'Whole or half days'), note: z.string().trim().min(3, 'Say why').max(300),
    kind: z.enum(['ADJUSTMENT', 'OPENING']).default('ADJUSTMENT'),
  }).parse(req.body)
  res.json({ data: await adjustBalance(id(req), input, req.auth, req) })
})

// ───────────────────────────────────────────────────────── staff attendance

const attQ = (q) => z.object({ departmentId: objectId.optional(), branchId: objectId.optional(), category: optionalText(20) }).parse(q)
router.get('/attendance/day', requirePermission('hrms.attendance.view'), async (req, res) => {
  const { date } = z.object({ date: ymd }).parse(req.query)
  res.json({ data: await dayRegister(date, req.auth, attQ(req.query)) })
})
router.put('/attendance/day', requirePermission('hrms.attendance.edit'), async (req, res) => {
  const { date, entries } = z.object({
    date: ymd,
    entries: z.array(z.object({ employeeId: objectId, status: z.enum(MARKABLE).nullable(), inTime: blank(hhmm), outTime: blank(hhmm), note: optionalText(200) })).max(3000),
  }).parse(req.body)
  res.json({ data: await saveDay(date, entries, req.auth, req) })
})
router.get('/attendance/month', requirePermission('hrms.attendance.view'), async (req, res) => {
  const { month } = z.object({ month: ym }).parse(req.query)
  res.json({ data: await monthRegister(month, req.auth, attQ(req.query)) })
})
router.get('/attendance/month/export', requirePermission('hrms.attendance.export'), async (req, res) => {
  const { month } = z.object({ month: ym }).parse(req.query)
  csv(res, `staff-attendance-${month}.csv`, await exportMonth(month, req.auth, attQ(req.query)))
})
router.post('/attendance/import', requirePermission('hrms.attendance.import'), async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.object({ employeeCode: z.string().max(30), date: z.string().max(10), inTime: blank(hhmm), outTime: blank(hhmm), status: optionalText(12) })).min(1).max(20000) }).parse(req.body)
  res.json({ data: await importAttendance(rows, req.auth, req) })
})

// ───────────────────────────────────────────────────────── leave

const days = (max) => z.coerce.number().min(0).max(max)
const optNum = (schema) => schema.optional().nullable().or(z.literal('').transform(() => null))
const leaveTypeSchema = z.object({
  code: z.string().trim().min(1).max(8).regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only'), name: z.string().trim().min(2).max(60), paid: z.boolean().default(true),
  accrual: z.enum([...values(LEAVE_ACCRUALS), 'YEARLY']).default('ANNUAL_UPFRONT'), perYear: days(365).default(0),
  carryForwardMax: optNum(days(365)).default(0), // null = no limit
  allowHalfDay: z.boolean().default(true), sandwich: z.boolean().default(false), allowNegative: z.boolean().default(false),
  maxPerRequest: optNum(z.coerce.number().int().min(1).max(365)),
  genders: z.array(z.enum(values(GENDERS))).default([]), categories: z.array(z.enum(values(EMPLOYEE_CATEGORIES))).default([]),
  categoryQuota: z.array(z.object({ category: z.enum(values(EMPLOYEE_CATEGORIES)), perYear: days(365) })).max(10).default([]),
  pauseInVacation: z.boolean().default(false), blackoutExempt: z.boolean().default(false), compOff: z.boolean().default(false),
  noticeDays: optNum(z.coerce.number().int().min(1).max(90)), description: optionalText(200),
  tone: z.string().max(20).default('neutral'), order: z.coerce.number().int().default(0), active: z.boolean().default(true),
})
const applySchema = z.object({
  leaveTypeId: objectId, from: ymd, to: ymd, halfDay: z.boolean().default(false), half: z.enum(['FIRST', 'SECOND']).optional(),
  reason: z.string().trim().min(2, 'Give a reason').max(500), arrangement: optionalText(500),
})
const previewSchema = applySchema.pick({ leaveTypeId: true, from: true, halfDay: true, half: true }).extend({ to: blank(ymd) })
const decideSchema = z.object({ approve: z.boolean(), note: optionalText(300) })
const ruleSchema = z.object({
  name: z.string().trim().min(2, 'Name the chain').max(80), active: z.boolean().default(true), priority: z.coerce.number().int().min(0).max(999).default(0),
  scope: z.object({
    leaveTypeIds: z.array(objectId).max(30).default([]), departmentIds: z.array(objectId).max(60).default([]),
    categories: z.array(z.enum(values(EMPLOYEE_CATEGORIES))).default([]), minDays: optNum(days(366)),
  }).default({}),
  steps: z.array(z.object({
    label: optionalText(60), approverType: z.enum(values(LEAVE_APPROVER_TYPES)),
    userIds: z.array(objectId).max(30).default([]), roleIds: z.array(objectId).max(20).default([]),
  })).min(1, 'Add a step').max(LEAVE_CHAIN_MAX_STEPS),
  skipSelfOrRepeat: z.boolean().default(true), escalateAfterHours: optNum(z.coerce.number().int().min(1).max(720)),
})
const calendarSchema = z.object({
  kind: z.enum(Object.keys(LEAVE_CALENDAR_KINDS)), name: z.string().trim().min(2, 'Name it').max(80), from: ymd, to: ymd,
  mode: z.enum(values(NO_LEAVE_MODES)).optional(), categories: z.array(z.enum(values(EMPLOYEE_CATEGORIES))).default([]), branchIds: z.array(objectId).max(50).default([]),
  source: z.object({ type: z.enum(['EXAM', 'EVENT', 'PTM']), id: objectId }).optional(), note: optionalText(300),
})
const listQ = (q) => z.object({
  status: z.enum([...Object.keys(LEAVE_STATUSES), 'UPCOMING']).optional(), box: z.enum(['mine', 'all']).optional(), employeeId: objectId.optional(), leaveTypeId: objectId.optional(),
  departmentId: objectId.optional(), from: ymd.optional(), to: ymd.optional(), search: z.string().max(80).optional(), ...paging,
}).parse(q)

router.get('/leave/types', requirePermission('hrms.leave.view', 'hrms.leave.apply_on_behalf'), async (req, res) => {
  res.json({ data: await listLeaveTypes() })
})
router.post('/leave/types', requirePermission('hrms.leave.edit'), async (req, res) => {
  res.status(201).json({ data: await saveLeaveType(null, leaveTypeSchema.parse(req.body), req) })
})
router.put('/leave/types/:id', requirePermission('hrms.leave.edit'), async (req, res) => {
  // the short name (code) stays as it was made: payroll and the ledger read it
  res.json({ data: await saveLeaveType(id(req), leaveTypeSchema.omit({ code: true }).parse(req.body), req) })
})
router.get('/leave', requirePermission('hrms.leave.view'), async (req, res) => {
  res.json({ data: await listLeaves(listQ(req.query), req.auth) })
})
router.get('/leave/summary', requirePermission('hrms.leave.view'), async (req, res) => {
  res.json({ data: await leaveSummary(req.auth) })
})
router.get('/leave/balances', requirePermission('hrms.leave.view'), async (req, res) => {
  const q = z.object({ search: z.string().max(80).optional(), departmentId: objectId.optional(), category: optionalText(20), ...paging }).parse(req.query)
  res.json({ data: await balanceBoard(q, req.auth) })
})
router.get('/leave/calendar', requirePermission('hrms.leave.view'), async (req, res) => {
  const q = z.object({ month: ym, departmentId: objectId.optional(), category: optionalText(20), search: z.string().max(80).optional() }).parse(req.query)
  res.json({ data: await teamCalendar(q, req.auth) })
})
router.post('/leave/comp-off', requirePermission('hrms.leave.edit'), async (req, res) => {
  const input = z.object({ employeeId: objectId, workedDate: ymd, days: z.union([z.literal(1), z.literal(0.5)]).default(1), note: optionalText(300) }).parse(req.body)
  res.json({ data: await creditCompOff(input, req.auth, req) })
})
router.post('/leave/preview', requirePermission('hrms.leave.apply_on_behalf'), async (req, res) => {
  res.json({ data: await previewFor(previewSchema.extend({ employeeId: objectId }).parse(req.body), req.auth, { self: false }) })
})
router.post('/leave', requirePermission('hrms.leave.apply_on_behalf'), async (req, res) => {
  const input = applySchema.extend({ employeeId: objectId, approveNow: z.boolean().default(false) }).parse(req.body)
  res.status(201).json({ data: await applyFor(input, req.auth, req) })
})

// setup: approval chains, no-leave days and vacations, the year end
router.get('/leave/chains', requirePermission('hrms.leave.view'), async (req, res) => {
  res.json({ data: await listLeaveApprovalRules() })
})
router.get('/leave/chains/options', requirePermission('hrms.leave.edit'), async (req, res) => {
  res.json({ data: await leaveApprovalOptions() })
})
router.post('/leave/chains', requirePermission('hrms.leave.edit'), async (req, res) => {
  res.status(201).json({ data: await saveLeaveApprovalRule(null, ruleSchema.parse(req.body), req.auth, req) })
})
router.put('/leave/chains/:id', requirePermission('hrms.leave.edit'), async (req, res) => {
  res.json({ data: await saveLeaveApprovalRule(id(req), ruleSchema.parse(req.body), req.auth, req) })
})
router.delete('/leave/chains/:id', requirePermission('hrms.leave.edit'), async (req, res) => {
  res.json({ data: await deleteLeaveApprovalRule(id(req), req) })
})
router.get('/leave/no-leave-days', requirePermission('hrms.leave.view'), async (req, res) => {
  const q = z.object({ from: ymd.optional(), to: ymd.optional(), kind: z.enum(Object.keys(LEAVE_CALENDAR_KINDS)).optional() }).parse(req.query)
  res.json({ data: await listCalendarDays(q) })
})
router.get('/leave/no-leave-days/suggestions', requirePermission('hrms.leave.edit'), async (req, res) => {
  res.json({ data: await calendarSuggestions(req.auth) })
})
router.post('/leave/no-leave-days', requirePermission('hrms.leave.edit'), async (req, res) => {
  res.status(201).json({ data: await saveCalendarDay(null, calendarSchema.parse(req.body), req.auth, req) })
})
router.put('/leave/no-leave-days/:id', requirePermission('hrms.leave.edit'), async (req, res) => {
  res.json({ data: await saveCalendarDay(id(req), calendarSchema.parse(req.body), req.auth, req) })
})
router.delete('/leave/no-leave-days/:id', requirePermission('hrms.leave.edit'), async (req, res) => {
  res.json({ data: await deleteCalendarDay(id(req), req) })
})
router.get('/leave/year-end', requirePermission('hrms.leave.view'), async (req, res) => {
  res.json({ data: await yearEndPreview(req.auth) })
})
router.post('/leave/year-end', requirePermission('hrms.leave.edit'), async (req, res) => {
  res.json({ data: await runYearEnd(req.auth, req) })
})

// one request (after the fixed /leave/… paths)
router.get('/leave/:id', requirePermission('hrms.leave.view'), async (req, res) => {
  res.json({ data: await getLeave(id(req), req.auth) })
})
router.post('/leave/:id/decide', requirePermission('hrms.leave.approve'), async (req, res) => {
  res.json({ data: await decideLeave(id(req), decideSchema.parse(req.body), req.auth, req) })
})
router.post('/leave/:id/cancel', requirePermission('hrms.leave.cancel'), async (req, res) => {
  const { reason } = z.object({ reason: optionalText(300) }).parse(req.body ?? {})
  res.json({ data: await cancelLeave(id(req), { reason }, req.auth, req) })
})

// ───────────────────────────────────────────────────────── holidays

const holidaySchema = z.object({ date: ymd, name: z.string().trim().min(2, 'Name the holiday').max(80), branchIds: z.array(objectId).max(50).default([]), optional: z.boolean().default(false), forStudents: z.boolean().default(true) })
router.get('/holidays', requirePermission('hrms.holidays.view', 'hrms.attendance.view', 'hrms.leave.view'), async (req, res) => {
  res.json({ data: await listHolidays(req.query) })
})
router.post('/holidays', requirePermission('hrms.holidays.create'), async (req, res) => {
  res.status(201).json({ data: await saveHoliday(null, holidaySchema.parse(req.body), req.auth, req) })
})
router.post('/holidays/bulk', requirePermission('hrms.holidays.create'), async (req, res) => {
  const { rows } = z.object({ rows: z.array(holidaySchema.pick({ date: true, name: true, optional: true, forStudents: true })).min(1).max(100) }).parse(req.body)
  res.json({ data: await addHolidays(rows, req.auth, req) })
})
router.put('/holidays/:id', requirePermission('hrms.holidays.edit'), async (req, res) => {
  res.json({ data: await saveHoliday(id(req), holidaySchema.parse(req.body), req.auth, req) })
})
router.delete('/holidays/:id', requirePermission('hrms.holidays.delete'), async (req, res) => {
  res.json({ data: await deleteHoliday(id(req), req) })
})

// ───────────────────────────────────────────────────────── recruitment

const requisitionSchema = z.object({
  title: z.string().trim().min(2, 'Name the post').max(120), departmentId: optId, branchId: optId,
  category: z.enum(values(EMPLOYEE_CATEGORIES)), employmentType: z.enum(values(EMPLOYMENT_TYPES)).default('PERMANENT'),
  subjects: z.array(z.string().trim().max(60)).max(10).optional(), count: z.coerce.number().int().min(1).max(200),
  description: optionalText(4000), salaryRange: z.object({ min: paise.optional(), max: paise.optional() }).optional(), targetDate: blank(ymd),
})
const candidateSchema = z.object({
  requisitionId: objectId, name: z.string().trim().min(2, 'Enter the name').max(120), mobile: blank(mobile), email: blank(email),
  gender: blank(z.enum(values(GENDERS))), qualifications: optionalText(300), experienceYears: z.coerce.number().min(0).max(60).optional().or(z.literal('').transform(() => undefined)),
  currentEmployer: optionalText(120), address: optionalText(300), expectedSalary: paise.optional().or(z.literal('').transform(() => undefined)), source: z.enum(CANDIDATE_SOURCES).default('OTHER'),
})

router.get('/requisitions', requirePermission('hrms.hiring.view'), async (req, res) => {
  const { status } = z.object({ status: z.enum(['ACTIVE', 'ALL', ...Object.keys(REQUISITION_STATUSES)]).optional() }).parse(req.query)
  res.json({ data: await listRequisitions({ status }) })
})
router.post('/requisitions', requirePermission('hrms.hiring.create'), async (req, res) => {
  res.status(201).json({ data: await saveRequisition(null, requisitionSchema.parse(req.body), req.auth, req) })
})
router.put('/requisitions/:id', requirePermission('hrms.hiring.edit'), async (req, res) => {
  res.json({ data: await saveRequisition(id(req), requisitionSchema.parse(req.body), req.auth, req) })
})
router.post('/requisitions/:id/status', requirePermission('hrms.hiring.edit'), async (req, res) => {
  const input = z.object({ status: z.enum(Object.keys(REQUISITION_STATUSES)), note: optionalText(300) }).parse(req.body)
  res.json({ data: await setRequisitionStatus(id(req), input, req.auth, req) })
})
router.get('/candidates', requirePermission('hrms.hiring.view'), async (req, res) => {
  const q = z.object({ requisitionId: objectId.optional(), stage: optionalText(20), search: optionalText(80), ...paging }).parse(req.query)
  res.json({ data: await listCandidates(q) })
})
router.post('/candidates', requirePermission('hrms.hiring.create'), async (req, res) => {
  res.status(201).json({ data: await saveCandidate(null, candidateSchema.parse(req.body), req.auth, req) })
})
router.get('/candidates/:id', requirePermission('hrms.hiring.view'), async (req, res) => {
  res.json({ data: await getCandidate(id(req)) })
})
router.put('/candidates/:id', requirePermission('hrms.hiring.edit'), async (req, res) => {
  res.json({ data: await saveCandidate(id(req), candidateSchema.omit({ requisitionId: true }).parse(req.body), req.auth, req) })
})
router.post('/candidates/:id/move', requirePermission('hrms.hiring.edit'), async (req, res) => {
  const input = z.object({
    stage: z.enum(Object.keys(CANDIDATE_STAGES)), note: optionalText(500),
    next: z.object({ date: ymd, time: blank(hhmm), panel: optionalText(200), note: optionalText(300) }).optional(),
  }).parse(req.body)
  res.json({ data: await moveCandidate(id(req), input, req.auth, req) })
})
router.post('/candidates/:id/evaluate', requirePermission('hrms.hiring.edit'), async (req, res) => {
  const input = z.object({ rating: z.coerce.number().int().min(1).max(5), note: optionalText(1000) }).parse(req.body)
  res.json({ data: await evaluateCandidate(id(req), input, req.auth, req) })
})
router.post('/candidates/:id/offer', requirePermission('hrms.hiring.edit'), async (req, res) => {
  const input = z.object({ salary: paise.optional(), joiningDate: ymd, designation: optionalText(80), note: optionalText(500) }).parse(req.body)
  res.json({ data: await offerCandidate(id(req), input, req.auth, req) })
})
router.post('/candidates/:id/hire', requirePermission('hrms.hiring.edit'), requirePermission(`${EMP}.create`), async (req, res) => {
  const input = z.object({ joiningDate: blank(ymd), designation: optionalText(80), employmentType: blank(z.enum(values(EMPLOYMENT_TYPES))), reportingManagerId: optId, employeeCode: optionalText(20) }).parse(req.body ?? {})
  res.json({ data: await hireCandidate(id(req), input, req.auth, req) })
})

// ───────────────────────────────────────────────────────── appraisal

const ratings = z.record(z.string(), z.coerce.number().int().min(1).max(5))
const managerReview = z.object({ ratings, comments: optionalText(3000), strengths: optionalText(2000), improve: optionalText(2000), goals: optionalText(2000) })
const cycleSchema = z.object({
  name: z.string().trim().min(2, 'Name the round').max(100), from: blank(ymd), to: blank(ymd), dueDate: blank(ymd),
  criteria: z.array(z.object({ key: optionalText(30), label: z.string().trim().min(2).max(120), weight: z.coerce.number().min(0).max(100).default(1) })).min(1).max(20).optional(),
  categories: z.array(z.enum(values(EMPLOYEE_CATEGORIES))).default([]), selfReview: z.boolean().default(true),
})
router.get('/appraisals/cycles', requirePermission('hrms.performance.view'), async (req, res) => {
  res.json({ data: await listCycles() })
})
router.post('/appraisals/cycles', requirePermission('hrms.performance.create'), async (req, res) => {
  res.status(201).json({ data: await saveCycle(null, cycleSchema.parse(req.body), req.auth, req) })
})
router.put('/appraisals/cycles/:id', requirePermission('hrms.performance.edit'), async (req, res) => {
  res.json({ data: await saveCycle(id(req), cycleSchema.parse(req.body), req.auth, req) })
})
router.post('/appraisals/cycles/:id/launch', requirePermission('hrms.performance.edit'), async (req, res) => {
  res.json({ data: await launchCycle(id(req), req.auth, req) })
})
router.post('/appraisals/cycles/:id/close', requirePermission('hrms.performance.edit'), async (req, res) => {
  res.json({ data: await closeCycle(id(req), req.auth, req) })
})
router.get('/appraisals/cycles/:id/reviews', requirePermission('hrms.performance.view'), async (req, res) => {
  res.json({ data: await cycleReviews(id(req), req.auth) })
})
router.put('/appraisals/:id/reviewer', requirePermission('hrms.performance.edit'), async (req, res) => {
  const { userId } = z.object({ userId: optId }).parse(req.body)
  res.json({ data: await setReviewer(id(req), userId, req.auth, req) })
})
router.post('/appraisals/:id/manager', requirePermission('hrms.performance.edit'), async (req, res) => {
  res.json({ data: await submitManager(id(req), managerReview.parse(req.body), req.auth, req) })
})

// ───────────────────────────────────────────────────────── my workspace (self-service)

router.get('/me', async (req, res) => {
  res.json({ data: await myRecord(req.auth) })
})
router.patch('/me', async (req, res) => {
  const input = z.object({ mobile: blank(mobile), address: addressSchema.optional(), emergencyContact: emergencySchema.optional(), bloodGroup: optionalText(4) }).parse(req.body)
  res.json({ data: await updateMyRecord(input, req.auth, req) })
})
router.get('/me/leave', async (req, res) => {
  res.json({ data: await myLeave(req.auth) })
})
router.post('/me/leave/preview', async (req, res) => {
  res.json({ data: await previewFor(previewSchema.parse(req.body), req.auth, { self: true }) })
})
router.post('/me/leave', async (req, res) => {
  res.status(201).json({ data: await applyMine(applySchema.parse(req.body), req.auth, req) })
})
router.post('/me/leave/:id/cancel', async (req, res) => {
  const { reason } = z.object({ reason: optionalText(300) }).parse(req.body ?? {})
  res.json({ data: await cancelLeave(id(req), { reason }, req.auth, req, { self: true }) })
})
router.get('/me/attendance', async (req, res) => {
  const { month } = z.object({ month: ym }).parse(req.query)
  res.json({ data: await myMonth(month, req.auth) })
})
// a reporting manager decides their team's leave here (HR uses /leave)
router.get('/me/approvals', async (req, res) => {
  res.json({ data: await waitingForMe(req.auth) })
})
router.get('/me/approvals/:id', async (req, res) => {
  res.json({ data: await getLeave(id(req), req.auth) })
})
router.post('/me/approvals/:id', async (req, res) => {
  res.json({ data: await decideLeave(id(req), decideSchema.parse(req.body), req.auth, req) })
})
router.get('/me/reviews', async (req, res) => {
  res.json({ data: await myReviews(req.auth) })
})
router.get('/me/reviews/:id', async (req, res) => {
  res.json({ data: await getReview(id(req), req.auth) })
})
router.post('/me/reviews/:id/self', async (req, res) => {
  const input = z.object({ ratings, comments: optionalText(3000) }).parse(req.body)
  res.json({ data: await submitSelf(id(req), input, req.auth, req) })
})
router.post('/me/reviews/:id/rate', async (req, res) => {
  res.json({ data: await submitManager(id(req), managerReview.parse(req.body), req.auth, req) })
})

export default router
