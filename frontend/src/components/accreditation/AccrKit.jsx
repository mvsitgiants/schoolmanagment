import { Fragment, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Bold, Eye, Heading2, List, PencilLine } from 'lucide-react'
import { ACCR_DVV_STATUS, ACCR_FRAMEWORKS, ACCR_METRIC_STATUS, ACCR_NARRATIVE_WORDS, ACCR_SOURCES, accrWordCount } from '@schoolgiant/shared'
import { SegmentedControl, Select, StatusPill, Tag, Textarea } from '../system'
import { fetchAccrMeta } from '../../api/accreditation'
import { useFormat } from '../../context/SettingsContext'

const keyOf = (code) => String(code).replace(/\./g, '_')

/**
 * Labels for the accreditation lists. Framework texts (criteria, metric titles, DVV documents) live in the locale under
 * accreditation.fw.<FRAMEWORK>; the shared definition's English is the fallback.
 */
export function useAccrLabels() {
  const { t } = useTranslation('accreditation')
  return {
    framework: (v) => t(`accreditation.frameworks.${v}`),
    frameworkName: (v) => t(`accreditation.frameworkNames.${v}`),
    status: (v) => t(`accreditation.status.${v}`),
    dvv: (v) => t(`accreditation.dvv.${v}`),
    source: (v) => t(`accreditation.sources.${v}`),
    kind: (v) => t(`accreditation.kinds.${v}`),
    detail: (k) => t(`accreditation.detail.${k}`),
    criterion: (fw, c) => t(`accreditation.fw.${fw}.c.${c.id}`, { defaultValue: c.title }),
    metric: (fw, m) => t(`accreditation.fw.${fw}.m.${keyOf(m.code)}`, { defaultValue: m.title }),
    doc: (fw, code, i, fallback) => t(`accreditation.fw.${fw}.dvv.${keyOf(code)}.${i}`, { defaultValue: fallback }),
  }
}

/** A metric's value as it reads: 72.5 % · 18.2 : 1 · ₹ 4.25 lakh · 8.4 years. */
export function useAccrValue() {
  const { t } = useTranslation('accreditation')
  const { number } = useFormat()
  return (value, unit) => (value === null || value === undefined ? null : t(`accreditation.units.${unit ?? 'count'}`, { value: number(value, { maximumFractionDigits: 2 }) }))
}

export const useAccrMeta = () => useQuery({ queryKey: ['accreditation', 'meta'], queryFn: fetchAccrMeta, staleTime: 5 * 60_000 })

export function MetricStatusPill({ status }) {
  const L = useAccrLabels()
  return <StatusPill tone={ACCR_METRIC_STATUS[status]?.tone ?? 'neutral'}>{L.status(status)}</StatusPill>
}
export function DvvPill({ status }) {
  const L = useAccrLabels()
  return <StatusPill tone={ACCR_DVV_STATUS[status]?.tone ?? 'neutral'}>{L.dvv(status)}</StatusPill>
}
export function KindTag({ kind }) {
  const L = useAccrLabels()
  return <Tag size="xs" tone={kind === 'QN' ? 'info' : 'violet'}>{L.kind(kind)}</Tag>
}
export function SourceTag({ source }) {
  const L = useAccrLabels()
  return <Tag size="xs" tone={ACCR_SOURCES[source]?.tone ?? 'neutral'}>{L.source(source)}</Tag>
}

