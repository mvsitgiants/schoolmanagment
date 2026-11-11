#!/usr/bin/env node
/**
 * Guardrail for src/pages — enforces PAGE_GUIDE.md.
 *
 *   node scripts/lint-pages.mjs            # fail on any NEW violation vs the baseline
 *   node scripts/lint-pages.mjs --update   # accept current state as the new baseline
 *   node scripts/lint-pages.mjs --all      # list every violation, ignore the baseline
 *
 * The baseline (scripts/lint-pages-baseline.json) is the agreed pre-existing
 * debt. New code may not add to it; the baseline should only ever shrink.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PAGES = join(ROOT, 'src', 'pages')
const BASELINE = join(ROOT, 'scripts', 'lint-pages-baseline.json')

const RULES = [
  { id: 'no-window-confirm', re: /\bwindow\.(confirm|alert|prompt)\s*\(/, msg: 'use useConfirm() from components/system' },
  { id: 'no-console', re: /\bconsole\.(log|error|warn|debug)\s*\(/, msg: 'use showError()/showSuccess()' },
  // Only flag hex inside Tailwind arbitrary-value utilities — a token belongs there.
  // Standalone hex (chart palettes, SVG fill/stroke, style objects) is legitimate.
  { id: 'no-raw-hex', re: /(?:bg|text|border|ring|from|to|via|fill|stroke|shadow|divide|outline|decoration|accent|caret|placeholder)-\[#[0-9a-fA-F]{3,8}\]/, msg: 'use design tokens instead of bg-[#…]/text-[#…]' },
  { id: 'no-locale-date', re: /\.toLocale(?:Date|Time)?String\s*\(/, msg: 'use useFormat().date / .dateTime / .time' },
  { id: 'no-ext-images', re: /(pravatar|unsplash\.com|placehold\.(co|it)|dicebear|picsum\.photos)/, msg: 'inline/local assets only' },
  { id: 'no-raw-select', re: /<select(\s|>)/, msg: 'use <Select> from components/system' },
  { id: 'no-native-date', re: /type="date"/, msg: 'use <DateInput> from components/system' },
  { id: 'no-raw-table', re: /<table(\s|>)/, msg: 'use <DataTable> from components/system' },
  // Every module overview used to hand-roll its own "Jump to" strip, each with a different
  // grid column count, so the tiles came out a different size on every module.
  { id: 'no-raw-quicklinks', re: /\{\s*QUICK_LINKS\.map\s*\(/, msg: 'use <QuickLinks links={QUICK_LINKS} /> from components/system' },
]

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.jsx') || p.endsWith('.js') ? [p] : []
})

const findings = []
for (const file of walk(PAGES)) {
  const rel = relative(ROOT, file)
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\/?\*)/.test(line)) return // skip comment lines (//, /*, *, /**)
    for (const rule of RULES) {
      if (rule.skip && rule.skip.test(line)) continue
      if (rule.re.test(line)) findings.push({ rule: rule.id, file: rel, line: i + 1, msg: rule.msg })
    }
  })
}

const key = (f) => `${f.rule}|${f.file}|${f.line}`
const mode = process.argv[2]

if (mode === '--update') {
  writeFileSync(BASELINE, JSON.stringify(findings.map(key).sort(), null, 2) + '\n')
  console.log(`Baseline updated: ${findings.length} known violations.`)
  process.exit(0)
}

const baseline = existsSync(BASELINE) && mode !== '--all'
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')))
  : new Set()

const fresh = findings.filter((f) => !baseline.has(key(f)))
const fixed = [...baseline].filter((k) => !findings.some((f) => key(f) === k))

const byRule = {}
for (const f of (mode === '--all' ? findings : fresh)) (byRule[f.rule] ??= []).push(f)

for (const [rule, items] of Object.entries(byRule)) {
  console.log(`\n  ${rule} — ${RULES.find((r) => r.id === rule).msg}`)
  for (const f of items) console.log(`    ${f.file}:${f.line}`)
}

console.log('')
if (baseline.size) console.log(`Baseline: ${baseline.size} known • fixed since: ${fixed.length}`)
if (fresh.length && mode !== '--all') {
  console.error(`\n✗ ${fresh.length} new violation(s). Fix them, or run --update only if intentionally accepted.`)
  process.exit(1)
}
console.log(mode === '--all' ? `${findings.length} total violation(s).` : '✓ No new violations.')
