import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Award, CalendarClock, Camera, RefreshCw, Upload, Check, CheckCircle2, CircleAlert, Clock, FileCheck2, Send, X, XCircle } from 'lucide-react'
import { FILE_MAX_MB, toPaise } from '@schoolgiant/shared'
import { DateInput, FormField, localIso } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import QrCode from '../../components/scan/QrCode'
import {
  familyScholarshipApply, familyScholarshipBook, familyScholarshipCancelVisit, familyScholarshipRemoveFile, familyScholarshipSend, familyScholarships,
} from '../../api/family'
import { useFormat } from '../../context/SettingsContext'
import { docName, valueTextOf } from '../../components/scholarships/ScholarshipKit'

const STEPS = ['applied', 'documents', 'checking', 'decision']
const STATE_TONE = { ACCEPTED: 'text-success-700', ORIGINAL_DUE: 'text-brand-700', SUBMITTED: 'text-ink-muted', MISSING: 'text-ink-muted', NOT_ACCEPTED: 'text-danger-600', EXPIRED: 'text-danger-600' }
const inputCls = 'h-12 w-full rounded-xl border border-border bg-surface px-3 text-[15px] text-ink focus:border-brand-400 focus:outline-none'

/** Applied · Documents · Checking · Decision — where the application is. */
function Steps({ step, failed }) {
  const { t } = useTranslation('scholarships')
  return (
    <ol className="flex items-center gap-1" aria-label={t('scholarships.family.progress')}>
      {STEPS.map((s, i) => {
        const n = i + 1
        const done = n < step || (n === 4 && step === 4 && !failed)
        const current = n === step
        return (
          <li key={s} className="flex flex-1 flex-col items-center gap-1 min-w-0">
            <span className={clsx('h-1.5 w-full rounded-full', done ? 'bg-success-500' : current ? (failed ? 'bg-danger-500' : 'bg-brand-500') : 'bg-black/[0.08]')} />
            <span className={clsx('text-[11px] truncate', current ? 'font-semibold text-ink' : 'text-ink-faint')}>{t(`scholarships.family.step.${s}`)}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** One document: its state, why it was sent back, and sending a photo (only when something is needed). */
function DocRow({ app, item, onSent }) {
  const { t } = useTranslation('scholarships')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const fileRef = useRef(null)
  const pickRef = useRef(null)
  const [issuedOn, setIssuedOn] = useState(item.issuedOn ?? '')
  const today = localIso(new Date())
  const [error, setError] = useState(null)
  const send = useMutation({
    mutationFn: (file) => familyScholarshipSend(slug, studentId, app.id, item.key, file, { issuedOn }),
    onSuccess: (d) => { setError(null); onSent(d) }, onError: (e) => setError(e.message),
  })
  const remove = useMutation({ mutationFn: (fileId) => familyScholarshipRemoveFile(slug, studentId, app.id, item.key, fileId), onSuccess: onSent, onError: (e) => setError(e.message) })
  const pick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > FILE_MAX_MB * 1024 * 1024) { setError(t('scholarships.family.tooBig', { max: FILE_MAX_MB })); return }
    send.mutate(file)
  }
  const needDate = item.needsIssueDate && item.canSend && !issuedOn
  const Icon = item.state === 'ACCEPTED' || item.state === 'ORIGINAL_DUE' ? CheckCircle2 : item.state === 'NOT_ACCEPTED' || item.state === 'EXPIRED' ? XCircle : item.state === 'SUBMITTED' ? Clock : CircleAlert
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <Icon className={clsx('mt-0.5 h-5 w-5 shrink-0', STATE_TONE[item.state])} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-ink">{docName(t, item)}{!item.required && <span className="font-normal text-ink-faint"> · {t('scholarships.doc.optional')}</span>}</p>
          <p className={clsx('text-sm', STATE_TONE[item.state])}>{t(`scholarships.family.state.${item.state}`)}</p>
          {item.state === 'NOT_ACCEPTED' && item.reason && <p className="mt-1 rounded-lg bg-danger-50 px-2.5 py-1.5 text-sm text-danger-700">{t(`scholarships.reason.${item.reason}`)}{item.reasonNote ? ` — ${item.reasonNote}` : ''}</p>}
          {item.note && <p className="text-xs text-ink-faint">{item.note}</p>}
          {item.validTill && item.state === 'ACCEPTED' && <p className="text-xs text-ink-faint">{t('scholarships.doc.validTill', { date: date(item.validTill) })}</p>}
          {item.files.length > 0 && item.canSend && (
            <ul className="mt-1.5 space-y-1">{item.files.filter((x) => x.removable).map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 rounded-lg bg-bg px-2.5 py-1.5 text-sm text-ink">
                <span className="min-w-0 truncate">{x.name}</span>
                <button type="button" onClick={() => remove.mutate(x.id)} className="shrink-0 rounded-full p-1 text-ink-muted" aria-label={t('scholarships.family.removeFile')}><X className="h-4 w-4" /></button>
              </li>
            ))}</ul>
          )}
          {item.canSend && (
            <div className="mt-2 space-y-2">
              {item.needsIssueDate && (
                <FormField label={t('scholarships.family.issuedOn')}><DateInput value={issuedOn} max={today} onChange={(e) => setIssuedOn(e.target.value)} /></FormField>
              )}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
              <input ref={pickRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={pick} />
              <button type="button" disabled={send.isPending || needDate} onClick={() => fileRef.current?.click()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-brand-300 bg-brand-50/70 px-4 text-sm font-semibold text-brand-700 disabled:opacity-50">
                <Camera className="h-4 w-4" />{send.isPending ? t('scholarships.family.sending') : item.state === 'NOT_ACCEPTED' || item.state === 'EXPIRED' ? t('scholarships.family.sendAgain') : item.files.length ? t('scholarships.family.sendMore') : t('scholarships.family.send')}
              </button>
              <button type="button" disabled={send.isPending || needDate} onClick={() => pickRef.current?.click()}
                className="ms-2 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-ink disabled:opacity-50">
                <Upload className="h-4 w-4" />{t('scholarships.family.chooseFile')}
              </button>
              {needDate && <p className="text-xs text-ink-faint">{t('scholarships.family.dateFirst')}</p>}
            </div>
          )}
          {error && <p className="mt-1 text-sm text-danger-600">{error}</p>}
        </div>
      </div>
    </li>
  )
}

/** Once every copy is checked: book a time to show the originals, and the QR the desk scans. */
function Visit({ app, times, onDone }) {
  const { t } = useTranslation('scholarships')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const [dayId, setDayId] = useState(times[0]?.id ?? '')
  const [time, setTime] = useState('')
  const book = useMutation({ mutationFn: () => familyScholarshipBook(slug, studentId, app.id, { dayId, time }), onSuccess: onDone })
  const cancel = useMutation({ mutationFn: () => familyScholarshipCancelVisit(slug, studentId, app.id), onSuccess: onDone })
  const originals = app.items.filter((i) => i.state === 'ORIGINAL_DUE').map((i) => docName(t, i))
  if (app.visit) {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3 space-y-3">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-ink"><CalendarClock className="h-5 w-5 text-brand-600" />{t('scholarships.family.booked', { date: date(app.visit.date), time: app.visit.time })}</p>
        {app.visit.place && <p className="text-sm text-ink-muted">{app.visit.place}</p>}
        <p className="text-sm text-ink">{t('scholarships.family.bring', { list: originals.join(', ') })}</p>
        <div className="flex flex-col items-center gap-1 rounded-xl bg-surface p-3">
          <QrCode value={app.applicationNo} size={168} />
          <p className="text-xs text-ink-muted">{t('scholarships.family.showQr', { no: app.applicationNo })}</p>
        </div>
        <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate()} className="h-11 w-full rounded-xl border border-border text-sm font-medium text-ink">{t('scholarships.family.cancelVisit')}</button>
      </div>
    )
  }
  if (!app.canBook) return null
  const day = times.find((d) => d.id === dayId)
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3 space-y-3">
      <p className="text-[15px] font-semibold text-ink">{t('scholarships.family.bookTitle')}</p>
      <p className="text-sm text-ink-muted">{t('scholarships.family.bookHint', { list: originals.join(', ') })}</p>
      {!times.length ? <p className="text-sm text-ink">{t('scholarships.family.noTimes')}</p> : (
        <>
          <div className="flex flex-wrap gap-2">
            {times.map((d) => (
              <button key={d.id} type="button" onClick={() => { setDayId(d.id); setTime('') }}
                className={clsx('min-h-[40px] rounded-full border px-3 text-sm', d.id === dayId ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-ink')}>{date(d.date)}</button>
            ))}
          </div>
          {day?.place && <p className="text-xs text-ink-muted">{day.place}</p>}
          <div className="flex flex-wrap gap-2">
            {(day?.times ?? []).filter((x) => x.free > 0).map((x) => (
              <button key={x.time} type="button" onClick={() => setTime(x.time)}
                className={clsx('min-h-[40px] min-w-[64px] rounded-lg border px-3 text-sm tabular-nums', x.time === time ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-ink')}>{x.time}</button>
            ))}
          </div>
          {book.error && <p className="text-sm text-danger-600">{book.error.message}</p>}
          <button type="button" disabled={!time || book.isPending} onClick={() => book.mutate()} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" />{t('scholarships.family.book')}</button>
        </>
      )}
    </div>
  )
}

function Application({ app, times, onChanged }) {
  const { t } = useTranslation('scholarships')
  const { date } = useFormat()
  const failed = app.status === 'NOT_APPROVED' || app.status === 'WITHDRAWN'
  const needed = app.items.filter((i) => i.required || i.state !== 'MISSING')
  return (
    <FCard title={app.scheme?.name} action={<span className="text-xs text-ink-faint">{app.applicationNo}</span>}>
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">{valueTextOf(t, app.scheme)}{app.scheme?.lastDate && app.open ? ` · ${t('scholarships.family.lastDate', { date: date(app.scheme.lastDate) })}` : ''}</p>
        <Steps step={app.step} failed={failed} />
        <p className={clsx('rounded-xl px-3 py-2.5 text-[15px]', app.next === 'APPROVED' ? 'bg-success-50 text-success-700' : failed ? 'bg-danger-50 text-danger-700' : app.next === 'FIX_DOCS' ? 'bg-amber-50 text-amber-600' : 'bg-bg text-ink')}>
          {t(`scholarships.family.next.${app.next}`)}{app.next === 'NOT_APPROVED' && app.decisionNote ? ` ${t('scholarships.family.reasonWas', { reason: app.decisionNote })}` : ''}
        </p>
        {app.open && <Visit app={app} times={times} onDone={onChanged} />}
        {app.open && needed.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-ink">{t('scholarships.family.documents')}</p>
            <ul className="divide-y divide-border">{app.items.map((i) => <DocRow key={i.key} app={app} item={i} onSent={onChanged} />)}</ul>
          </div>
        )}
      </div>
    </FCard>
  )
}

function Scheme({ scheme, onApplied }) {
  const { t } = useTranslation('scholarships')
  const { slug, studentId, student } = useFamily()
  const { date } = useFormat()
  const [open, setOpen] = useState(false)
  const [income, setIncome] = useState('')
  const apply = useMutation({ mutationFn: () => familyScholarshipApply(slug, studentId, scheme.id, { familyIncome: income === '' ? undefined : toPaise(income) }), onSuccess: onApplied })
  const toGive = scheme.documents.filter((d) => !d.have)
  const have = scheme.documents.filter((d) => d.have)
  return (
    <FCard title={scheme.name} action={<span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">{valueTextOf(t, scheme)}</span>}>
      <div className="space-y-3">
        {scheme.renewal && (
          <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-[15px] text-brand-700"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{t('scholarships.renewal.familyNote', { no: scheme.renewal.applicationNo })}</p>
        )}
        {scheme.description && <p className="text-[15px] text-ink">{scheme.description}</p>}
        {scheme.lastDate && <p className="text-sm text-ink-muted">{t('scholarships.family.lastDate', { date: date(scheme.lastDate) })}</p>}
        {scheme.documents.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-ink">{t('scholarships.family.youNeed')}</p>
            <ul className="space-y-1">{toGive.map((d) => <li key={d.key} className="text-sm text-ink">• {docName(t, d)}{!d.required && <span className="text-ink-faint"> · {t('scholarships.doc.optional')}</span>}{d.note && <span className="text-ink-faint"> — {d.note}</span>}</li>)}</ul>
            {have.length > 0 && <ul className="space-y-1">{have.map((d) => <li key={d.key} className="flex items-center gap-1.5 text-sm text-success-700"><FileCheck2 className="h-4 w-4" />{t('scholarships.family.alreadyHave', { doc: docName(t, d) })}</li>)}</ul>}
          </div>
        )}
        {open ? (
          <div className="space-y-3">
            {scheme.needsIncome && !scheme.renewal && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">{t('scholarships.family.income')}</span>
                <input type="number" inputMode="numeric" min="0" value={income} onChange={(e) => setIncome(e.target.value)} className={inputCls} />
                <span className="mt-1 block text-xs text-ink-faint">{t('scholarships.family.incomeHint')}</span>
              </label>
            )}
            {apply.error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-600">{apply.error.message}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="h-12 flex-1 rounded-xl border border-border text-sm font-medium text-ink">{t('scholarships.common.cancel')}</button>
              <button type="button" disabled={apply.isPending || (scheme.needsIncome && income === '')} onClick={() => apply.mutate()} className="inline-flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl bg-brand-500 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" />{t('scholarships.family.applyFor', { name: student?.firstName ?? '' })}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="h-12 w-full rounded-xl bg-brand-500 text-sm font-semibold text-white">{scheme.renewal ? t('scholarships.renewal.familyButton', { name: student?.firstName ?? '' }) : t('scholarships.family.apply')}</button>
        )}
      </div>
    </FCard>
  )
}

/** The family app › Scholarships: apply, send each document from the phone, see what to fix and why, book a time for the originals. */
export default function FamilyScholarships() {
  const { t } = useTranslation('scholarships')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { data, isLoading, error } = useFamilyQuery(['scholarships'], () => familyScholarships(slug, studentId))
  const put = (d) => qc.setQueryData(['family', slug, studentId, 'scholarships'], d)
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  const apps = data?.applications ?? []
  const schemes = data?.schemes ?? []
  return (
    <>
      {apps.map((a) => <Application key={a.id} app={a} times={data.visitTimes ?? []} onChanged={put} />)}
      {schemes.length > 0 && <h2 className="px-1 pt-2 font-display text-base font-semibold text-ink">{t('scholarships.family.canApply')}</h2>}
      {schemes.map((s) => <Scheme key={s.id} scheme={s} onApplied={put} />)}
      {!apps.length && !schemes.length && <FCard><FEmpty icon={Award} title={t('scholarships.family.none')} hint={t('scholarships.family.noneHint')} /></FCard>}
    </>
  )
}
