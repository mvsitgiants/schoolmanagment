import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, CalendarClock, CalendarDays, CalendarHeart, ClipboardPaste, List, MapPin, Pencil, Plus, Sun, Trash2 } from 'lucide-react'
import { Calendar, ColorChip, ControlChip, DataTable, DateInput, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, SegmentedControl, StatCardRow, Textarea, localIso, useConfirm, useTimeAgo } from '../../components/system'
import Button from '../../components/ui/Button'
import { addHolidays, createHoliday, deleteHoliday, fetchHolidays, updateHoliday } from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useHrLabels, useHrMeta } from '../../components/hrms/HrKit'

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function HolidayForm({ holiday, defaultDate, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const { data: meta } = useHrMeta()
  const [form, setForm] = useState({ date: holiday?.date ?? defaultDate ?? '', name: holiday?.name ?? '', optional: holiday?.optional ?? false, forStudents: holiday?.forStudents ?? true, branchIds: holiday?.branchIds ?? [] })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({ mutationFn: () => (holiday ? updateHoliday(holiday.id, form) : createHoliday(form)), onSuccess: onSaved, onError: (e) => showError(e.message) })
  const branches = meta?.branches ?? []
  return (
    <Modal open onClose={onClose} title={holiday ? t('hrms.holidays.editTitle') : t('hrms.holidays.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.date || form.name.trim().length < 2} onClick={() => save.mutate()}>{t('hrms.holidays.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('hrms.holidays.date')} required><DateInput value={form.date} onChange={set('date')} /></FormField>
        <FormField label={t('hrms.holidays.name')} required><Input value={form.name} onChange={set('name')} placeholder={t('hrms.holidays.namePlaceholder')} /></FormField>
        <label className="col-span-2 inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.forStudents} onChange={set('forStudents')} className="rounded border-border text-brand-500" />{t('hrms.holidays.forStudents')}</label>
        <label className="col-span-2 inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.optional} onChange={set('optional')} className="rounded border-border text-brand-500" />{t('hrms.holidays.optional')}</label>
        {branches.length > 1 && (
          <div className="col-span-2">
            <p className="text-xs font-medium text-ink-muted mb-1.5">{t('hrms.holidays.campuses')}</p>
            <div className="flex flex-wrap gap-2">
              {branches.map((b) => (
                <label key={b.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
                  <input type="checkbox" checked={form.branchIds.includes(b.id)} onChange={() => setForm((f) => ({ ...f, branchIds: f.branchIds.includes(b.id) ? f.branchIds.filter((x) => x !== b.id) : [...f.branchIds, b.id] }))} className="rounded border-border text-brand-500" />{b.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-ink-faint mt-1">{t('hrms.holidays.campusesHint')}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Paste a list: one holiday a line, "2026-01-26 Republic Day" (or with a comma / tab). */
function PasteForm({ onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const [text, setText] = useState('')
  const rows = useMemo(() => text.split(/\r?\n/).map((l) => l.trim().match(/^(\d{4}-\d{2}-\d{2})[\s,;\t]+(.{2,80})$/)).filter(Boolean).map((m) => ({ date: m[1], name: m[2].trim() })), [text])
  const save = useMutation({ mutationFn: () => addHolidays(rows), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('hrms.holidays.pasteTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!rows.length} onClick={() => save.mutate()}>{t('hrms.holidays.pasteGo', { count: rows.length })}</Button>
    </>}>
      <p className="text-sm text-ink-muted mb-2">{t('hrms.holidays.pasteHint')}</p>
      <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'2026-01-26 Republic Day\n2026-03-04 Holi\n2026-08-15 Independence Day'} className="font-mono-num text-sm" />
    </Modal>
  )
}

/** Staff & HR › Holidays: the institution's holiday list (staff leave and attendance count around it). */
export default function Holidays() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [editing, setEditing] = useState(null)
  const [pasting, setPasting] = useState(false)
  const [view, setView] = useState('LIST')
  const [newOn, setNewOn] = useState(null)
  const [monthState, setMonthState] = useState(() => localIso(new Date()).slice(0, 7))
  const calMonth = monthState.startsWith(`${year}-`) ? monthState : `${year}-01`
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['holidays', year], queryFn: () => fetchHolidays(year) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['holidays'] })
  const remove = useMutation({ mutationFn: deleteHoliday, onSuccess: () => { refresh(); showSuccess(t('hrms.holidays.deleted')) }, onError: (e) => showError(e.message) })
  const years = [thisYear - 1, thisYear, thisYear + 1]
  const ago = useTimeAgo()
  const today = localIso(new Date())
  const upcoming = rows.filter((r) => r.date >= today)
  const closedDays = rows.filter((r) => !r.optional).length
  return (
    <PageContainer>
      <PageHeader icon={CalendarHeart} title={t('hrms.holidays.title')} subtitle={t('hrms.holidays.subtitle')}
        actions={<>
          <HeaderButton icon={ClipboardPaste} requires="hrms.holidays.create" onClick={() => setPasting(true)}>{t('hrms.holidays.paste')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="hrms.holidays.create" onClick={() => { setNewOn(null); setEditing('new') }}>{t('hrms.holidays.new')}</HeaderButton>
        </>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SegmentedControl value={view} onChange={setView} options={[{ value: 'LIST', label: t('hrms.holidays.viewList'), icon: List }, { value: 'MONTH', label: t('hrms.holidays.viewMonth'), icon: CalendarDays }]} />
        <ControlChip label={t('hrms.holidays.year')} value={String(year)} active={year !== thisYear} options={years.map(String)} onChange={(v) => setYear(Number(v))} />
      </div>
      {!isLoading && !rows.length && <Note className="mb-3">{t('hrms.holidays.emptyHint')}</Note>}
      {rows.length > 0 && (
        <StatCardRow className="mb-4" items={[
          { icon: CalendarHeart, tone: 'pink', label: t('hrms.holidays.stats.total'), value: rows.length, sub: String(year) },
          { icon: Sun, tone: 'success', label: t('hrms.holidays.stats.closed'), value: closedDays, progress: (closedDays / rows.length) * 100 },
          { icon: CalendarCheck, tone: 'info', label: t('hrms.holidays.stats.optional'), value: rows.length - closedDays, progress: ((rows.length - closedDays) / rows.length) * 100 },
          { icon: CalendarClock, tone: 'orange', label: t('hrms.holidays.stats.upcoming'), value: upcoming.length, sub: upcoming[0] ? t('hrms.holidays.stats.next', { name: upcoming[0].name, when: ago(upcoming[0].date) }) : undefined },
        ]} />
      )}
      {view === 'MONTH' ? (
        // closed days shade the calendar; optional holidays sit on it as items; a day's panel adds one on that day
        <Calendar month={calMonth} minMonth={`${years[0]}-01`} maxMonth={`${years.at(-1)}-12`} loading={isLoading}
          onMonthChange={(ym) => { setMonthState(ym); if (Number(ym.slice(0, 4)) !== year) setYear(Number(ym.slice(0, 4))) }}
          holidays={rows.filter((r) => !r.optional).map((r) => ({ date: r.date, name: r.forStudents ? r.name : `${r.name} · ${t('hrms.holidays.staffOnly')}`, onClick: hasPermission('hrms.holidays.edit') ? () => setEditing(r) : undefined }))}
          items={rows.filter((r) => r.optional).map((r) => ({ id: r.id, date: r.date, title: r.name, kind: t('hrms.holidays.optionalShort'), icon: CalendarCheck, sub: r.branches?.length ? r.branches.join(', ') : undefined, onClick: hasPermission('hrms.holidays.edit') ? () => setEditing(r) : undefined }))}
          legend={[{ tone: 'neutral', label: t('hrms.holidays.optionalShort') }]}
          onAdd={hasPermission('hrms.holidays.create') ? (d) => { setNewOn(d); setEditing('new') } : undefined} addLabel={t('hrms.holidays.new')} />
      ) : <DataTable rows={rows} loading={isLoading} columns={[
        { key: 'date', header: t('hrms.holidays.date'), nowrap: true, render: (v) => {
          const past = v < today
          return (
            <span className={`inline-flex items-center gap-2.5 ${past ? 'opacity-60' : ''}`}>
              <span className={`inline-flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border leading-none ${past ? 'border-border bg-bg text-ink-muted' : 'border-pink-200 bg-pink-50 text-pink-700'}`}>
                <span className="text-[15px] font-bold tabular-nums">{Number(v.slice(8, 10))}</span>
                <span className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wide">{L.day(DOW[new Date(`${v}T12:00:00Z`).getUTCDay()])}</span>
              </span>
              <span className="leading-tight">
                <span className="block tabular-nums text-ink">{date(v)}</span>
                <span className="block text-[11px] text-ink-faint">{ago(v)}</span>
              </span>
            </span>
          )
        } },
        { key: 'name', header: t('hrms.holidays.name'), mobilePrimary: true, render: (v) => <span className="font-medium text-ink">{v}</span> },
        { key: 'optional', header: t('hrms.holidays.kind'), render: (v, r) => <span className="flex flex-wrap gap-1">{v ? <ColorChip label={t('hrms.holidays.optionalShort')} tone="info" icon={CalendarCheck} /> : <ColorChip label={t('hrms.holidays.closed')} tone="success" icon={Sun} />}{!r.forStudents && <ColorChip label={t('hrms.holidays.staffOnly')} tone="neutral" dot />}</span> },
        { key: 'branches', header: t('hrms.holidays.campusesCol'), render: (v) => (v?.length ? <span className="flex flex-wrap gap-1">{v.map((b) => <ColorChip key={b} label={b} icon={MapPin} />)}</span> : <span className="text-sm text-ink-muted">{t('hrms.holidays.everywhere')}</span>) },
        { key: 'id', header: '', align: 'right', width: 100, render: (_, r) => (
          <div className="flex justify-end gap-1">
            {hasPermission('hrms.holidays.edit') && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('hrms.edit')} onClick={() => setEditing(r)} />}
            {hasPermission('hrms.holidays.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('hrms.holidays.delete')}
              onClick={async () => { if (await confirm({ title: t('hrms.holidays.deleteConfirm', { name: r.name }), confirmLabel: t('hrms.holidays.delete'), tone: 'danger' })) remove.mutate(r.id) }} />}
          </div>
        ) },
      ]} emptyIcon={CalendarHeart} emptyTitle={t('hrms.holidays.empty', { year })} />}
      {editing && <HolidayForm holiday={editing === 'new' ? null : editing} defaultDate={newOn} onClose={() => { setEditing(null); setNewOn(null) }} onSaved={() => { setEditing(null); setNewOn(null); refresh(); showSuccess(t('hrms.holidays.saved')) }} />}
      {pasting && <PasteForm onClose={() => setPasting(false)} onSaved={(r) => { setPasting(false); refresh(); showSuccess(t('hrms.holidays.added', { count: r.added })) }} />}
    </PageContainer>
  )
}
