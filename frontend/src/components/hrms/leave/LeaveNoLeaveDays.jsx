import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarOff, Palmtree, Plus, Sparkles, Trash2 } from 'lucide-react'
import { EMPLOYEE_CATEGORIES, NO_LEAVE_MODES } from '@schoolgiant/shared'
import { DateInput, DataTable, FormField, Input, Modal, Panel, Select, localIso, useConfirm } from '../../system'
import Button from '../../ui/Button'
import { createNoLeaveDay, deleteNoLeaveDay, fetchNoLeaveDays, fetchNoLeaveSuggestions, updateNoLeaveDay } from '../../../api/hrms'
import { hasPermission } from '../../../api/auth'
import { useSnackbar } from '../../../context/SnackbarContext'
import { useHrLabels } from '../HrKit'
import { fieldErrors, invalidateLeave, useLeaveDates } from './LeaveBits'
import { Checks } from './LeavePolicies'

// Leave › Setup › No-leave days and vacations. No-leave days: exams, the annual day, parent–teacher meetings — leave
// on them is warned about, needs the principal or HR, or isn't allowed (staff can't ask; HR can still enter it).
// School vacations: not working days for the staff they cover (usually teachers), so leave isn't counted on them,
// and monthly earned leave pauses in a month that is mostly vacation. Exams, events and PTMs on the school calendar
// are offered to add in one click.

const KEY = ['leave-no-leave-days']

function DayModal({ day, kind, onClose, onDone }) {
  const { t } = useTranslation('hrmsLeave')
  const L = useHrLabels()
  const { showError } = useSnackbar()
  const x = day ?? {}
  const [f, setF] = useState({ kind: x.kind ?? kind, name: x.name ?? '', from: x.from ?? '', to: x.to ?? '', mode: x.mode ?? 'WARN', categories: x.categories ?? (kind === 'VACATION' ? ['TEACHING'] : []), source: x.source?.id ? x.source : undefined })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e?.target ? e.target.value : e }))
  const save = useMutation({
    mutationFn: () => {
      const body = { kind: f.kind, name: f.name.trim(), from: f.from, to: f.to || f.from, categories: f.categories, ...(f.kind === 'NO_LEAVE' && { mode: f.mode }), ...(f.source?.id && { source: { type: f.source.type, id: f.source.id } }) }
      return day?.id ? updateNoLeaveDay(day.id, body) : createNoLeaveDay(body)
    },
    onSuccess: onDone,
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  const vacation = f.kind === 'VACATION'
  return (
    <Modal open onClose={onClose} title={day?.id ? t('hrmsLeave.noLeave.editTitle', { name: x.name }) : vacation ? t('hrmsLeave.noLeave.newVacation') : t('hrmsLeave.noLeave.newTitle')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={f.name.trim().length < 2 || !f.from} onClick={() => save.mutate()}>{t('actions.save')}</Button></>}>
      <div className="space-y-3">
        <FormField label={t('hrmsLeave.noLeave.name')} required error={errors.name}><Input value={f.name} onChange={set('name')} maxLength={80} placeholder={vacation ? t('hrmsLeave.noLeave.vacationPlaceholder') : t('hrmsLeave.noLeave.namePlaceholder')} /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('hrmsLeave.noLeave.from')} required error={errors.from}><DateInput value={f.from} onChange={(e) => { const from = e.target.value; setF((v) => ({ ...v, from, to: !v.to || v.to < from ? from : v.to })) }} /></FormField>
          <FormField label={t('hrmsLeave.noLeave.to')} error={errors.to}><DateInput value={f.to} min={f.from || undefined} onChange={set('to')} /></FormField>
        </div>
        {!vacation && (
          <FormField label={t('hrmsLeave.noLeave.mode')} hint={t(`hrmsLeave.noLeave.modeHint.${f.mode}`)}>
            <Select value={f.mode} onChange={set('mode')}>{NO_LEAVE_MODES.map((m) => <option key={m.value} value={m.value}>{t(`hrmsLeave.noLeave.modes.${m.value}`)}</option>)}</Select>
          </FormField>
        )}
        <FormField label={t('hrmsLeave.noLeave.who')} hint={vacation ? t('hrmsLeave.noLeave.whoVacationHint') : t('hrmsLeave.noLeave.whoHint')}>
          <Checks options={EMPLOYEE_CATEGORIES.map((c) => ({ value: c.value, label: L.category(c.value) }))} value={f.categories} onChange={set('categories')} />
        </FormField>
      </div>
    </Modal>
  )
}

