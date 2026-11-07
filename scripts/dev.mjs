#!/usr/bin/env node
// One command for local development:  npm run dev
//   1. MongoDB on :27018 — reuses one that is already running, else starts the embedded one (npm run dev:db)
//   2. demo data — `seed` adds whatever is missing (plans, role templates, demo institutions); safe every time
//   3. API on :4100 and the web app on :5190, both reloading on file changes
// Output is prefixed [db] [api] [web]. Anything already running on its port is reused.
// Ctrl+C stops everything this script started.
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DB_PORT = Number(process.env.MONGO_PORT) || 27018
const COLORS = { db: 35, seed: 33, api: 36, web: 32 }
const children = []

const tag = (name) => `\x1b[${COLORS[name]}m[${name}]\x1b[0m`
function pipe(name, stream) {
  let rest = ''
  stream.on('data', (chunk) => {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop()
    for (const line of lines) if (line.trim()) process.stdout.write(`${tag(name)} ${line}\n`)
  })
}

function run(name, cmd, args, { keep = true } = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '1' } })
  pipe(name, child.stdout)
  pipe(name, child.stderr)
  if (keep) children.push(child)
  return child
}

const portOpenOn = (port, host) => new Promise((resolve) => {
  const s = net.connect({ port, host })
  s.once('connect', () => { s.end(); resolve(true) })
  s.once('error', () => resolve(false))
})
// Vite listens on ::1 (IPv6 localhost) on macOS, MongoDB and the API on 127.0.0.1 — check both.
const portOpen = async (port) => (await portOpenOn(port, '127.0.0.1')) || portOpenOn(port, '::1')

async function waitForPort(port, seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await portOpen(port)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

function stopAll(code = 0) {
  for (const c of children) if (!c.killed) c.kill('SIGINT')
  setTimeout(() => process.exit(code), 1500).unref()
}
process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))

// 1 — database
if (await portOpen(DB_PORT)) {
  console.log(`${tag('db')} MongoDB already running on :${DB_PORT} — using it`)
} else {
  console.log(`${tag('db')} starting embedded MongoDB on :${DB_PORT} (first start downloads it, ~1 minute)…`)
  run('db', 'node', ['backend/src/dev/devdb.js'])
  if (!await waitForPort(DB_PORT, 180)) {
    console.error(`${tag('db')} MongoDB did not start. See the [db] lines above.`)
    stopAll(1)
  }
}

// 2 — demo data (adds only what is missing; use `npm run seed -- --reset` to start over)
const seed = run('seed', 'npm', ['run', 'seed', '--silent'], { keep: false })
const seeded = await new Promise((resolve) => seed.on('exit', (code) => resolve(code === 0)))
if (!seeded) console.error(`${tag('seed')} seeding failed — the app still starts; see the lines above.`)

// 3 — API and web app (one already running in another terminal is reused, not started twice)
for (const [name, port, workspace] of [['api', 4100, '@schoolgiant/backend'], ['web', 5190, '@schoolgiant/frontend']]) {
  if (await portOpen(port)) console.log(`${tag(name)} already running on :${port} — using it`)
  else run(name, 'npm', ['run', 'dev', '--silent', '--workspace', workspace])
}
console.log(`\n  App:  http://localhost:5190     API: http://localhost:4100     Ctrl+C to stop\n`)
