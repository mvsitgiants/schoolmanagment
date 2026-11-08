import { Router } from 'express'
import { AUDIENCES, BOOKING_STATUS, EVENT_KINDS, PTM_MODES, PTM_STATUS, REPLY_ANSWERS, REPLY_KINDS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import { calendar, calendarIcs, deleteEvent, eventReplies, exportReplies, getEvent, listEvents, publishEvent, saveEvent, staffReply, unpublishEvent } from '../services/events.js'
import { deleteAlbum, getAlbum, listAlbums, saveAlbum } from '../services/eventsGallery.js'
import { classTeacherHosts, deleteSession, exportSession, getSession, listSessions, myMeetings, openBooking, saveSession, setSessionStatus, staffBook, updateBooking } from '../services/eventsPtm.js'

// Events & calendar: /api/v1/events — the calendar and its events, parent–teacher meetings, the photo gallery.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('events'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
const blank = (s) => s.optional().or(z.literal('').transform(() => undefined))
const id = (req) => objectId.parse(req.params.id)
const ids = z.array(objectId).max(100).default([])
const csv = (res, name, body) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(`﻿${body}`)
}
const audience = { audience: z.enum(AUDIENCES.map((a) => a.value)).default('EVERYONE'), classIds: ids, sectionIds: ids, branchIds: ids }

const CAL = 'events.calendar'
const PTM = 'events.ptm'
const GAL = 'events.gallery'

// ── calendar
const range = z.object({ from: ymd, to: ymd }).refine((r) => r.from <= r.to, 'The range ends before it starts')
router.get('/calendar', requirePermission(`${CAL}.view`), async (req, res) => { res.json({ data: await calendar(range.parse(req.query), req.auth) }) })
router.get('/calendar.ics', requirePermission(`${CAL}.view`), async (req, res) => {
  const body = await calendarIcs(range.parse(req.query), req.auth)
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="school-calendar.ics"')
  res.send(body)
})

const eventBody = z.object({
  title: z.string().trim().min(2, 'Name the event').max(200), description: optionalText(5000), kind: z.enum(EVENT_KINDS.map((k) => k.value)).default('EVENT'),
  startDate: ymd, endDate: blank(ymd), startTime: blank(hhmm), endTime: blank(hhmm), venue: optionalText(200), ...audience,
  reply: z.object({ kind: z.enum(REPLY_KINDS.map((r) => r.value)).default('NONE'), question: optionalText(300), by: blank(ymd) }).default({ kind: 'NONE' }),
  remind: z.boolean().default(false),
})
router.get('/events', requirePermission(`${CAL}.view`), async (req, res) => {
  const q = z.object({ when: z.enum(['UPCOMING', 'PAST', 'DRAFTS', 'ALL']).default('UPCOMING'), search: z.string().max(80).optional(), kind: z.enum(EVENT_KINDS.map((k) => k.value)).optional() }).parse(req.query)
  res.json({ data: await listEvents(q) })
})
router.get('/events/:id', requirePermission(`${CAL}.view`), async (req, res) => { res.json({ data: await getEvent(id(req)) }) })
router.post('/events', requirePermission(`${CAL}.create`), async (req, res) => { res.status(201).json({ data: await saveEvent(null, eventBody.parse(req.body), req.auth, req) }) })
router.patch('/events/:id', requirePermission(`${CAL}.edit`), async (req, res) => { res.json({ data: await saveEvent(id(req), eventBody.parse(req.body), req.auth, req) }) })
router.delete('/events/:id', requirePermission(`${CAL}.delete`), async (req, res) => { res.json({ data: await deleteEvent(id(req), req.auth, req) }) })
router.post('/events/:id/publish', requirePermission(`${CAL}.create`, `${CAL}.edit`), async (req, res) => {
  res.json({ data: await publishEvent(id(req), z.object({ notify: z.boolean().default(false) }).parse(req.body ?? {}), req.auth, req) })
})
router.post('/events/:id/unpublish', requirePermission(`${CAL}.edit`), async (req, res) => { res.json({ data: await unpublishEvent(id(req), req.auth, req) }) })
router.get('/events/:id/replies', requirePermission(`${CAL}.view`), async (req, res) => {
  res.json({ data: await eventReplies(id(req), z.object({ answer: z.enum([...Object.keys(REPLY_ANSWERS), 'WAITING']).optional() }).parse(req.query)) })
})
router.get('/events/:id/replies/export', requirePermission(`${CAL}.view`), async (req, res) => { csv(res, 'event-replies.csv', await exportReplies(id(req))) })
router.put('/events/:id/replies', requirePermission(`${CAL}.edit`), async (req, res) => {
  const body = z.object({ studentId: objectId, answer: z.enum(Object.keys(REPLY_ANSWERS)).nullable(), note: optionalText(300) }).parse(req.body)
  res.json({ data: await staffReply(id(req), body, req.auth, req) })
})

