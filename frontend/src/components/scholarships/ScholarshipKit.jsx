import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CircleHelp, Eye, FileCheck2, FilePlus2, FileX2, Stamp, X } from 'lucide-react'
import {
  SCHOLARSHIP_DOC_STATUS, SCHOLARSHIP_DOC_TYPE_BY, SCHOLARSHIP_REJECT_REASONS, SCHOLARSHIP_STATUS, formatINR,
} from '@schoolgiant/shared'
import { Attachments, DateInput, FormField, Input, Modal, Select, StatusPill, Tag, Textarea } from '../system'
import Button from '../ui/Button'
import { useFormat } from '../../context/SettingsContext'

/** A document's name in the reader's language (from its type); a document the scheme named itself keeps its name. */
export function docName(t, d) {
  if (!d) return ''
  const type = d.type ?? d.key
  return !type || String(type).startsWith('OTHER') ? d.label : t(`scholarships.docType.${type}`, d.label)
}

/** "50% of fees" / "₹12,000 a year" in the reader's language. */
export function valueTextOf(t, s) {
  if (!s) return ''
  if (s.kind === 'PCT' && s.value != null) return t('scholarships.value.pct', { value: s.value })
  if (s.kind === 'AMOUNT' && s.value != null) return t('scholarships.value.amount', { amount: formatINR(s.value) })
  return s.valueText ?? ''
}

/** The application's status as a pill. */
export function ApplicationStatus({ status }) {
  const { t } = useTranslation('scholarships')
  return <StatusPill tone={SCHOLARSHIP_STATUS[status]?.tone}>{t(`scholarships.status.${status}`, SCHOLARSHIP_STATUS[status]?.label)}</StatusPill>
}

/** One checklist line's state as a pill. */
export function DocState({ state }) {
  const { t } = useTranslation('scholarships')
  return <StatusPill tone={SCHOLARSHIP_DOC_STATUS[state]?.tone}>{t(`scholarships.docState.${state}`, SCHOLARSHIP_DOC_STATUS[state]?.label)}</StatusPill>
}

const DOT = {
  ACCEPTED: { icon: Check, cls: 'bg-success-500 text-white' },
  ORIGINAL_DUE: { icon: Stamp, cls: 'bg-success-50 text-success-700 ring-1 ring-success-200' },
  SUBMITTED: { icon: Eye, cls: 'bg-brand-500 text-white' },
  NOT_ACCEPTED: { icon: X, cls: 'bg-danger-500 text-white' },
  EXPIRED: { icon: X, cls: 'bg-danger-50 text-danger-600 ring-1 ring-danger-200' },
  MISSING: { icon: null, cls: 'bg-surface ring-1 ring-border' },
}

