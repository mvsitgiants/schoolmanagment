// npm run i18n:progress — how much of the app is in Hindi, phase by phase (the order the translation is done in):
// for each phase and each screen group in it, how many texts are in Hindi out of all, and a bar.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const L = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/i18n/locales')
const PHASES = [
  ['1 · Teaching & daily use', ['dashboard', 'hub', 'homework', 'lms', 'exams', 'questionPapers', 'tests', 'timetable', 'attendance', 'fees', 'students', 'me', 'family', 'common', 'ui']],
  ['2 · Office & student services', ['admissions', 'academics', 'certificates', 'frontoffice', 'communication', 'comms', 'events', 'notifications', 'health', 'transport', 'library', 'hostel', 'canteen']],
  ['3 · Staff & money', ['hrms', 'hrmsLeave', 'payroll', 'finance', 'inventory']],
  ['4 · Settings & administration', ['admin', 'settings', 'integrations', 'superadmin', 'catalog', 'nav', 'errors', 'geo', 'registration', 'portal', 'website']],
  ['5 · Higher education & extras', ['programs', 'coe', 'placements', 'alumni', 'research', 'accreditation', 'surveys', 'analytics', 'reports', 'ai', 'scan']],
]
const isHindi = (v) => typeof v === 'string' && /[ऀ-ॿ]/.test(v)
// a text that is only placeholders, numbers or symbols needs no translation — it counts as done
const needsWords = (v) => /[A-Za-z]{2,}/.test(v.replace(/{{[^}]+}}/g, '').replace(/<[^>]+>/g, ''))

function count(ns) {
  const read = (lang) => { try { return JSON.parse(fs.readFileSync(`${L}/${lang}/${ns}.json`, 'utf8')) } catch { return {} } }
  let all = 0, done = 0
  const walk = (e, h) => { for (const [k, v] of Object.entries(e)) { if (v && typeof v === 'object') walk(v, h?.[k]); else if (typeof v === 'string') { all++; if (isHindi(h?.[k]) || !needsWords(v)) done++ } } }
  walk(read('en'), read('hi'))
  return { all, done }
}
const bar = (pct) => '█'.repeat(Math.round(pct / 5)).padEnd(20, '░')
const listed = new Set(PHASES.flatMap(([, ns]) => ns))
const extra = fs.readdirSync(`${L}/en`).map((f) => f.replace('.json', '')).filter((ns) => !listed.has(ns))
if (extra.length) PHASES.push(['Not in a phase yet', extra])

let ALL = 0, DONE = 0
for (const [name, list] of PHASES) {
  const rows = list.map((ns) => ({ ns, ...count(ns) }))
  const all = rows.reduce((n, r) => n + r.all, 0), done = rows.reduce((n, r) => n + r.done, 0)
  ALL += all; DONE += done
  const pct = all ? (done / all) * 100 : 100
  console.log(`\n${name.padEnd(34)} ${bar(pct)} ${pct.toFixed(0).padStart(3)}%  (${done} of ${all})`)
  if (process.argv.includes('--detail')) for (const r of rows) console.log(`   ${r.ns.padEnd(31)} ${r.all ? ((r.done / r.all) * 100).toFixed(0).padStart(3) : '100'}%  ${r.done}/${r.all}`)
}
console.log(`\n${'Whole app'.padEnd(34)} ${bar((DONE / ALL) * 100)} ${((DONE / ALL) * 100).toFixed(0).padStart(3)}%  (${DONE} of ${ALL})\n`)