// ── parent–teacher meetings
const hostBody = z.object({
  id: z.string().optional(), userId: objectId.optional().nullable().or(z.literal('').transform(() => null)), name: z.string().trim().min(2, 'Name the teacher').max(120),
  role: optionalText(160), room: optionalText(200), sectionIds: ids, away: z.array(hhmm).max(200).default([]),
})
const sessionBody = z.object({
  title: z.string().trim().min(2, 'Name the meeting').max(160), date: ymd, startTime: hhmm, endTime: hhmm,
  slotMinutes: z.coerce.number().int().min(3).max(60).default(10), gapMinutes: z.coerce.number().int().min(0).max(30).default(0),
  mode: z.enum(PTM_MODES.map((m) => m.value)).default('IN_PERSON'), classIds: ids, sectionIds: ids, hosts: z.array(hostBody).max(150).default([]),
  bookingCloses: blank(ymd), instructions: optionalText(2000),
})
router.get('/ptm', requirePermission(`${PTM}.view`), async (req, res) => { res.json({ data: await listSessions(z.object({ when: z.enum(['UPCOMING', 'PAST']).default('UPCOMING') }).parse(req.query)) }) })
router.get('/ptm/mine', requirePermission(`${PTM}.view`), async (req, res) => { res.json({ data: await myMeetings(req.auth) }) })
router.get('/ptm/class-teachers', requirePermission(`${PTM}.create`, `${PTM}.edit`), async (req, res) => {
  const list = (v) => (v ? String(v).split(',').filter(Boolean) : [])
  const q = z.object({ classIds: z.array(objectId), sectionIds: z.array(objectId) }).parse({ classIds: list(req.query.classIds), sectionIds: list(req.query.sectionIds) })
  res.json({ data: await classTeacherHosts(q) })
})
router.get('/ptm/:id', requirePermission(`${PTM}.view`), async (req, res) => { res.json({ data: await getSession(id(req)) }) })
router.get('/ptm/:id/export', requirePermission(`${PTM}.view`), async (req, res) => { csv(res, 'parent-teacher-meeting.csv', await exportSession(id(req))) })
router.post('/ptm', requirePermission(`${PTM}.create`), async (req, res) => { res.status(201).json({ data: await saveSession(null, sessionBody.parse(req.body), req.auth, req) }) })
router.patch('/ptm/:id', requirePermission(`${PTM}.edit`), async (req, res) => { res.json({ data: await saveSession(id(req), sessionBody.parse(req.body), req.auth, req) }) })
router.delete('/ptm/:id', requirePermission(`${PTM}.edit`), async (req, res) => { res.json({ data: await deleteSession(id(req), req.auth, req) }) })
router.post('/ptm/:id/open', requirePermission(`${PTM}.edit`, `${PTM}.create`), async (req, res) => {
  res.json({ data: await openBooking(id(req), z.object({ notify: z.boolean().default(true) }).parse(req.body ?? {}), req.auth, req) })
})
router.post('/ptm/:id/status', requirePermission(`${PTM}.edit`), async (req, res) => {
  res.json({ data: await setSessionStatus(id(req), z.object({ status: z.enum(Object.keys(PTM_STATUS)) }).parse(req.body).status, req.auth, req) })
})
router.post('/ptm/:id/bookings', requirePermission(`${PTM}.edit`, `${PTM}.create`), async (req, res) => {
  res.status(201).json({ data: await staffBook(id(req), z.object({ hostId: objectId, time: hhmm, studentId: objectId }).parse(req.body), req.auth, req) })
})
// the teacher marks their own meetings (checked in the service); others need events.ptm.edit
router.patch('/ptm/bookings/:id', requirePermission(`${PTM}.view`), async (req, res) => {
  const body = z.object({ status: z.enum(Object.keys(BOOKING_STATUS)).optional(), remarks: z.string().max(2000).optional() }).parse(req.body)
  res.json({ data: await updateBooking(id(req), body, req.auth, req) })
})

// ── gallery
const albumBody = z.object({
  title: z.string().trim().min(2, 'Name the album').max(160), date: blank(ymd), description: optionalText(2000), eventId: objectId.optional().nullable().or(z.literal('').transform(() => null)),
  ...audience, published: z.boolean().default(false), coverFileId: objectId.optional().nullable().or(z.literal('').transform(() => null)),
})
router.get('/albums', requirePermission(`${GAL}.view`), async (req, res) => { res.json({ data: await listAlbums() }) })
router.get('/albums/:id', requirePermission(`${GAL}.view`), async (req, res) => { res.json({ data: await getAlbum(id(req)) }) })
router.post('/albums', requirePermission(`${GAL}.create`), async (req, res) => { res.status(201).json({ data: await saveAlbum(null, albumBody.parse(req.body), req.auth, req) }) })
router.patch('/albums/:id', requirePermission(`${GAL}.create`), async (req, res) => { res.json({ data: await saveAlbum(id(req), albumBody.parse(req.body), req.auth, req) }) })
router.delete('/albums/:id', requirePermission(`${GAL}.delete`), async (req, res) => { res.json({ data: await deleteAlbum(id(req), req.auth, req) }) })

export default router
