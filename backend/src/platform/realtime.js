import { randomUUID } from 'node:crypto'
import { Server } from 'socket.io'
import { ZodError } from 'zod'
import { config, isAllowedOrigin } from '../config.js'
import { looksLikeApiKey } from '../services/apiKeys.js'
import { can, loadAccess } from './access.js'
import { ACCESS_COOKIE, verifyAccess } from './auth/tokens.js'
import { runWithContext } from './context.js'
import { AppError, zodDetails } from './errors.js'
import { logger } from './logger.js'
import { liveSession, onSessionsForgotten } from './middleware.js'

// Realtime layer (socket.io) for signed-in institution staff: live pushes (the bell, calls &
// codes, chat next) and small client → server actions.
//
// ── Rooms are always namespaced by tenant, built here and never by a client:
//      t:<tenantId>            everyone of an institution (presence)
//      t:<tenantId>:u:<userId> one person's devices (every tab, phone and desktop)
//      t:<tenantId>:<name>     anything else, e.g. `paging:all`, `chat:<conversationId>`
//    A socket can only ever be put in rooms of its own tenant.
//
// ── Event names are `<domain>:<verb>`, lower case: `notification:new`, `presence:changed`,
//    `page:ring`, `page:update`, `page:stop`; chat would use `chat:message`, `chat:typing`…
//    Server → client pushes use emitToUser / emitToUsers / emitToRoom. Client → server
//    actions are registered with onSocket() and always answer through the ack callback with
//    `{ ok: true, data }` or `{ ok: false, error, code, details }`.
//
// ── Auth: the same access cookie (hx_at) and session row as the REST API. Parent-app
//    tokens, API keys and platform-owner (superadmin) sessions are refused. Every reconnect
//    is a fresh handshake, so it is checked again; open sockets are re-checked every minute
//    and at once when sessions are revoked (sign-out, "sign out of all devices", user
//    deactivated). Handlers run inside the tenant context (runWithContext), so the tenant
//    plugin scopes every query exactly as in an HTTP request, and `ctx.auth` is the same
//    access object as `req.auth` — use can(ctx.auth, key) or the `permission` option.
//
// ── Scaling: presence and rooms are held in this process. Running more than one API
//    instance needs the socket.io Redis adapter (@socket.io/redis-adapter) so emits reach
//    sockets on the other instances, sticky sessions at the load balancer (the polling
//    transport), and presence moved to Redis. Not added yet: one instance today.

let io = null
const handlers = new Map() // event → { fn, permission: [keys] | null }
const presence = new Map() // tenantId → Map(userId → open socket count)

const RESERVED = new Set(['connect', 'connect_error', 'disconnect', 'disconnecting', 'error', 'newListener', 'removeListener'])
const RECHECK_MS = 60_000

/** Room id for a name inside a tenant. */
export const tenantRoom = (tenantId, name) => (name ? `t:${tenantId}:${name}` : `t:${tenantId}`)
export const userRoom = (tenantId, userId) => `t:${tenantId}:u:${userId}`

// Room names a module may use: `paging:all`, `chat:665f…`. Never `u:` (personal rooms are
// only joined by the server on connect).
const ROOM_NAME = /^(?!u:)[a-z][a-z0-9_-]{0,40}(:[A-Za-z0-9_-]{1,64}){0,3}$/

function assertRoomName(name) {
  if (typeof name !== 'string' || !ROOM_NAME.test(name)) throw new Error(`realtime: bad room name "${name}"`)
}

// ───────────────────────────────────────────────────────── emitting (server → client)

/** Push an event to every device of one user. Never throws; a no-op before initRealtime. */
export function emitToUser(tenantId, userId, event, payload) {
  if (!io || !tenantId || !userId) return
  try { io.to(userRoom(tenantId, userId)).emit(event, payload) } catch (err) { logger.warn({ err, event }, 'realtime emit failed') }
}

/** Push one event to several users (each socket gets it once). */
export function emitToUsers(tenantId, userIds, event, payload) {
  if (!io || !tenantId) return
  const rooms = [...new Set((userIds ?? []).map(String))].filter(Boolean).map((u) => userRoom(tenantId, u))
  if (!rooms.length) return
  try { io.to(rooms).emit(event, payload) } catch (err) { logger.warn({ err, event }, 'realtime emit failed') }
}

/**
 * Push to a named room of a tenant (`paging:all`, `chat:<id>`), or to several rooms and
 * users at once without duplicates: emitToRoom(t, ['paging:all', { user: id }], …).
 */
export function emitToRoom(tenantId, room, event, payload) {
  if (!io || !tenantId) return
  const rooms = [].concat(room).filter(Boolean).map((r) => {
    if (typeof r === 'object') return userRoom(tenantId, r.user)
    assertRoomName(r)
    return tenantRoom(tenantId, r)
  })
  if (!rooms.length) return
  try { io.to(rooms).emit(event, payload) } catch (err) { logger.warn({ err, event }, 'realtime emit failed') }
}

