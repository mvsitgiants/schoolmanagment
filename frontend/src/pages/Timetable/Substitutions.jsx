import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search, Trash2, UserCheck, UserRoundX } from 'lucide-react'
import { ColorChip, DataTable, FormField, Input, Note, PageContainer, PageHeader, Panel, PersonCell, Select, localIso } from '../../components/system'
import Button from '../../components/ui/Button'
import { createSubstitution, deleteSubstitution, fetchAwayTeachers, fetchSubstitutionNeeds, fetchSubstitutions, fetchTimetableTeachers } from '../../api/timetable'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

/** One period that needs cover: the best free teachers first. */
function NeedRow({ need, date, canCreate, onDone }) {
  const { t } = useTranslation('timetable')
  const { showError } = useSnackbar()
  const [pick, setPick] = useState(need.suggestions[0]?.teacherId ?? '')
  const assign = useMutation({ mutationFn: () => createSubstitution({ date, sectionId: need.sectionId, period: need.period, substituteId: pick }), onSuccess: onDone, onError: (e) => showError(e.message) })
  const why = (s) => [s.teachesClass && t('timetable.subs.teachesClass'), s.sameSubject && t('timetable.subs.sameSubject'), t('timetable.subs.thisWeek', { count: s.thisWeek })].filter(Boolean).join(' · ')
  return (
    <div className="grid gap-2 sm:grid-cols-[70px_1.2fr_1fr_2fr] items-center px-4 py-3 border-b border-border last:border-0">
      <span className="text-sm font-semibold text-ink">{t('timetable.grid.period', { no: need.period })}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink truncate">{need.section}</p>
        <p className="text-xs text-ink-muted truncate">{need.subject}</p>
      </div>
      <p className="text-xs text-ink-muted truncate">{t('timetable.subs.absent', { name: need.absentTeacher })}</p>
      {need.covered ? (
        <p className="text-sm text-success-700 flex items-center gap-1.5"><UserCheck className="h-4 w-4" />{t('timetable.subs.coveredBy', { name: need.covered.name })}</p>
      ) : !need.suggestions.length ? (
        <p className="text-sm text-danger-600">{t('timetable.subs.nobodyFree')}</p>
      ) : canCreate ? (
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('timetable.subs.substitute')}>
              {need.suggestions.map((s) => <option key={s.teacherId} value={s.teacherId}>{`${s.name} — ${why(s)}`}</option>)}
            </Select>
          </div>
          <Button size="sm" loading={assign.isPending} disabled={!pick} onClick={() => assign.mutate()}>{t('timetable.subs.assign')}</Button>
        </div>
      ) : <p className="text-xs text-ink-faint">{t('timetable.subs.suggested', { name: need.suggestions[0].name })}</p>}
    </div>
  )
}

/** Substitutions: pick a date and who is away; cover each of their periods with a free teacher. */
export default function Substitutions() {
  const { t } = useTranslation('timetable')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const canCreate = hasPermission('timetable.substitutions.create')
  const [date, setDate] = useState(localIso(new Date()))
  const [absent, setAbsent] = useState([])
  const [asked, setAsked] = useState(null)
  const { data: teachers = [] } = useQuery({ queryKey: ['timetable-teachers'], queryFn: () => fetchTimetableTeachers() })
  const listQ = useQuery({ queryKey: ['substitutions', date], queryFn: () => fetchSubstitutions(date) })
  const { data: away = [] } = useQuery({ queryKey: ['substitutions-away', date], queryFn: () => fetchAwayTeachers(date) })
  // teachers on approved leave (Staff & HR) start ticked
  useEffect(() => { if (away.length) setAbsent((a) => [...new Set([...a, ...away.map((x) => x.userId)])]) }, [away])
  const needsQ = useQuery({ queryKey: ['substitution-needs', asked?.date, asked?.ids], queryFn: () => fetchSubstitutionNeeds(asked.date, asked.ids), enabled: !!asked, retry: false })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['substitutions'] }); qc.invalidateQueries({ queryKey: ['substitution-needs'] }) }
  const remove = useMutation({ mutationFn: deleteSubstitution, onSuccess: () => { refresh(); showSuccess(t('timetable.subs.removed')) }, onError: (e) => showError(e.message) })
  const toggle = (id) => setAbsent((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))
  const needs = needsQ.data ?? []
  const open = needs.filter((n) => !n.covered).length

  return (
    <PageContainer>
      <PageHeader icon={UserRoundX} title={t('timetable.subs.title')} subtitle={t('timetable.subs.subtitle')} />
      <div className="space-y-4">
        <Panel title={t('timetable.subs.who')}>
          <div className="space-y-3">
            <div className="w-full sm:w-56"><FormField label={t('timetable.subs.date')}><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setAsked(null); setAbsent([]) }} /></FormField></div>
            <div className="flex flex-wrap gap-2">
              {teachers.map((x) => (
                <label key={x.id} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm cursor-pointer ${absent.includes(x.id) ? 'border-danger-300 bg-danger-50 text-danger-700' : 'border-border hover:bg-bg'}`}>
                  <input type="checkbox" checked={absent.includes(x.id)} onChange={() => toggle(x.id)} className="rounded border-border text-danger-500 focus:ring-danger-500" />
                  {x.name}
                </label>
              ))}
              {!teachers.length && <p className="text-sm text-ink-faint">{t('timetable.subs.noTeachers')}</p>}
            </div>
            {away.length > 0 && <p className="text-xs text-ink-muted">{t('timetable.subs.onLeave', { names: away.map((x) => `${x.name} (${x.leaveCode})`).join(', ') })}</p>}
            <Button icon={Search} disabled={!absent.length || !date} onClick={() => setAsked({ date, ids: [...absent].sort() })}>{t('timetable.subs.find')}</Button>
          </div>
        </Panel>

        {asked && (
          needsQ.isLoading ? <p className="text-sm text-ink-faint">{t('timetable.loading')}</p>
            : needsQ.error ? <Note tone="warning">{needsQ.error.message}</Note>
              : !needs.length ? <Note>{t('timetable.subs.noPeriods')}</Note>
                : (
                  <Panel title={t('timetable.subs.needs')} subtitle={t('timetable.subs.needsCount', { count: open })} flush>
                    {needs.map((n) => <NeedRow key={`${n.sectionId}${n.period}`} need={n} date={asked.date} canCreate={canCreate} onDone={() => { refresh(); showSuccess(t('timetable.subs.assigned')) }} />)}
                  </Panel>
                )
        )}

        <Panel title={t('timetable.subs.booked')} flush>
          <DataTable rows={listQ.data ?? []} loading={listQ.isLoading} error={listQ.error} dense className="border-0 shadow-none" columns={[
            { key: 'period', header: t('timetable.subs.period'), align: 'right', width: 70 },
            { key: 'section', header: t('timetable.subs.section'), mobilePrimary: true, render: (v) => <ColorChip label={v} /> },
            { key: 'absentTeacher', header: t('timetable.subs.forTeacher'), render: (v) => <PersonCell name={v} size={26} /> },
            { key: 'substitute', header: t('timetable.subs.substitute'), render: (v, r) => <PersonCell name={v} sub={r.note || undefined} size={26} /> },
            { key: 'id', header: '', align: 'right', width: 60, render: (id) => canCreate && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('timetable.subs.remove')} loading={remove.isPending && remove.variables === id} onClick={() => remove.mutate(id)} /> },
          ]} emptyTitle={t('timetable.subs.noneBooked')} />
        </Panel>
      </div>
    </PageContainer>
  )
}
