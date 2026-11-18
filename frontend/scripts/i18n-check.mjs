// npm run i18n:check -- --lang kn [namespace …]
// What still needs work in one language's translation files (all of them, or the namespaces named): texts still in
// English, {{placeholders}} or <tags> that differ from English, letters of another Indian script, keys missing.
// Plain codes and units (UPI, PDF, OTP, cm, kg, P{{no}}) don't need translating and aren't flagged.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const L = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/i18n/locales')
const SCRIPTS = { hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, pa: /[਀-੿]/, gu: /[઀-૿]/, or: /[଀-୿]/, ta: /[஀-௿]/, te: /[ఀ-౿]/, kn: /[ಀ-೿]/, ml: /[ഀ-ൿ]/, ur: /[؀-ۿ]/ }
const args = process.argv.slice(2)
const lang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null
if (!SCRIPTS[lang] || lang === 'en') { console.error('Name the language: npm run i18n:check -- --lang kn [namespace …]'); process.exit(1) }
const OWN = SCRIPTS[lang]
const OTHERS = Object.entries(SCRIPTS).filter(([k, re]) => k !== lang && String(re) !== String(OWN)).map(([, re]) => re)
const SETTINGS_VALUES = new Set(['yearsBefore2000']) // printWords values that are settings, not text
// words that need translating: drop placeholders, tags, codes in capitals (UPI, PDF) and common units first
// brand and product names stay as they are written (WhatsApp, Razorpay, Google Meet …)
const BRANDS = /\b(SchoolGiant|WhatsApp|Razorpay|PayU|Cashfree|Paytm|PhonePe|Zoom|Google( Meet| Drive| Docs| Classroom)?|Microsoft( Teams)?|Teams|Jitsi|YouTube|Facebook|Instagram|LinkedIn|Twitter|X|Scopus|Web of Science|PubMed|Gmail|Excel|Word|PowerPoint|Tally|MSG91|Gupshup|Twilio|Android|iPhone|iOS|Chrome|Safari)\b/g
const needsWords = (v) => /[A-Za-z]{2,}/.test(v.replace(/{{[^}]+}}/g, '').replace(/<[^>]+>/g, '').replace(BRANDS, '').replace(/\b[A-Z][A-Z0-9]{1,7}s?\b/g, '').replace(/\b(cm|kg|mm|km|MB|GB|KB)\b/g, '').replace(/\S+@\S+|https?:\/\/\S+/g, ''))
const ph = (s) => (s.match(/{{\s*[\w.]+\s*}}/g) ?? []).map((x) => x.replace(/\s/g, '')).sort().join(',')
const tags = (s) => (s.match(/<\/?[a-z]+\s*\/?>/gi) ?? []).sort().join(',')

const names = args.filter((a, i) => a !== '--lang' && args[i - 1] !== '--lang')
const list = names.length ? names : fs.readdirSync(path.join(L, 'en')).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
let bad = 0
for (const ns of list) {
  const en = JSON.parse(fs.readFileSync(path.join(L, 'en', `${ns}.json`), 'utf8'))
  const file = path.join(L, lang, `${ns}.json`)
  const own = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  const issues = []
  const walk = (e, k, p) => {
    if (typeof e === 'string') {
      if (SETTINGS_VALUES.has(p)) return
      if (typeof k !== 'string') return issues.push(`${p}: missing`)
      // still English: English words remain and none of the language's letters (just {{placeholders}} is fine — Hindi has no "of")
      if (needsWords(e) && needsWords(k) && !OWN.test(k)) issues.push(`${p}: still English`)
      if (ph(e) !== ph(k)) issues.push(`${p}: placeholders ${ph(e)} ≠ ${ph(k)}`)
      if (tags(e) !== tags(k)) issues.push(`${p}: tags ${tags(e)} ≠ ${tags(k)}`)
      if (OTHERS.some((re) => re.test(k))) issues.push(`${p}: letters of another script`)
      return
    }
    if (Array.isArray(e)) return e.forEach((x, i) => walk(x, k?.[i], `${p}[${i}]`))
    if (e && typeof e === 'object') for (const key of Object.keys(e)) walk(e[key], k?.[key], p ? `${p}.${key}` : key)
  }
  walk(en, own, '')
  bad += issues.length
  if (names.length || issues.length) console.log(`${issues.length ? '✗' : '✓'} ${ns}: ${issues.length} to fix`)
  for (const i of issues.slice(0, names.length ? 60 : 3)) console.log('   ' + i)
}
console.log(bad ? `\n${bad} to fix in ${lang}` : `\n✓ ${lang}: nothing to fix`)
process.exit(bad ? 1 : 0)