/** One small round mark per document — green correct, blue to check, red to fix, empty not given — named on hover. */
export function DocDots({ items = [] }) {
  const { t } = useTranslation('scholarships')
  if (!items.length) return <span className="text-xs text-ink-faint">{t('scholarships.app.noDocuments')}</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {items.map((d) => {
        const s = DOT[d.state] ?? DOT.MISSING
        const Icon = s.icon
        const label = `${docName(t, d)}: ${t(`scholarships.docState.${d.state}`)}`
        return <span key={d.key} title={label} aria-label={label} className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${s.cls}`}>{Icon && <Icon className="h-3 w-3" strokeWidth={3} aria-hidden />}</span>
      })}
    </span>
  )
}

/** What the document marks mean, shown under a list that uses them. */
export function DocKey() {
  const { t } = useTranslation('scholarships')
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
      {['ACCEPTED', 'SUBMITTED', 'NOT_ACCEPTED', 'ORIGINAL_DUE', 'MISSING'].map((st) => (
        <span key={st} className="inline-flex items-center gap-1.5"><DocDots items={[{ key: st, label: '', state: st }]} />{t(`scholarships.docState.${st}`)}</span>
      ))}
    </p>
  )
}

/** "3 of 5 correct" and what is left, in a few calm words. */
export function DocProgress({ docs }) {
  const { t } = useTranslation('scholarships')
  if (!docs) return <span className="text-ink-faint">—</span>
  const c = docs.counts ?? {}
  const left = [
    c.SUBMITTED && t('scholarships.progress.toCheck', { count: c.SUBMITTED }),
    (c.NOT_ACCEPTED || c.EXPIRED) && t('scholarships.progress.toFix', { count: (c.NOT_ACCEPTED ?? 0) + (c.EXPIRED ?? 0) }),
    c.MISSING && t('scholarships.progress.notGiven', { count: c.MISSING }),
    c.ORIGINAL_DUE && t('scholarships.progress.originals', { count: c.ORIGINAL_DUE }),
  ].filter(Boolean)
  const pct = docs.required ? Math.round((docs.correct / docs.required) * 100) : 100
  return (
    <div className="min-w-[9rem]">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-black/[0.06] overflow-hidden"><div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} /></div>
        <span className="text-xs tabular-nums text-ink-muted">{docs.correct}/{docs.required}</span>
      </div>
      {left.length > 0 && <p className={`text-xs mt-1 ${c.NOT_ACCEPTED || c.EXPIRED ? 'text-danger-600' : 'text-ink-faint'}`}>{left.join(' · ')}</p>}
    </div>
  )
}

/**
 * The scheme's rules against the student: a tick, a cross, or a question mark when the system can't tell
 * (no marks or attendance yet, income not given) and the paper decides.
 */
/** How a check's value and the scheme's need read: "₹1,70,000" against "up to ₹2,50,000 a year". */
function checkTexts(t, classes = []) {
  const className = (id) => classes.find((c) => c.id === id)?.name ?? '—'
  const show = (c) => {
    if (c.value == null) return t('scholarships.eligibility.unknown')
    if (c.key === 'class') return className(c.value)
    if (c.key === 'income') return formatINR(c.value)
    if (c.key === 'marks' || c.key === 'attendance') return `${c.value}%`
    if (c.key === 'category') return t(`scholarships.category.${c.value}`, c.value)
    if (c.key === 'gender') return t(`scholarships.gender.${c.value}`, c.value)
    return String(c.value)
  }
  const need = (c) => {
    if (c.key === 'class') return c.need.map(className).join(', ')
    if (c.key === 'income') return t('scholarships.eligibility.upTo', { value: formatINR(c.need) })
    if (c.key === 'marks' || c.key === 'attendance') return t('scholarships.eligibility.atLeast', { value: `${c.need}%` })
    if (c.key === 'category') return c.need.map((v) => t(`scholarships.category.${v}`, v)).join(', ')
    if (c.key === 'gender') return c.need.map((v) => t(`scholarships.gender.${v}`, v)).join(', ')
    return ''
  }
  return { show, need }
}

/**
 * The scheme's rules against the student: a tick, a cross, or a question mark when the system can't tell
 * (no marks or attendance yet, income not given) and the paper decides.
 */
export function EligibilityList({ checks = [], classes = [] }) {
  const { t } = useTranslation('scholarships')
  if (!checks.length) return <p className="text-sm text-ink-muted">{t('scholarships.eligibility.open')}</p>
  const { show, need } = checkTexts(t, classes)
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {checks.map((c) => {
        const Icon = c.ok === true ? Check : c.ok === false ? X : CircleHelp
        const tone = c.ok === true ? 'text-success-600' : c.ok === false ? 'text-danger-600' : 'text-ink-faint'
        return (
          <li key={c.key} className="flex items-start gap-3 px-3 py-2 text-sm">
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${tone}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-ink">{t(`scholarships.check.${c.key}`)}: <span className="font-medium">{show(c)}</span></p>
              <p className="text-xs text-ink-faint">{t('scholarships.eligibility.needs', { what: need(c) })}{c.ok == null ? ` · ${t('scholarships.eligibility.checkPaper')}` : ''}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** The same checks as small chips on one line (the review page's header): the need shows on hover. */
export function EligibilityChips({ checks = [], classes = [] }) {
  const { t } = useTranslation('scholarships')
  if (!checks.length) return <span className="text-sm text-ink-muted">{t('scholarships.eligibility.open')}</span>
  const { show, need } = checkTexts(t, classes)
  return (
    <span className="flex flex-wrap gap-1.5">
      {checks.map((c) => {
        const Icon = c.ok === true ? Check : c.ok === false ? X : CircleHelp
        const cls = c.ok === true ? 'border-success-200 bg-success-50 text-success-700' : c.ok === false ? 'border-danger-200 bg-danger-50 text-danger-700' : 'border-border bg-bg text-ink-muted'
        const title = `${t('scholarships.eligibility.needs', { what: need(c) })}${c.ok == null ? ` · ${t('scholarships.eligibility.checkPaper')}` : ''}`
        return (
          <span key={c.key} title={title} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${cls}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden />{t(`scholarships.check.${c.key}`)}: <span className="font-semibold">{show(c)}</span>
            <span className="opacity-70">({need(c)})</span>
          </span>
        )
      })}
    </span>
  )
}

/** "Correct" (details, the original seen) or "Needs fixing" (the reason the family is told) for one document. */
export function CheckDocument({ item, mode, onClose, onSave, saving, errors = {} }) {
  const { t } = useTranslation('scholarships')
  const months = SCHOLARSHIP_DOC_TYPE_BY[item.type]?.validMonths
  const [form, setForm] = useState({
    number: item.doc?.number ?? '', issuedOn: item.doc?.issuedOn ?? '', originalSeen: !!item.doc?.originalSeen || false,
    reason: '', note: '',
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const accept = mode === 'ACCEPT'
  const ok = accept ? (!months || !!form.issuedOn) : !!form.reason && (form.reason !== 'OTHER' || form.note.trim().length > 1)
  const submit = () => onSave(accept
    ? { result: 'ACCEPT', number: form.number || undefined, issuedOn: form.issuedOn || undefined, originalSeen: form.originalSeen }
    : { result: 'NOT_ACCEPT', reason: form.reason, note: form.note || undefined })
  return (
    <Modal open onClose={onClose} title={accept ? t('scholarships.checkDoc.correctTitle', { doc: docName(t, item) }) : t('scholarships.checkDoc.fixTitle', { doc: docName(t, item) })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('scholarships.common.cancel')}</Button>
      <Button icon={accept ? FileCheck2 : FileX2} variant={accept ? 'primary' : 'danger'} loading={saving} disabled={!ok} onClick={submit}>{accept ? t('scholarships.checkDoc.markCorrect') : t('scholarships.checkDoc.markFix')}</Button>
    </>}>
      {accept ? (
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('scholarships.checkDoc.number')} error={errors.number}><Input value={form.number} onChange={set('number')} /></FormField>
          <FormField label={t('scholarships.checkDoc.issuedOn')} required={!!months} error={errors.issuedOn} hint={months ? t('scholarships.checkDoc.validFor', { count: months }) : undefined}>
            <DateInput value={form.issuedOn} onChange={set('issuedOn')} />
          </FormField>
          <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.originalSeen} onChange={set('originalSeen')} className="rounded border-border text-brand-500 focus:ring-brand-500" />
            {t('scholarships.checkDoc.originalSeen')}
            {item.originalNeeded && <Tag tone="info" icon={Stamp}>{t('scholarships.doc.originalNeeded')}</Tag>}
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          <FormField label={t('scholarships.checkDoc.reason')} required error={errors.reason} hint={t('scholarships.checkDoc.reasonHint')}>
            <Select value={form.reason} onChange={set('reason')}>
              <option value="">{t('scholarships.checkDoc.pickReason')}</option>
              {SCHOLARSHIP_REJECT_REASONS.map((r) => <option key={r.value} value={r.value}>{t(`scholarships.reason.${r.value}`, r.label)}</option>)}
            </Select>
          </FormField>
          <FormField label={t('scholarships.checkDoc.note')} required={form.reason === 'OTHER'} error={errors.note}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField>
        </div>
      )}
    </Modal>
  )
}

/**
 * One checklist line on an application: what it is, its state, the files (photo or scan) and the details, and the
 * buttons for whoever checks it. Files go on the student's wallet document, so they are kept for next time.
 */
export function DocumentLine({ item, open: decided, canWork, canVerify, onAddFiles, onFilesChanged, onPaperCopy, onCheck, onOriginal, busy }) {
  const { t } = useTranslation('scholarships')
  const { date } = useFormat()
  const [showFiles, setShowFiles] = useState(item.state === 'SUBMITTED')
  const d = item.doc
  const fixable = ['MISSING', 'NOT_ACCEPTED', 'EXPIRED'].includes(item.state)
  const highlight = item.state === 'NOT_ACCEPTED' || item.state === 'EXPIRED'
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-danger-200 bg-danger-50/40' : 'border-border'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{docName(t, item)}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <Tag tone={item.required ? 'neutral' : 'info'}>{item.required ? t('scholarships.doc.required') : t('scholarships.doc.optional')}</Tag>
            {item.originalNeeded && <Tag tone="info" icon={Stamp}>{t('scholarships.doc.originalNeeded')}</Tag>}
            {item.note && <span className="text-xs text-ink-faint">{item.note}</span>}
          </div>
        </div>
        <DocState state={item.state} />
      </div>

      {d && (d.number || d.issuedOn || d.validTill || d.checkedAt || d.paperCopy || d.reason) && (
        <div className="mt-2 text-xs text-ink-muted space-y-0.5">
          {(d.number || d.issuedOn || d.validTill) && <p>{[d.number && t('scholarships.doc.no', { no: d.number }), d.issuedOn && t('scholarships.doc.issued', { date: date(d.issuedOn) }), d.validTill && t('scholarships.doc.validTill', { date: date(d.validTill) })].filter(Boolean).join(' · ')}</p>}
          {d.paperCopy && <p>{t('scholarships.doc.paperCopy')}</p>}
          {d.checkedAt && <p>{t('scholarships.doc.checkedBy', { name: d.checkedBy ?? '—', date: date(String(d.checkedAt).slice(0, 10)) })}{d.originalSeen ? ` · ${t('scholarships.doc.originalSeenShort')}` : ''}</p>}
          {highlight && d.reason && <p className="text-danger-600 font-medium">{t(`scholarships.reason.${d.reason}`, d.reasonLabel)}{d.reasonNote ? ` — ${d.reasonNote}` : ''}</p>}
        </div>
      )}

      {showFiles && d?.id && (
        <div className="mt-3"><Attachments entityType="scholarship_doc" entityId={d.id} compact canAdd={canWork && decided} onChange={onFilesChanged} /></div>
      )}

      {decided && (canWork || canVerify) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {canWork && !showFiles && <Button size="sm" variant="secondary" icon={FilePlus2} loading={busy === 'files'} onClick={async () => { if (!d?.id) await onAddFiles(); setShowFiles(true) }}>{d?.files ? t('scholarships.doc.seeFiles', { count: d.files }) : t('scholarships.doc.addFiles')}</Button>}
          {canWork && fixable && <Button size="sm" variant="ghost" icon={FilePlus2} loading={busy === 'paper'} onClick={onPaperCopy}>{t('scholarships.doc.paperReceived')}</Button>}
          {canVerify && item.state !== 'ACCEPTED' && item.state !== 'ORIGINAL_DUE' && <Button size="sm" variant="ghost" icon={Check} onClick={() => onCheck('ACCEPT')}>{t('scholarships.doc.correct')}</Button>}
          {canVerify && item.state !== 'MISSING' && item.state !== 'NOT_ACCEPTED' && <Button size="sm" variant="ghost" icon={X} onClick={() => onCheck('NOT_ACCEPT')}>{t('scholarships.doc.needsFix')}</Button>}
          {canVerify && item.state === 'ORIGINAL_DUE' && <Button size="sm" variant="ghost" icon={Eye} loading={busy === 'original'} onClick={onOriginal}>{t('scholarships.doc.markOriginal')}</Button>}
        </div>
      )}
    </div>
  )
}