/** Put every open device of a user into tenant rooms (e.g. the chats they belong to). */
export function joinUserRooms(tenantId, userId, rooms) {
  if (!io || !tenantId || !userId) return
  const names = [].concat(rooms).filter(Boolean)
  names.forEach(assertRoomName)
  io.in(userRoom(tenantId, userId)).socketsJoin(names.map((n) => tenantRoom(tenantId, n)))
}

/** Take every open device of a user out of tenant rooms (left a chat, lost access). */
export function leaveUserRooms(tenantId, userId, rooms) {
  if (!io || !tenantId || !userId) return
  const names = [].concat(rooms).filter(Boolean)
  names.forEach(assertRoomName)
  io.in(userRoom(tenantId, userId)).socketsLeave(names.map((n) => tenantRoom(tenantId, n)))
}

/** Join / leave a room of the socket's own tenant from inside a handler. */
export function joinRoom(socket, name) {
  assertRoomName(name)
  socket.join(tenantRoom(socket.data.tenantId, name))
}
export function leaveRoom(socket, name) {
  assertRoomName(name)
  socket.leave(tenantRoom(socket.data.tenantId, name))
}

// ───────────────────────────────────────────────────────── handlers (client → server)

/**
 * Register a client → server event. Works before or after initRealtime (modules register
 * at start-up, like event listeners).
 *
 *   onSocket('page:respond', async (payload, ctx) => { … return data }, { permission: 'comms.calls.view' })
 *
 * `ctx` = { socket, auth, tenantId, userId, userName }. `permission` (a key or a list,
 * any-of) is checked against the socket's live access on every call. Throw AppError /
 * ZodError as in a route; the client's ack gets `{ ok: false, error, code, details }`.
 */
export function onSocket(event, fn, { permission } = {}) {
  if (RESERVED.has(event)) throw new Error(`realtime: "${event}" is reserved`)
  if (handlers.has(event)) throw new Error(`realtime: "${event}" already has a handler`)
  handlers.set(event, { fn, permission: permission ? [].concat(permission) : null })
  return () => handlers.delete(event)
}

function errorReply(err) {
  if (err instanceof ZodError) {
    const details = zodDetails(err)
    const first = Object.entries(details.fields)[0]
    return { ok: false, error: first ? `${first[0]}: ${first[1]}` : 'Invalid input.', code: 'VALIDATION', details }
  }
  if (err instanceof AppError) return { ok: false, error: err.message, code: err.code, details: err.details }
  logger.error({ err }, 'socket handler failed')
  return { ok: false, error: 'Something went wrong on our side. Please try again.', code: 'INTERNAL' }
}

async function dispatch(socket, event, args) {
  const ack = typeof args[args.length - 1] === 'function' ? args.pop() : null
  const reply = (body) => { if (ack) { try { ack(body) } catch { /* client gone */ } } }
  const h = handlers.get(event)
  if (!h) return reply({ ok: false, error: `Unknown event ${event}`, code: 'NO_ROUTE' })
  const d = socket.data
  if (h.permission && !h.permission.some((k) => can(d.auth, k))) {
    return reply({ ok: false, error: `Your role doesn't allow this. It needs: ${h.permission.join(' or ')}.`, code: 'FORBIDDEN' })
  }
  const ctx = { requestId: randomUUID(), tenantId: d.tenantId, userId: d.userId, userName: d.auth?.user?.name, superadmin: false, system: false }
  try {
    const data = await runWithContext(ctx, () => h.fn(args[0] ?? {}, { socket, auth: d.auth, tenantId: d.tenantId, userId: d.userId, userName: ctx.userName }))
    reply({ ok: true, data: data ?? null })
  } catch (err) {
    reply(errorReply(err))
  }
}

// ───────────────────────────────────────────────────────── presence

/** Is the user connected on any device right now (this instance)? */
export function isOnline(tenantId, userId) {
  return (presence.get(String(tenantId))?.get(String(userId)) ?? 0) > 0
}

/** Ids of the users of a tenant connected right now. */
export function onlineUserIds(tenantId) {
  return [...(presence.get(String(tenantId))?.keys() ?? [])]
}

/** The open sockets of one user on this instance (e.g. to read what screen each shows). */
export function userSockets(tenantId, userId) {
  if (!io || !tenantId || !userId) return []
  const ids = io.of('/').adapter.rooms.get(userRoom(tenantId, userId))
  if (!ids) return []
  return [...ids].map((id) => io.of('/').sockets.get(id)).filter(Boolean)
}

function presenceUp(tenantId, userId) {
  if (!presence.has(tenantId)) presence.set(tenantId, new Map())
  const m = presence.get(tenantId)
  const n = (m.get(userId) ?? 0) + 1
  m.set(userId, n)
  if (n === 1) io.to(tenantRoom(tenantId)).emit('presence:changed', { userId, online: true, at: new Date().toISOString() })
}

function presenceDown(tenantId, userId) {
  const m = presence.get(tenantId)
  if (!m) return
  const n = (m.get(userId) ?? 1) - 1
  if (n > 0) { m.set(userId, n); return }
  m.delete(userId)
  if (!m.size) presence.delete(tenantId)
  io.to(tenantRoom(tenantId)).emit('presence:changed', { userId, online: false, at: new Date().toISOString() })
}