/** Framework (NAAC · NIRF · AISHE) and assessment year pickers, side by side. `allYears` adds "every year". */
export function FrameworkYearBar({ framework, year, onFramework, onYear, allYears = false }) {
  const { t } = useTranslation('accreditation')
  const L = useAccrLabels()
  const { data: meta } = useAccrMeta()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl size="md" value={framework} onChange={onFramework} options={ACCR_FRAMEWORKS.map((f) => ({ value: f.value, label: L.framework(f.value) }))} />
      <div className="w-40">
        <Select value={year} onChange={(e) => onYear(e.target.value)} aria-label={t('accreditation.year')}>
          {allYears && <option value="">{t('accreditation.allYears')}</option>}
          {(meta?.years ?? (year ? [year] : [])).map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────── narrative (qualitative metrics)

/** Simple markdown (## heading, - bullet, **bold**) as React elements — no HTML is injected. */
export function NarrativeView({ text, className }) {
  const blocks = []
  let list = null
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>))
  for (const [i, line] of String(text ?? '').split('\n').entries()) {
    const l = line.trimEnd()
    if (/^\s*[-*]\s+/.test(l)) {
      if (!list) { list = []; blocks.push({ type: 'ul', items: list, key: i }) }
      list.push(l.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    list = null
    if (!l.trim()) continue
    if (/^#{1,3}\s+/.test(l)) blocks.push({ type: 'h', text: l.replace(/^#{1,3}\s+/, ''), key: i })
    else blocks.push({ type: 'p', text: l, key: i })
  }
  return (
    <div className={className}>
      {blocks.map((b) => (b.type === 'ul'
        ? <ul key={b.key} className="my-1.5 list-disc space-y-0.5 ps-5">{b.items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>
        : b.type === 'h' ? <p key={b.key} className="mt-3 mb-1 font-semibold text-ink">{inline(b.text)}</p>
          : <p key={b.key} className="my-1.5">{inline(b.text)}</p>))}
    </div>
  )
}

/** The narrative of a qualitative metric: a small toolbar (bold, heading, bullet), a preview, and NAAC's 500-word bar. */
export function NarrativeEditor({ value, onChange, disabled }) {
  const { t } = useTranslation('accreditation')
  const ref = useRef(null)
  const [preview, setPreview] = useState(false)
  const words = accrWordCount(value)
  const over = words > ACCR_NARRATIVE_WORDS
  const wrap = (before, after = '', linePrefix = false) => {
    const el = ref.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    let next
    if (linePrefix) {
      const start = value.lastIndexOf('\n', a - 1) + 1
      next = `${value.slice(0, start)}${before}${value.slice(start)}`
    } else {
      next = `${value.slice(0, a)}${before}${value.slice(a, b) || t('accreditation.narrative.text')}${after}${value.slice(b)}`
    }
    onChange(next)
    requestAnimationFrame(() => el.focus())
  }
  const tool = 'inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-black/[0.05] hover:text-ink disabled:opacity-40'
  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <button type="button" className={tool} disabled={disabled || preview} onClick={() => wrap('**', '**')} title={t('accreditation.narrative.bold')} aria-label={t('accreditation.narrative.bold')}><Bold className="w-4 h-4" /></button>
        <button type="button" className={tool} disabled={disabled || preview} onClick={() => wrap('## ', '', true)} title={t('accreditation.narrative.heading')} aria-label={t('accreditation.narrative.heading')}><Heading2 className="w-4 h-4" /></button>
        <button type="button" className={tool} disabled={disabled || preview} onClick={() => wrap('- ', '', true)} title={t('accreditation.narrative.bullet')} aria-label={t('accreditation.narrative.bullet')}><List className="w-4 h-4" /></button>
        <span className="flex-1" />
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-black/[0.05]" onClick={() => setPreview((p) => !p)}>
          {preview ? <PencilLine className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}{preview ? t('accreditation.narrative.write') : t('accreditation.narrative.preview')}
        </button>
      </div>
      {preview
        ? <NarrativeView text={value} className="min-h-[240px] px-3 py-2 text-sm leading-relaxed text-ink" />
        : <Textarea ref={ref} rows={12} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={t('accreditation.narrative.placeholder')} className="!border-0 !ring-0 rounded-none" />}
      <div className="flex items-center gap-3 border-t border-border px-3 py-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
          <span className={over ? 'block h-full rounded-full bg-rose-500' : 'block h-full rounded-full bg-brand-500'} style={{ width: `${Math.min(100, (words / ACCR_NARRATIVE_WORDS) * 100)}%` }} />
        </span>
        <span className={over ? 'text-xs font-semibold text-rose-700 tabular-nums' : 'text-xs text-ink-muted tabular-nums'}>{t('accreditation.narrative.words', { count: words, max: ACCR_NARRATIVE_WORDS })}</span>
      </div>
    </div>
  )
}