export default function LeaveNoLeaveDays() {
  const { t } = useTranslation('hrmsLeave')
  const L = useHrLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const dates = useLeaveDates()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null) // { day?, kind }
  const canEdit = hasPermission('hrms.leave.edit')
  const from = `${Number(localIso(new Date()).slice(0, 4)) - 1}${localIso(new Date()).slice(4)}`
  const { data: rows = [], isLoading } = useQuery({ queryKey: [...KEY, from], queryFn: () => fetchNoLeaveDays({ from }) })
  const { data: ideas = [] } = useQuery({ queryKey: [...KEY, 'ideas'], queryFn: fetchNoLeaveSuggestions, enabled: canEdit })
  const done = () => { qc.invalidateQueries({ queryKey: KEY }); invalidateLeave(qc) }
  const remove = async (d) => {
    if (!(await confirm({ title: t('hrmsLeave.noLeave.deleteTitle', { name: d.name }), message: t('hrmsLeave.noLeave.deleteMsg'), tone: 'danger', confirmLabel: t('actions.delete') }))) return
    try { await deleteNoLeaveDay(d.id); showSuccess(t('hrmsLeave.noLeave.deleted')); done() } catch (e) { showError(e.message) }
  }
  const who = (d) => (d.categories?.length ? d.categories.map(L.category).join(', ') : t('hrmsLeave.noLeave.everyone'))
  const today = localIso(new Date())
  const table = (kind) => (
    <DataTable dense rows={rows.filter((d) => d.kind === kind)} loading={isLoading} onRowClick={canEdit ? (d) => setEditing({ day: d, kind }) : undefined}
      emptyIcon={kind === 'VACATION' ? Palmtree : CalendarOff} emptyTitle={kind === 'VACATION' ? t('hrmsLeave.noLeave.emptyVacation') : t('hrmsLeave.noLeave.empty')}
      columns={[
        { key: 'name', header: t('hrmsLeave.noLeave.name'), mobilePrimary: true, render: (v, d) => <span className={d.to < today ? 'text-ink-faint' : 'font-medium text-ink'}>{v}</span> },
        { key: 'from', header: t('hrmsLeave.noLeave.when'), nowrap: true, render: (_, d) => dates(d) },
        kind === 'NO_LEAVE' && { key: 'mode', header: t('hrmsLeave.noLeave.mode'), render: (v) => <span className="text-xs text-ink">{t(`hrmsLeave.noLeave.modesShort.${v ?? 'WARN'}`)}</span> },
        { key: 'categories', header: t('hrmsLeave.noLeave.who'), mobileHidden: true, render: (_, d) => <span className="text-xs text-ink-muted">{who(d)}</span> },
        { key: 'id', header: '', align: 'right', render: (_, d) => canEdit && <button type="button" onClick={(e) => { e.stopPropagation(); remove(d) }} className="p-1.5 text-ink-faint hover:text-danger-600" aria-label={t('hrmsLeave.noLeave.deleteAria', { name: d.name })}><Trash2 className="w-4 h-4" /></button> },
      ].filter(Boolean)} />
  )
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted max-w-3xl">{t('hrmsLeave.noLeave.intro')}</p>
      <Panel title={t('hrmsLeave.noLeave.title')} subtitle={t('hrmsLeave.noLeave.subtitle')} icon={CalendarOff} iconTone="neutral" flush
        actions={canEdit && <Button size="sm" icon={Plus} onClick={() => setEditing({ kind: 'NO_LEAVE' })}>{t('hrmsLeave.noLeave.add')}</Button>}>
        {table('NO_LEAVE')}
      </Panel>
      {canEdit && ideas.length > 0 && (
        <Panel title={t('hrmsLeave.noLeave.ideasTitle')} subtitle={t('hrmsLeave.noLeave.ideasSub')} icon={Sparkles} iconTone="neutral">
          <ul className="divide-y divide-border">
            {ideas.slice(0, 8).map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink">{x.name}</p>
                  <p className="text-[11px] text-ink-faint">{t(`hrmsLeave.noLeave.sources.${x.type}`)} · {dates(x)}</p>
                </div>
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing({ kind: 'NO_LEAVE', day: { kind: 'NO_LEAVE', name: x.name, from: x.from, to: x.to, mode: x.type === 'EXAM' ? 'HR' : 'WARN', categories: x.type === 'EXAM' || x.type === 'PTM' ? ['TEACHING'] : [], source: { type: x.type, id: x.id } } })}>{t('hrmsLeave.noLeave.addThis')}</Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title={t('hrmsLeave.noLeave.vacationTitle')} subtitle={t('hrmsLeave.noLeave.vacationSub')} icon={Palmtree} iconTone="neutral" flush
        actions={canEdit && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing({ kind: 'VACATION' })}>{t('hrmsLeave.noLeave.addVacation')}</Button>}>
        {table('VACATION')}
      </Panel>
      {editing && <DayModal day={editing.day} kind={editing.kind} onClose={() => setEditing(null)} onDone={() => { setEditing(null); showSuccess(t('hrmsLeave.noLeave.saved')); done() }} />}
    </div>
  )
}