onSocket('presence:list', async (_payload, ctx) => ({ online: onlineUserIds(ctx.tenantId) }))

// ───────────────────────────────────────────────────────── auth

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()) } catch { return null }
    }
  }
  return null
}

class SocketAuthError extends Error {
  constructor(message = 'UNAUTHORIZED', reason) {
    super(message)
    this.data = { reason }
  }
}

/** Staff access for a socket from its access token, or throws SocketAuthError. */
async function authenticateSocket(token) {
  if (!token || looksLikeApiKey(token)) throw new SocketAuthError('UNAUTHORIZED', 'Sign in to an institution workspace.')
  const claims = verifyAccess(token)
  if (!claims || !claims.sid || !claims.sub) throw new SocketAuthError('UNAUTHORIZED', 'Your sign-in has expired.')
  if (claims.k) throw new SocketAuthError('FORBIDDEN', 'Live updates are for institution staff.') // parent-app style token
  if (claims.sa || !claims.tid) throw new SocketAuthError('FORBIDDEN', 'Live updates are for institution staff.')
  const sessionOk = await sessionIsLive(claims.sid)
  if (!sessionOk) throw new SocketAuthError('UNAUTHORIZED', 'Your session has ended. Please sign in again.')
  const access = await loadAccess(claims.tid, claims.sub)
  if (!access || !access.user?.active) throw new SocketAuthError('UNAUTHORIZED', 'This account is not active.')
  return { tenantId: String(claims.tid), userId: String(claims.sub), sessionId: String(claims.sid), auth: { ...access, tenantId: String(claims.tid), userId: String(claims.sub), sessionId: String(claims.sid) } }
}

async function sessionIsLive(sid) {
  const session = await liveSession(sid)
  return !!session && !session.revokedAt && new Date(session.expiresAt) >= new Date()
}

/** Re-check an open socket: session still live, user still active; refresh its access. */
async function recheck(socket) {
  const d = socket.data
  try {
    if (!(await sessionIsLive(d.sessionId))) return socket.disconnect(true)
    const access = await loadAccess(d.tenantId, d.userId)
    if (!access || !access.user?.active) return socket.disconnect(true)
    d.auth = { ...access, tenantId: d.tenantId, userId: d.userId, sessionId: d.sessionId }
  } catch (err) {
    logger.warn({ err }, 'socket re-check failed')
  }
  return undefined
}

// ───────────────────────────────────────────────────────── start-up

const connectHooks = new Set()
/** Run `fn(socket, ctx)` for every new staff connection (inside its tenant context) — e.g. join chat rooms. */
export function onConnect(fn) {
  connectHooks.add(fn)
  return () => connectHooks.delete(fn)
}

/**
 * Attach socket.io to the HTTP server (`app.listen` returns it). Behind a reverse proxy,
 * forward `/socket.io/` with the WebSocket upgrade headers, next to `/api/`.
 */
export function initRealtime(server) {
  if (io) return io
  io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    cors: {
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin))
      },
      credentials: true,
    },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 256 * 1024,
  })

  io.use(async (socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers?.cookie, ACCESS_COOKIE) || (typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null)
      Object.assign(socket.data, await authenticateSocket(token))
      next()
    } catch (err) {
      if (!(err instanceof SocketAuthError)) logger.warn({ err }, 'socket handshake failed')
      next(err instanceof SocketAuthError ? err : new SocketAuthError('UNAUTHORIZED'))
    }
  })

  io.on('connection', (socket) => {
    const { tenantId, userId } = socket.data
    socket.join([tenantRoom(tenantId), userRoom(tenantId, userId)])
    presenceUp(tenantId, userId)
    socket.onAny((event, ...args) => {
      if (RESERVED.has(event)) return
      dispatch(socket, event, args)
    })
    socket.on('disconnect', () => presenceDown(tenantId, userId))
    const ctx = { requestId: randomUUID(), tenantId, userId, userName: socket.data.auth?.user?.name, superadmin: false, system: false }
    for (const fn of connectHooks) {
      runWithContext(ctx, () => fn(socket, { auth: socket.data.auth, tenantId, userId })).catch((err) => logger.warn({ err }, 'socket connect hook failed'))
    }
  })

  // Sessions revoked → re-check the sockets on them now; on a full clear, every socket.
  onSessionsForgotten((sids) => {
    const only = sids ? new Set(sids) : null
    for (const socket of io.of('/').sockets.values()) {
      if (!only || only.has(socket.data.sessionId)) recheck(socket)
    }
  })
  const timer = setInterval(() => {
    for (const socket of io.of('/').sockets.values()) recheck(socket)
  }, RECHECK_MS)
  timer.unref?.()

  logger.info('Realtime (socket.io) ready')
  return io
}

/** Shutdown: tell connected browsers to reconnect elsewhere and stop accepting sockets. */
export function closeRealtime() {
  return new Promise((done) => { if (!io) return done(); io.close(() => done()) })
}
