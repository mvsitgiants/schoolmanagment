import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Briefcase, CalendarCheck2, CalendarHeart, CheckCheck, CircleCheck, CircleDashed, CircleHelp, CircleX, Coffee, Download, Palmtree, Upload } from 'lucide-react'
import { EMPLOYEE_CATEGORIES, MARKABLE, STAFF_ATTENDANCE } from '@schoolgiant/shared'
import { DateInput, Avatar, ControlChip, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, PersonCell, SegmentedControl, StatCardRow, Textarea, localIso } from '../../components/system'
import Button from '../../components/ui/Button'
import { exportStaffMonth, fetchStaffDay, fetchStaffMonth, importStaffAttendance, saveStaffDay } from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useHrLabels } from '../../components/hrms/HrKit'
import clsx from 'clsx'

const TONE_CLS = {
  success: 'bg-success-50 text-success-700 border-success-200', warning: 'bg-amber-50 text-amber-700 border-amber-200', danger: 'bg-danger-50 text-danger-700 border-danger-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200', brand: 'bg-brand-50 text-brand-700 border-brand-200', neutral: 'bg-bg text-ink-muted border-border',
}
const toneOf = (s) => TONE_CLS[STAFF_ATTENDANCE[s]?.tone ?? 'neutral']
// each day count's tile on the day view
const COUNT_LOOK = {
  PRESENT: { icon: CircleCheck, tone: 'success' },
  HALF_DAY: { icon: CircleDashed, tone: 'warning' },
  ABSENT: { icon: CircleX, tone: 'danger' },
  ON_DUTY: { icon: Briefcase, tone: 'info' },
  LEAVE: { icon: Palmtree, tone: 'brand' },
  HOLIDAY: { icon: CalendarHeart, tone: 'sky' },
  WEEKLY_OFF: { icon: Coffee, tone: 'teal' },
  UNMARKED: { icon: CircleHelp, tone: 'orange' },
}

