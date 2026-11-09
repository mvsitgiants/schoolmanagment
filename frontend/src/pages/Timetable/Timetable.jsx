import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, FilePlus2, Lock, LockOpen, Plus, Send, Settings2, Trash2, Wand2, X } from 'lucide-react'
import { TIMETABLE_STATUS, WEEK_DAYS } from '@schoolgiant/shared'
import { ColorChip, DataTable, DateCell, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, PersonCell, ProgressBar, SegmentedControl, Select, StatusPill, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import WeekGrid from '../../components/timetable/WeekGrid'
import { fetchAcademicLookup } from '../../api/academics'
import {
  fetchMyTimetable, fetchRooms, fetchTeacherLoad, fetchTimetableGrid, fetchTimetableOverview, fetchTimetableTeachers, generateTimetable, lockTimetableSection,
  publishTimetable, saveTimetableRules, setTimetableCell, startTimetableDraft,
} from '../../api/timetable'
import { getCurrentUser, hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const statusLabel = (t, s) => t(`timetable.status.${s}`, TIMETABLE_STATUS[s]?.label ?? s)

/** Put a subject, teacher and room in one cell of the draft, or clear it. */
function CellEditor({ timetableId, sectionId, day, period, cell, rooms, teachers, subjects, onClose, onSaved }) {
  const { t } = useTranslation('timetable')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ subjectId: cell?.subjectId ?? '', teacherId: cell?.teacherId ?? '', roomId: cell?.roomId ?? '', locked: cell ? cell.locked : true })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: (clear) => setTimetableCell(timetableId, { sectionId, day, period, clear, subjectId: form.subjectId || null, teacherId: form.teacherId || null, roomId: form.roomId || null, locked: form.locked }),
    onSuccess: onSaved,
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('timetable.cell.title', { day: t(`timetable.days.${day}`), period })} footer={<>
      {cell && <Button variant="ghost" icon={Trash2} className="mr-auto" loading={save.isPending && save.variables} onClick={() => save.mutate(true)}>{t('timetable.cell.clear')}</Button>}
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending && !save.variables} disabled={!form.subjectId} onClick={() => save.mutate(false)}>{t('timetable.cell.save')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('timetable.cell.subject')} required>
          <Select value={form.subjectId} onChange={set('subjectId')}>
            <option value="">{t('timetable.cell.pickSubject')}</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t('timetable.cell.teacher')}>
          <Select value={form.teacherId} onChange={set('teacherId')}>
            <option value="">{t('timetable.cell.noTeacher')}</option>
            {teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t('timetable.cell.room')}>
          <Select value={form.roomId} onChange={set('roomId')}>
            <option value="">{t('timetable.cell.noRoom')}</option>
            {rooms.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.code ? `${r.code} · ${r.name}` : r.name}</option>)}
          </Select>
        </FormField>
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.locked} onChange={(e) => setForm((f) => ({ ...f, locked: e.target.checked }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
          {t('timetable.cell.lock')}
        </label>
        <p className="text-xs text-ink-faint">{t('timetable.cell.lockHint')}</p>
      </div>
    </Modal>
  )
}

/** The draft's rules: how often a subject may repeat in a day, a teacher's daily limit, and when teachers can't teach. */
function RulesForm({ draft, teachers, onClose, onSaved }) {
  const { t } = useTranslation('timetable')
  const { showError } = useSnackbar()
  const [rules, setRules] = useState({ maxSamePerDay: String(draft.rules?.maxSamePerDay ?? 2), teacherMaxPerDay: String(draft.rules?.teacherMaxPerDay ?? 6) })
  const [blocked, setBlocked] = useState(draft.blocked ?? [])
  const [note, setNote] = useState(draft.note ?? '')
  const [add, setAdd] = useState({ teacherId: '', day: 'MON', period: '1' })
  const name = useMemo(() => new Map(teachers.map((x) => [x.id, x.name])), [teachers])
  const save = useMutation({
    mutationFn: () => saveTimetableRules(draft.id, { rules: { maxSamePerDay: Number(rules.maxSamePerDay), teacherMaxPerDay: Number(rules.teacherMaxPerDay) }, blocked, note }),
    onSuccess: onSaved,
    onError: (e) => showError(e.message),
  })
  const addBlock = () => {
    if (!add.teacherId) return
    const b = { teacherId: add.teacherId, day: add.day, period: Number(add.period) }
    setBlocked((x) => (x.some((y) => y.teacherId === b.teacherId && y.day === b.day && y.period === b.period) ? x : [...x, b]))
  }
  return (
    <Modal open onClose={onClose} size="lg" title={t('timetable.rules.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('timetable.rules.save')}</Button>
    </>}>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('timetable.rules.maxSame')} hint={t('timetable.rules.maxSameHint')}><Input type="number" min="1" max="4" value={rules.maxSamePerDay} onChange={(e) => setRules((r) => ({ ...r, maxSamePerDay: e.target.value }))} /></FormField>
          <FormField label={t('timetable.rules.teacherMax')} hint={t('timetable.rules.teacherMaxHint')}><Input type="number" min="1" max="12" value={rules.teacherMaxPerDay} onChange={(e) => setRules((r) => ({ ...r, teacherMaxPerDay: e.target.value }))} /></FormField>
        </div>
        <div>
          <p className="text-sm font-medium text-ink">{t('timetable.rules.blocked')}</p>
          <p className="text-xs text-ink-muted mb-2">{t('timetable.rules.blockedHint')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-[1.6fr_1fr_.8fr_auto] gap-2 items-end">
            <Select value={add.teacherId} onChange={(e) => setAdd((a) => ({ ...a, teacherId: e.target.value }))}>
              <option value="">{t('timetable.rules.pickTeacher')}</option>
              {teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
            <Select value={add.day} onChange={(e) => setAdd((a) => ({ ...a, day: e.target.value }))}>
              {WEEK_DAYS.map((d) => <option key={d} value={d}>{t(`timetable.days.${d}`)}</option>)}
            </Select>
            <Input type="number" min="1" max="15" value={add.period} onChange={(e) => setAdd((a) => ({ ...a, period: e.target.value }))} aria-label={t('timetable.rules.period')} />
            <Button size="sm" variant="secondary" icon={Plus} disabled={!add.teacherId} onClick={addBlock}>{t('timetable.rules.add')}</Button>
          </div>
          {blocked.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {blocked.map((b, i) => (
                <span key={`${b.teacherId}${b.day}${b.period}`} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
                  {t('timetable.rules.blockedItem', { name: name.get(b.teacherId) ?? '?', day: t(`timetable.days.${b.day}`), period: b.period })}
                  <button type="button" aria-label={t('timetable.rules.remove')} onClick={() => setBlocked((x) => x.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
        </div>
        <FormField label={t('timetable.rules.note')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </div>
    </Modal>
  )
}

/** Who teaches how much this week, against what their allocations ask for. */
function LoadPanel({ timetableId }) {
  const { t } = useTranslation('timetable')
  const { data = [], isLoading } = useQuery({ queryKey: ['timetable-load', timetableId], queryFn: () => fetchTeacherLoad(timetableId) })
  return (
    <Panel title={t('timetable.load.title')} subtitle={t('timetable.load.subtitle')} flush>
      <DataTable rows={data} loading={isLoading} dense rowKey="teacherId" className="border-0 shadow-none" columns={[
        { key: 'name', header: t('timetable.load.teacher'), mobilePrimary: true, render: (v) => <PersonCell name={v} size={26} /> },
        { key: 'periods', header: t('timetable.load.periods'), align: 'right', render: (v, r) => <span className={v < r.wanted ? 'text-danger-600 font-medium' : ''}>{t('timetable.load.ofWanted', { n: v, wanted: r.wanted })}</span> },
        { key: 'wanted', header: '', width: 160, render: (v, r) => <ProgressBar value={v ? Math.min(100, Math.round((r.periods / v) * 100)) : 0} /> },
      ]} emptyTitle={t('timetable.load.empty')} />
    </Panel>
  )
}

/** A teacher's own week, from the published timetable, with the classes they cover soon. */
function MyWeek() {
  const { t } = useTranslation('timetable')
  const { data, isLoading } = useQuery({ queryKey: ['timetable-mine'], queryFn: fetchMyTimetable })
  if (isLoading) return <p className="text-sm text-ink-faint">{t('timetable.loading')}</p>
  if (!data?.timetable) return <Note>{t('timetable.mine.none')}</Note>
  return (
    <div className="space-y-4">
      <WeekGrid days={data.days} slots={data.slots} cells={data.cells} show="section" />
      {data.covering?.length > 0 && (
        <Panel title={t('timetable.mine.covering')} flush>
          <DataTable rows={data.covering} dense className="border-0 shadow-none" columns={[
            { key: 'date', header: t('timetable.subs.date'), nowrap: true, render: (v) => <DateCell value={v} /> },
            { key: 'period', header: t('timetable.subs.period'), align: 'right' },
            { key: 'section', header: t('timetable.subs.section'), mobilePrimary: true, render: (v) => <ColorChip label={v} /> },
            { key: 'forTeacher', header: t('timetable.subs.forTeacher'), render: (v) => <PersonCell name={v} size={26} /> },
          ]} />
        </Panel>
      )}
    </div>
  )
}

/** Timetable: generate the year's draft from the teacher allocations, adjust it, publish it. */
export default function Timetable() {
  const { t } = useTranslation('timetable')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const canEdit = hasPermission('timetable.timetable.edit')
  const canPublish = hasPermission('timetable.timetable.publish')
  const me = getCurrentUser()?.user?.id
  // a link (class board, room board) can open one class's, teacher's or room's week: ?sectionId= / ?teacherId= / ?roomId=
  const [params] = useSearchParams()
  const linked = params.get('sectionId') ? ['section', params.get('sectionId')] : params.get('teacherId') ? ['teacher', params.get('teacherId')] : params.get('roomId') ? ['room', params.get('roomId')] : null
  const [mode, setMode] = useState(canEdit || linked ? 'all' : 'mine')
  const [which, setWhich] = useState(linked ? 'published' : 'draft')
  const [view, setView] = useState(linked?.[0] ?? 'section')
  const [of, setOf] = useState(linked?.[1] ?? '')
  const [editing, setEditing] = useState(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [lastRun, setLastRun] = useState(null)

  const { data: ov, isLoading } = useQuery({ queryKey: ['timetable'], queryFn: () => fetchTimetableOverview() })
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const { data: teachers = [] } = useQuery({ queryKey: ['timetable-teachers'], queryFn: () => fetchTimetableTeachers() })
  const { data: rooms = [] } = useQuery({ queryKey: ['rooms'], queryFn: fetchRooms, enabled: canEdit })
  const tt = which === 'draft' ? ov?.draft ?? ov?.published : ov?.published ?? ov?.draft
  const isDraft = tt?.status === 'DRAFT'
  const sections = useMemo(() => (lookup?.sections ?? []).filter((s) => canEdit || s.mine), [lookup, canEdit])
  const options = view === 'section' ? sections.map((s) => ({ value: s.id, label: s.label }))
    : view === 'teacher' ? teachers.map((x) => ({ value: x.id, label: x.name }))
      : rooms.map((r) => ({ value: r.id, label: r.code ? `${r.code} · ${r.name}` : r.name }))
  useEffect(() => { if (options.length && !options.some((o) => o.value === of)) setOf(view === 'teacher' && me ? me : options[0]?.value ?? '') }, [view, options.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const gridQ = useQuery({ queryKey: ['timetable-grid', tt?.id, view, of], queryFn: () => fetchTimetableGrid(tt.id, view, of), enabled: !!tt?.id && !!of && mode === 'all' })
  const refresh = () => ['timetable', 'timetable-grid', 'timetable-load'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, v) => { refresh(); v.after?.(r); if (v.done) showSuccess(v.done) }, onError: (e) => showError(e.message) })

  const start = () => act.mutate({ fn: () => startTimetableDraft(ov?.year?.id), done: t('timetable.draftStarted'), after: () => setWhich('draft') })
  const generate = async () => {
    if (tt.entries > 0 && !await confirm({ title: t('timetable.generateConfirm.title'), message: t('timetable.generateConfirm.message'), confirmLabel: t('timetable.generate') })) return
    act.mutate({ fn: () => generateTimetable(tt.id), after: (r) => { setLastRun(r); showSuccess(t('timetable.generated', { placed: r.placed, wanted: r.wanted })) } })
  }
  const publish = async () => {
    if (!await confirm({ title: t('timetable.publishConfirm.title', { v: tt.version }), message: t('timetable.publishConfirm.message'), confirmLabel: t('timetable.publish') })) return
    act.mutate({ fn: () => publishTimetable(tt.id), done: t('timetable.published'), after: () => setWhich('published') })
  }
  const unplaced = lastRun?.unplaced ?? (isDraft ? tt?.unplaced : []) ?? []

  return (
    <PageContainer>
      <PageHeader icon={CalendarDays} title={t('timetable.title')} subtitle={ov?.year ? t('timetable.subtitle', { year: ov.year.name }) : t('timetable.subtitleNoYear')}
        actions={<>
          {canEdit && ov && !ov.draft && <HeaderButton icon={FilePlus2} variant="primary" onClick={start}>{ov.published ? t('timetable.newDraft') : t('timetable.startDraft')}</HeaderButton>}
          {isDraft && canEdit && <HeaderButton icon={Settings2} onClick={() => setRulesOpen(true)}>{t('timetable.rules.open')}</HeaderButton>}
          {isDraft && canEdit && <HeaderButton icon={Wand2} variant={tt.entries ? 'default' : 'primary'} onClick={generate}>{t('timetable.generate')}</HeaderButton>}
          {isDraft && canPublish && tt.entries > 0 && <HeaderButton icon={Send} variant="primary" onClick={publish}>{t('timetable.publish')}</HeaderButton>}
        </>} />

      {canEdit && <SegmentedControl className="mb-4" value={mode} onChange={setMode} options={[{ value: 'all', label: t('timetable.mode.all') }, { value: 'mine', label: t('timetable.mode.mine') }]} />}

      {mode === 'mine' ? <MyWeek /> : isLoading ? <p className="text-sm text-ink-faint">{t('timetable.loading')}</p> : !tt ? (
        <Note>{canEdit ? t('timetable.emptyEdit') : t('timetable.empty')}</Note>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {ov.draft && ov.published && <SegmentedControl value={which} onChange={setWhich} options={[{ value: 'draft', label: t('timetable.which.draft', { v: ov.draft.version }) }, { value: 'published', label: t('timetable.which.published', { v: ov.published.version }) }]} />}
            <StatusPill tone={TIMETABLE_STATUS[tt.status]?.tone}>{statusLabel(t, tt.status)}</StatusPill>
            <span className="text-xs text-ink-muted">
              {tt.status === 'PUBLISHED' ? t('timetable.publishedOn', { date: date(tt.effectiveFrom), by: tt.publishedBy ?? '' }) : tt.generatedAt ? t('timetable.generatedBy', { by: tt.generatedBy ?? '' }) : t('timetable.notGenerated')}
            </span>
          </div>

          {isDraft && unplaced.length > 0 && (
            <Note tone="warning">
              <p className="font-medium mb-1">{t('timetable.unplaced.title', { count: unplaced.reduce((n, u) => n + u.missing, 0) })}</p>
              <ul className="list-disc pl-5 text-sm space-y-0.5">
                {unplaced.slice(0, 12).map((u) => <li key={`${u.sectionId}${u.subjectId}${u.teacherId}`}>{t('timetable.unplaced.item', { section: u.section, subject: u.subject, teacher: u.teacher, count: u.missing })}</li>)}
              </ul>
              <p className="text-xs mt-2">{t('timetable.unplaced.hint')}</p>
            </Note>
          )}
          {isDraft && !tt.entries && <Note>{t('timetable.draftEmptyHint')}</Note>}

          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl value={view} onChange={setView} options={[
              { value: 'section', label: t('timetable.view.section') },
              { value: 'teacher', label: t('timetable.view.teacher') },
              ...(canEdit ? [{ value: 'room', label: t('timetable.view.room') }] : []),
            ]} />
            <div className="w-full sm:w-64">
              <Select value={of} onChange={(e) => setOf(e.target.value)} aria-label={t(`timetable.view.${view}`)}>
                {!options.length && <option value="">{t('timetable.nothingToPick')}</option>}
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            {isDraft && canEdit && view === 'section' && of && <>
              <Button size="sm" variant="ghost" icon={Lock} onClick={() => act.mutate({ fn: () => lockTimetableSection(tt.id, of, true), done: t('timetable.lockedAll') })}>{t('timetable.lockAll')}</Button>
              <Button size="sm" variant="ghost" icon={LockOpen} onClick={() => act.mutate({ fn: () => lockTimetableSection(tt.id, of, false), done: t('timetable.unlockedAll') })}>{t('timetable.unlockAll')}</Button>
            </>}
          </div>

          {!of ? <Note>{t('timetable.pickSomething')}</Note> : gridQ.isLoading ? <p className="text-sm text-ink-faint">{t('timetable.loading')}</p> : gridQ.error ? <Note tone="warning">{gridQ.error.message}</Note> : gridQ.data && (
            <WeekGrid days={gridQ.data.days} slots={gridQ.data.slots} cells={gridQ.data.cells} show={view === 'section' ? 'teacher' : 'section'}
              onCell={isDraft && canEdit && view === 'section' ? (day, period, cell) => setEditing({ day, period, cell }) : undefined} />
          )}
          {isDraft && canEdit && view === 'section' && <p className="text-xs text-ink-faint">{t('timetable.editHint')}</p>}

          {canEdit && tt.entries > 0 && <LoadPanel timetableId={tt.id} />}

          {ov.versions.length > 0 && <p className="text-xs text-ink-faint">{t('timetable.oldVersions', { list: ov.versions.map((v) => `v${v.version}`).join(', ') })}</p>}
        </div>
      )}

      {editing && <CellEditor timetableId={tt.id} sectionId={of} {...editing} rooms={rooms} teachers={teachers} subjects={lookup?.subjects ?? []}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); showSuccess(t('timetable.cell.saved')) }} />}
      {rulesOpen && <RulesForm draft={tt} teachers={teachers} onClose={() => setRulesOpen(false)} onSaved={() => { setRulesOpen(false); refresh(); showSuccess(t('timetable.rules.saved')) }} />}
    </PageContainer>
  )
}
