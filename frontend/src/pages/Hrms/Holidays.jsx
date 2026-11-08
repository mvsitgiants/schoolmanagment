import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarHeart, ClipboardPaste, Pencil, Plus, Trash2 } from 'lucide-react'
import { ControlChip, DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, StatusPill, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { addHolidays, createHoliday, deleteHoliday, fetchHolidays, updateHoliday } from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useHrLabels, useHrMeta } from '../../components/hrms/HrKit'

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function HolidayForm({ holiday, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const { data: meta } = useHrMeta()
  const [form, setForm] = useState({ date: holiday?.date ?? '', name: holiday?.name ?? '', optional: holiday?.optional ?? false, forStudents: holiday?.forStudents ?? true, branchIds: holiday?.branchIds ?? [] })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({ mutationFn: () => (holiday ? updateHoliday(holiday.id, form) : createHoliday(form)), onSuccess: onSaved, onError: (e) => showError(e.message) })
  const branches = meta?.branches ?? []
  return (
    <Modal open onClose={onClose} title={holiday ? t('hrms.holidays.editTitle') : t('hrms.holidays.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.date || form.name.trim().length < 2} onClick={() => save.mutate()}>{t('hrms.holidays.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('hrms.holidays.date')} required><Input type="date" value={form.date} onChange={set('date')} /></FormField>
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
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['holidays', year], queryFn: () => fetchHolidays(year) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['holidays'] })
  const remove = useMutation({ mutationFn: deleteHoliday, onSuccess: () => { refresh(); showSuccess(t('hrms.holidays.deleted')) }, onError: (e) => showError(e.message) })
  const years = [thisYear - 1, thisYear, thisYear + 1]
  return (
    <PageContainer>
      <PageHeader icon={CalendarHeart} title={t('hrms.holidays.title')} subtitle={t('hrms.holidays.subtitle')}
        actions={<>
          <HeaderButton icon={ClipboardPaste} requires="hrms.holidays.create" onClick={() => setPasting(true)}>{t('hrms.holidays.paste')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="hrms.holidays.create" onClick={() => setEditing('new')}>{t('hrms.holidays.new')}</HeaderButton>
        </>} />
      <div className="mb-3"><ControlChip label={t('hrms.holidays.year')} value={String(year)} active={year !== thisYear} options={years.map(String)} onChange={(v) => setYear(Number(v))} /></div>
      {!isLoading && !rows.length && <Note className="mb-3">{t('hrms.holidays.emptyHint')}</Note>}
      <DataTable rows={rows} loading={isLoading} columns={[
        { key: 'date', header: t('hrms.holidays.date'), nowrap: true, render: (v) => <span>{date(v)} <span className="text-xs text-ink-faint">{L.day(DOW[new Date(`${v}T12:00:00Z`).getUTCDay()])}</span></span> },
        { key: 'name', header: t('hrms.holidays.name'), mobilePrimary: true },
        { key: 'optional', header: t('hrms.holidays.kind'), render: (v, r) => <span className="flex flex-wrap gap-1">{v ? <StatusPill tone="info">{t('hrms.holidays.optionalShort')}</StatusPill> : <StatusPill tone="success">{t('hrms.holidays.closed')}</StatusPill>}{!r.forStudents && <StatusPill tone="neutral">{t('hrms.holidays.staffOnly')}</StatusPill>}</span> },
        { key: 'branches', header: t('hrms.holidays.campusesCol'), render: (v) => (v?.length ? v.join(', ') : t('hrms.holidays.everywhere')) },
        { key: 'id', header: '', align: 'right', width: 100, render: (_, r) => (
          <div className="flex justify-end gap-1">
            {hasPermission('hrms.holidays.edit') && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('hrms.edit')} onClick={() => setEditing(r)} />}
            {hasPermission('hrms.holidays.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('hrms.holidays.delete')}
              onClick={async () => { if (await confirm({ title: t('hrms.holidays.deleteConfirm', { name: r.name }), confirmLabel: t('hrms.holidays.delete'), tone: 'danger' })) remove.mutate(r.id) }} />}
          </div>
        ) },
      ]} emptyIcon={CalendarHeart} emptyTitle={t('hrms.holidays.empty', { year })} />
      {editing && <HolidayForm holiday={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); showSuccess(t('hrms.holidays.saved')) }} />}
      {pasting && <PasteForm onClose={() => setPasting(false)} onSaved={(r) => { setPasting(false); refresh(); showSuccess(t('hrms.holidays.added', { count: r.added })) }} />}
    </PageContainer>
  )
}