/** Paste the machine's export: code, date, in, out (comma or tab separated, a header row is fine). */
function ImportModal({ onClose, onDone }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const rows = useMemo(() => text.split(/\r?\n/).map((l) => l.split(/[,\t;]/).map((c) => c.trim())).filter((c) => c[0] && /^\d{4}-\d{2}-\d{2}$/.test(c[1] ?? ''))
    .map(([employeeCode, date, inTime, outTime, status]) => ({ employeeCode, date, inTime: inTime || undefined, outTime: outTime || undefined, status: status || undefined })), [text])
  const go = useMutation({ mutationFn: () => importStaffAttendance(rows), onSuccess: (r) => { setResult(r); onDone() }, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="lg" title={t('hrms.attendance.importTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.close')}</Button>
      <Button loading={go.isPending} disabled={!rows.length} onClick={() => go.mutate()}>{t('hrms.attendance.importGo', { count: rows.length })}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">{t('hrms.attendance.importHint')}</p>
        <pre className="text-xs bg-bg rounded-lg p-2 text-ink-muted">EMP00012,2026-11-03,08:05,15:10{'\n'}EMP00015,2026-11-03,,,ABSENT</pre>
        <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono-num text-xs" />
        {result && (
          <Note tone={result.skipped.length ? 'warning' : 'success'}>
            <p>{t('hrms.attendance.importDone', { saved: result.saved, skipped: result.skipped.length })}</p>
            {result.skipped.slice(0, 10).map((s) => <p key={`${s.row}`} className="text-xs">{t('hrms.attendance.skippedRow', { row: s.row, code: s.code ?? '', reason: s.reason })}</p>)}
          </Note>
        )}
      </div>
    </Modal>
  )
}

function DayView({ category }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [date, setDate] = useState(localIso(new Date()))
  const [draft, setDraft] = useState({})
  const { data, isLoading, error } = useQuery({ queryKey: ['staff-day', date, category], queryFn: () => fetchStaffDay(date, { category: category || undefined }) })
  useEffect(() => setDraft({}), [date, category])
  const canEdit = hasPermission('hrms.attendance.edit') && data?.editable
  const rows = data?.rows ?? []
  const val = (r) => ({ status: r.status, inTime: r.inTime ?? '', outTime: r.outTime ?? '', note: r.note ?? '', ...draft[r.employeeId] })
  const set = (r, patch) => setDraft((d) => ({ ...d, [r.employeeId]: { ...val(r), ...d[r.employeeId], ...patch } }))
  const changed = Object.keys(draft).length
  const save = useMutation({
    mutationFn: () => saveStaffDay(date, Object.entries(draft).map(([employeeId, v]) => ({ employeeId, status: v.status && MARKABLE.includes(v.status) ? v.status : null, inTime: v.inTime, outTime: v.outTime, note: v.note }))),
    onSuccess: () => { setDraft({}); qc.invalidateQueries({ queryKey: ['staff-day'] }); qc.invalidateQueries({ queryKey: ['staff-month'] }); showSuccess(t('hrms.attendance.saved')) },
    onError: (e) => showError(e.message),
  })
  const allPresent = () => setDraft((d) => {
    const next = { ...d }
    for (const r of rows) if (!r.locked && !r.off && !(r.marked && r.status)) next[r.employeeId] = { ...val(r), status: 'PRESENT' }
    return next
  })
  const counts = data?.counts ?? {}
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44"><FormField label={t('hrms.attendance.date')}><DateInput value={date} max={localIso(new Date())} onChange={(e) => setDate(e.target.value)} /></FormField></div>
        {canEdit && <Button variant="secondary" icon={CheckCheck} onClick={allPresent}>{t('hrms.attendance.allPresent')}</Button>}
        {canEdit && <Button loading={save.isPending} disabled={!changed} onClick={() => save.mutate()}>{t('hrms.attendance.save', { count: changed })}</Button>}
      </div>
      {data?.holiday && <Note>{t('hrms.attendance.holidayToday', { name: data.holiday })}</Note>}
      {data && !data.editable && <Note tone="warning">{t('hrms.attendance.notEditable')}</Note>}
      {Object.keys(counts).length > 0 && <StatCardRow items={Object.entries(counts).map(([k, n]) => ({
        label: k === 'UNMARKED' ? t('hrms.attendance.unmarked') : L.att(k), value: n, ...COUNT_LOOK[k],
      }))} />}
      {isLoading ? <p className="text-sm text-ink-faint">{t('hrms.loading')}</p> : error ? <Note tone="warning">{error.message}</Note> : !rows.length ? <Note>{t('hrms.attendance.nobody')}</Note> : (
        <div className="rounded-xl border border-border bg-surface divide-y divide-border">
          {rows.map((r) => {
            const v = val(r)
            const timed = ['PRESENT', 'HALF_DAY', 'ON_DUTY'].includes(v.status)
            return (
              <div key={r.employeeId} className="grid gap-2 px-4 py-3 md:grid-cols-[1.4fr_2.2fr_1.2fr] items-center">
                <div className="flex min-w-0 items-center gap-2">
                  <PersonCell name={r.name} sub={[r.code, r.designation].filter(Boolean).join(' · ')} className="text-sm" />
                  {r.late && <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">{t('hrms.attendance.late')}</span>}
                </div>
                {r.locked ? (
                  <p className="text-sm text-brand-700">{t('hrms.attendance.onLeave', { code: r.leave?.code ?? '', portion: r.leave?.portion === 0.5 ? t('hrms.leave.halfDayShort') : '' })}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {r.off && !r.marked && !draft[r.employeeId] && <span className={clsx('rounded-full border px-2.5 py-1 text-xs', TONE_CLS.neutral)}>{r.off.name ?? L.att(r.off.kind)}</span>}
                    {MARKABLE.map((s) => (
                      <button key={s} type="button" disabled={!canEdit} onClick={() => set(r, { status: v.status === s ? null : s })}
                        className={clsx('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', v.status === s ? toneOf(s) : 'border-border text-ink-muted hover:bg-bg', !canEdit && 'opacity-60 cursor-default')}>
                        {L.att(s)}
                      </button>
                    ))}
                  </div>
                )}
                {!r.locked && timed ? (
                  <div className="flex gap-2">
                    <Input type="time" value={v.inTime} disabled={!canEdit} onChange={(e) => set(r, { inTime: e.target.value })} aria-label={t('hrms.attendance.in')} />
                    <Input type="time" value={v.outTime} disabled={!canEdit} onChange={(e) => set(r, { outTime: e.target.value })} aria-label={t('hrms.attendance.out')} />
                  </div>
                ) : <span />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MonthView({ category }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const [month, setMonth] = useState(localIso(new Date()).slice(0, 7))
  const { data, isLoading, error } = useQuery({ queryKey: ['staff-month', month, category], queryFn: () => fetchStaffMonth(month, { category: category || undefined }) })
  const days = data?.days ?? []
  const cols = { gridTemplateColumns: `minmax(160px, 220px) repeat(${days.length}, 28px) repeat(4, 56px)` }
  const holidays = new Map((data?.holidays ?? []).map((h) => [h.date, h.name]))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44"><FormField label={t('hrms.attendance.month')}><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></FormField></div>
        {hasPermission('hrms.attendance.export') && <Button variant="secondary" icon={Download} onClick={() => exportStaffMonth(month, { category: category || undefined }).catch((e) => showError(e.message))}>{t('hrms.attendance.export')}</Button>}
      </div>
      {isLoading ? <p className="text-sm text-ink-faint">{t('hrms.loading')}</p> : error ? <Note tone="warning">{error.message}</Note> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <div className="grid w-max" style={cols}>
            <div className="sticky left-0 z-10 bg-bg px-3 py-2 text-xs font-semibold text-ink-muted border-b border-border">{t('hrms.attendance.person')}</div>
            {days.map((d) => <div key={d} title={holidays.get(d)} className={clsx('py-2 text-center text-[11px] font-mono-num border-b border-l border-border', holidays.has(d) ? 'bg-amber-50 text-amber-700' : 'bg-bg text-ink-muted')}>{Number(d.slice(8))}</div>)}
            {['paid', 'lop', 'late', 'unmarked'].map((k) => <div key={k} className="py-2 text-center text-[11px] font-semibold text-ink-muted bg-bg border-b border-l border-border">{t(`hrms.attendance.tot.${k}`)}</div>)}
            {(data?.rows ?? []).map((r) => (
              <div key={r.employeeId} className="contents">
                <div className="sticky left-0 z-10 flex items-center gap-2 bg-surface px-3 py-1.5 border-b border-border min-w-0">
                  <Avatar name={r.name} size={22} soft />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink truncate">{r.name}</p>
                    <p className="text-[10px] text-ink-faint truncate">{r.code}</p>
                  </div>
                </div>
                {days.map((d) => {
                  const c = r.cells[d]
                  return <div key={d} className={clsx('text-center text-[10px] font-semibold leading-[34px] border-b border-l border-border', c ? toneOf(c.status) : '', c?.late && 'underline decoration-amber-500')}>{c?.s ?? ''}</div>
                })}
                <div className="text-center text-xs font-mono-num leading-[34px] border-b border-l border-border">{r.totals.payable}</div>
                <div className={clsx('text-center text-xs font-mono-num leading-[34px] border-b border-l border-border', r.totals.lop > 0 && 'text-danger-600 font-semibold')}>{r.totals.lop}</div>
                <div className="text-center text-xs font-mono-num leading-[34px] border-b border-l border-border">{r.totals.late}</div>
                <div className={clsx('text-center text-xs font-mono-num leading-[34px] border-b border-l border-border', r.totals.unmarked > 0 && 'text-amber-700 font-semibold')}>{r.totals.unmarked}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-ink-faint">{t('hrms.attendance.legend')}</p>
    </div>
  )
}

/** Staff & HR › Staff attendance: mark the day, see the month, import the biometric file. */
export default function StaffAttendance() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const qc = useQueryClient()
  const [view, setView] = useState('day')
  const [category, setCategory] = useState('')
  const [importing, setImporting] = useState(false)
  return (
    <PageContainer>
      <PageHeader icon={CalendarCheck2} title={t('hrms.attendance.title')} subtitle={t('hrms.attendance.subtitle')}
        actions={hasPermission('hrms.attendance.import') && <HeaderButton icon={Upload} onClick={() => setImporting(true)}>{t('hrms.attendance.import')}</HeaderButton>} />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SegmentedControl value={view} onChange={setView} options={[{ value: 'day', label: t('hrms.attendance.day') }, { value: 'month', label: t('hrms.attendance.monthView') }]} />
        <ControlChip label={t('hrms.employees.category')} value={category ? L.category(category) : t('hrms.all')} active={!!category}
          options={[t('hrms.all'), ...EMPLOYEE_CATEGORIES.map((c) => L.category(c.value))]} onChange={(v) => setCategory(EMPLOYEE_CATEGORIES.find((c) => L.category(c.value) === v)?.value ?? '')} />
      </div>
      {view === 'day' ? <DayView category={category} /> : <MonthView category={category} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['staff-day'] }); qc.invalidateQueries({ queryKey: ['staff-month'] }) }} />}
    </PageContainer>
  )
}
