import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpen, GraduationCap, LayoutGrid, Layers, List, Pencil, Plus, Sparkles, Trash2, Users } from 'lucide-react'
import { CLASS_PRESETS, SEATING_KINDS, SEATING_LIMITS, SEAT_NUMBERING, defaultSeating, normSeating, seatCapacity } from '@schoolgiant/shared'
import {
  ControlChip, DataTable, Drawer, FormField, HeaderButton, ImportExportButtons, Input, Modal, Note, PageContainer, PageHeader, SegmentedControl, Select, StatusPill, useConfirm, ColumnBars, LevelBar, StatCard, TONE, hueTone,
} from '../../components/system'
import Button from '../../components/ui/Button'
import ClassBoard, { SeatingPreview } from '../../components/academics/ClassBoard'
import { Switch } from '../../components/app/Controls'
import {
  createClass, createSection, deleteClass, deleteSection, fetchAcademicLookup, fetchClasses, fetchGrading, fetchSubjects, fetchTeachers,
  importClasses, quickSetupClasses, updateClass, updateSection,
} from '../../api/academics'
import { fetchBranches, fetchDepartments } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { readSheet } from '../../utils/readSheet'

const errorsOf = (e) => e.response?.data?.details?.fields ?? {}

function ClassForm({ cls, onClose, onSaved }) {
  const { t } = useTranslation('academics')
  const { showError } = useSnackbar()
  const { data: subjects = [] } = useQuery({ queryKey: ['subjects'], queryFn: fetchSubjects })
  const { data: schemes = [] } = useQuery({ queryKey: ['grading'], queryFn: fetchGrading })
  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const [form, setForm] = useState(() => ({
    name: '', code: '', order: '', departmentId: '', gradingSchemeId: '', subjectIds: [], optionalSubjectIds: [], active: true,
    ...cls, departmentId: cls?.departmentId ?? '', gradingSchemeId: cls?.gradingSchemeId ?? '', order: cls?.order ?? '',
  }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const toggle = (id) => setForm((f) => (f.subjectIds.includes(id)
    ? { ...f, subjectIds: f.subjectIds.filter((x) => x !== id), optionalSubjectIds: f.optionalSubjectIds.filter((x) => x !== id) }
    : { ...f, subjectIds: [...f.subjectIds, id] }))
  const toggleOptional = (id) => setForm((f) => ({ ...f, optionalSubjectIds: f.optionalSubjectIds.includes(id) ? f.optionalSubjectIds.filter((x) => x !== id) : [...f.optionalSubjectIds, id] }))
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name, code: form.code, order: form.order === '' ? undefined : Number(form.order), departmentId: form.departmentId || null,
        gradingSchemeId: form.gradingSchemeId || null, subjectIds: form.subjectIds, optionalSubjectIds: form.optionalSubjectIds, ...(cls && { active: form.active }),
      }
      return cls ? updateClass(cls.id, body) : createClass(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(errorsOf(e)); showError(e.message) },
  })
  const active = subjects.filter((s) => s.active || form.subjectIds.includes(s.id))
  return (
    <Modal open onClose={onClose} size="lg" title={cls ? t('academics.classes.editTitle', { name: cls.name }) : t('academics.classes.newClass')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name || !form.code} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-2"><FormField label={t('academics.classes.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('academics.classes.namePlaceholder')} /></FormField></div>
        <FormField label={t('academics.classes.code')} required error={errors.code} hint={t('academics.classes.codeHint')}><Input value={form.code} onChange={(e) => set('code')(e.target.value.toUpperCase())} maxLength={12} placeholder="8" /></FormField>
        <FormField label={t('academics.classes.order')} error={errors.order}><Input type="number" value={form.order} onChange={set('order')} /></FormField>
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <FormField label={t('academics.classes.wing')} hint={t('academics.classes.wingHint')} error={errors.departmentId}>
          <Select value={form.departmentId} onChange={set('departmentId')}>
            <option value="">{t('academics.notSet')}</option>
            {depts.filter((d) => d.active || d.id === form.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t('academics.classes.grading')} error={errors.gradingSchemeId}>
          <Select value={form.gradingSchemeId} onChange={set('gradingSchemeId')}>
            <option value="">{t('academics.classes.defaultScheme', { name: schemes.find((s) => s.isDefault)?.name ?? '' })}</option>
            {schemes.filter((s) => !s.isDefault).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </FormField>
      </div>
      <div className="mt-5">
        <p className="text-sm font-semibold text-ink">{t('academics.classes.subjects')}</p>
        <p className="text-xs text-ink-muted mb-2">{t('academics.classes.subjectsHint')}</p>
        {active.length === 0 && <p className="text-sm text-ink-faint">{t('academics.classes.noSubjects')}</p>}
        <div className="grid sm:grid-cols-2 gap-2">
          {active.map((s) => {
            const on = form.subjectIds.includes(s.id)
            return (
              <div key={s.id} className={clsx('flex items-center justify-between gap-2 rounded-lg border px-3 py-2', on ? 'border-brand-300 bg-brand-50/50' : 'border-border')}>
                <label className="flex items-center gap-2 text-sm text-ink cursor-pointer min-w-0">
                  <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                  <span className="truncate">{s.name}</span><span className="text-xs text-ink-faint font-mono-num">{s.code}</span>
                </label>
                {on && (
                  <button type="button" onClick={() => toggleOptional(s.id)} className={clsx('text-[11px] px-2 py-0.5 rounded-full border shrink-0', form.optionalSubjectIds.includes(s.id) ? 'bg-amber-50 border-amber-400/40 text-amber-600' : 'border-border text-ink-muted')}>
                    {form.optionalSubjectIds.includes(s.id) ? t('academics.classes.optional') : t('academics.classes.compulsory')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {errors.optionalSubjectIds && <p className="text-xs text-danger-600 mt-1">{errors.optionalSubjectIds}</p>}
      </div>
      {cls && <label className="mt-4 flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm text-ink">{t('status.active')} <Switch checked={form.active} onChange={set('active')} label={t('status.active')} /></label>}
    </Modal>
  )
}

function SectionForm({ cls, section, yearId, onClose, onSaved }) {
  const { t } = useTranslation('academics')
  const { showError } = useSnackbar()
  const { data: branches = [] } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches })
  const { data: teachers = [] } = useQuery({ queryKey: ['academic-teachers'], queryFn: fetchTeachers })
  const [form, setForm] = useState(() => ({ name: '', branchId: '', classTeacherId: '', capacity: '', room: '', active: true, ...section, branchId: section?.branchId ?? '', classTeacherId: section?.classTeacherId ?? '', capacity: section?.capacity ?? '', room: section?.room ?? '' }))
  const [errors, setErrors] = useState({})
  // the room's seating: off → capacity typed by hand; on → capacity = the seats the layout has
  const [seatingOn, setSeatingOn] = useState(!!section?.seating)
  const [seating, setSeating] = useState(() => normSeating(section?.seating ?? defaultSeating(section?.capacity || 40)))
  const setSeat = (k) => (e) => setSeating((x) => normSeating({ ...x, [k]: e?.target ? e.target.value : e }))
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name, branchId: form.branchId || null, classTeacherId: form.classTeacherId || null, room: form.room, ...(section && { active: form.active }),
        ...(seatingOn ? { seating } : { seating: section?.seating ? null : undefined, capacity: form.capacity === '' ? null : Number(form.capacity) }),
      }
      return section ? updateSection(section.id, body) : createSection({ ...body, classId: cls.id, academicYearId: yearId })
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(errorsOf(e)); showError(e.message) },
  })
  return (
    <Modal open size="lg" onClose={onClose} title={section ? t('academics.sections.editTitle', { name: section.label }) : t('academics.sections.newSection', { name: cls.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('academics.sections.name')} required error={errors.name}><Input value={form.name} onChange={(e) => set('name')(e.target.value.toUpperCase())} maxLength={10} placeholder="A" /></FormField>
        <FormField label={t('academics.sections.room')} error={errors.room}><Input value={form.room} onChange={set('room')} placeholder="204" /></FormField>
        <FormField label={t('academics.sections.classTeacher')} error={errors.classTeacherId}>
          <Select value={form.classTeacherId} onChange={set('classTeacherId')}>
            <option value="">{t('academics.notSet')}</option>
            {teachers.map((u) => <option key={u.id} value={u.id}>{u.name}{u.designation ? ` — ${u.designation}` : ''}</option>)}
          </Select>
        </FormField>
        <FormField label={t('academics.sections.capacity')} error={errors.capacity} hint={seatingOn ? t('academics.seating.fromLayout') : undefined}>
          <Input type="number" value={seatingOn ? seatCapacity(seating) : form.capacity} onChange={set('capacity')} placeholder="40" disabled={seatingOn} />
        </FormField>
        {branches.length > 1 && (
          <FormField label={t('academics.sections.campus')} error={errors.branchId}>
            <Select value={form.branchId} onChange={set('branchId')}>
              <option value="">{t('academics.notSet')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </FormField>
        )}
      </div>
      <div className="mt-5 rounded-xl border border-border">
        <label className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-ink">
          <span><span className="font-medium">{t('academics.seating.title')}</span><span className="block text-xs text-ink-faint">{t('academics.seating.hint')}</span></span>
          <Switch checked={seatingOn} onChange={setSeatingOn} label={t('academics.seating.title')} />
        </label>
        {seatingOn && (
          <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
            <div className="space-y-3">
              <FormField label={t('academics.seating.kind')}>
                <SegmentedControl value={seating.kind} onChange={setSeat('kind')} options={Object.keys(SEATING_KINDS).map((k) => ({ value: k, label: t(`academics.board.sheet.kinds.${k}`, SEATING_KINDS[k].label) }))} />
              </FormField>
              {seating.kind === 'BENCH' && (
                <FormField label={t('academics.seating.perBench')}>
                  <Select value={seating.perBench} onChange={setSeat('perBench')}>
                    {Array.from({ length: SEATING_LIMITS.perBench[1] }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{t('academics.seating.perBenchN', { count: n })}</option>)}
                  </Select>
                </FormField>
              )}
              <div className="grid grid-cols-2 gap-3">
                <FormField label={seating.kind === 'BENCH' ? t('academics.seating.columnsBench') : t('academics.seating.columnsDesk')}>
                  <Select value={seating.columns} onChange={setSeat('columns')}>{Array.from({ length: SEATING_LIMITS.columns[1] }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</Select>
                </FormField>
                <FormField label={t('academics.seating.rows')}>
                  <Select value={seating.rows} onChange={setSeat('rows')}>{Array.from({ length: SEATING_LIMITS.rows[1] }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</Select>
                </FormField>
              </div>
              <FormField label={t('academics.seating.numbering')}>
                <Select value={seating.numbering} onChange={setSeat('numbering')}>
                  {Object.keys(SEAT_NUMBERING).map((k) => <option key={k} value={k}>{t(`academics.seating.numberings.${k}`, SEAT_NUMBERING[k].label)}</option>)}
                </Select>
              </FormField>
              <p className="text-sm text-ink">{t('academics.seating.total', { count: seatCapacity(seating) })}
                {section && section.studentCount > seatCapacity(seating) && <span className="block text-xs text-danger-600">{t('academics.seating.tooFew', { count: section.studentCount })}</span>}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-muted">{t('academics.seating.preview')}</p>
              <SeatingPreview seating={seating} />
            </div>
          </div>
        )}
      </div>
      {section && <label className="mt-4 flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm text-ink">{t('status.active')} <Switch checked={form.active} onChange={set('active')} label={t('status.active')} /></label>}
    </Modal>
  )
}

function QuickSetup({ yearId, yearName, onClose, onDone }) {
  const { t } = useTranslation('academics')
  const { showError } = useSnackbar()
  const { data: branches = [] } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches })
  const [form, setForm] = useState({ preset: 'K12', sectionsPerClass: 1, addSubjects: true, branchId: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const preset = CLASS_PRESETS.find((p) => p.value === form.preset)
  const run = useMutation({
    mutationFn: () => quickSetupClasses({ ...form, sectionsPerClass: Number(form.sectionsPerClass), branchId: form.branchId || null, academicYearId: yearId }),
    onSuccess: onDone,
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('academics.quickSetup.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button icon={Sparkles} loading={run.isPending} onClick={() => run.mutate()}>{t('academics.quickSetup.run')}</Button>
    </>}>
      <p className="text-sm text-ink-muted mb-4">{t('academics.quickSetup.intro', { year: yearName })}</p>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('academics.quickSetup.preset')}>
          <Select value={form.preset} onChange={set('preset')}>{CLASS_PRESETS.map((p) => <option key={p.value} value={p.value}>{t(`academics.quickSetup.presets.${p.value}`, p.label)}</option>)}</Select>
        </FormField>
        <FormField label={t('academics.quickSetup.sections')} hint={t('academics.quickSetup.sectionsHint')}>
          <Select value={form.sectionsPerClass} onChange={set('sectionsPerClass')}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{t('academics.quickSetup.sectionsN', { count: n, names: 'ABCDEF'.slice(0, n).split('').join(', ') })}</option>)}</Select>
        </FormField>
        {branches.length > 1 && (
          <FormField label={t('academics.sections.campus')}>
            <Select value={form.branchId} onChange={set('branchId')}>
              <option value="">{t('academics.notSet')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </FormField>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-muted">{preset?.classes.map((c) => c[0]).join(' · ')}</p>
      <label className="mt-4 flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm text-ink">
        <span><span className="block font-medium">{t('academics.quickSetup.addSubjects')}</span><span className="block text-xs text-ink-muted">{t('academics.quickSetup.addSubjectsHint')}</span></span>
        <Switch checked={form.addSubjects} onChange={set('addSubjects')} label={t('academics.quickSetup.addSubjects')} />
      </label>
      <Note className="mt-4">{t('academics.quickSetup.safe')}</Note>
    </Modal>
  )
}

function ClassDrawer({ cls, year, onClose, onEditClass, onChanged }) {
  const { t } = useTranslation('academics')
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const del = useMutation({ mutationFn: deleteSection, onSuccess: () => { onChanged(); showSuccess(t('academics.sections.deleted')) }, onError: (e) => showError(e.message) })
  const canCreate = hasPermission('academics.classes.create') && !year.closed
  const canEdit = hasPermission('academics.classes.edit')
  return (
    <Drawer open onClose={onClose} size="xl" subtitle={t('academics.classes.inYear', { year: year.name })} title={cls.name}
      footer={canEdit && <Button variant="secondary" icon={Pencil} onClick={onEditClass}>{t('academics.classes.editClass')}</Button>}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-ink">{t('academics.sections.title')}</p>
        {canCreate && <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>{t('academics.sections.add')}</Button>}
      </div>
      <DataTable dense rows={cls.sections} columns={[
        { key: 'short', header: t('academics.sections.section'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink font-mono-num">{v}</p>{r.room && <p className="text-xs text-ink-faint">{t('academics.sections.roomN', { room: r.room })}</p>}</div> },
        { key: 'classTeacherName', header: t('academics.sections.classTeacher'), render: (v) => v || <span className="text-ink-faint">{t('academics.notSet')}</span> },
        { key: 'branchName', header: t('academics.sections.campus'), mobileHidden: true, render: (v) => v || <span className="text-ink-faint">—</span> },
        { key: 'studentCount', header: t('academics.sections.students'), align: 'right', render: (v, r) => (r.capacity ? `${v} / ${r.capacity}` : v) },
        { key: 'active', header: '', render: (v) => !v && <StatusPill tone="neutral">{t('academics.inactive')}</StatusPill> },
        { key: 'id', header: '', align: 'right', width: 90, render: (_, r) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {canEdit && <Button size="sm" variant="ghost" icon={Pencil} title={t('actions.edit')} aria-label={t('actions.edit')} onClick={() => setEditing(r)} />}
            {hasPermission('academics.classes.delete') && <Button size="sm" variant="ghost" icon={Trash2} title={t('actions.delete')} aria-label={t('actions.delete')}
              onClick={async () => { if (await confirm({ title: t('academics.sections.deleteConfirm', { name: r.label }), message: t('academics.sections.deleteMessage'), tone: 'danger', confirmLabel: t('actions.delete') })) del.mutate(r.id) }} />}
          </div>
        ) },
      ]} onRowClick={canEdit ? setEditing : undefined} emptyIcon={Users} emptyTitle={t('academics.sections.empty', { year: year.name })} />

      <p className="text-sm font-semibold text-ink mt-6 mb-2">{t('academics.classes.subjects')}</p>
      {cls.subjects.length ? (
        <div className="flex flex-wrap gap-1.5">{cls.subjects.map((s) => (
          <span key={s.id} className={clsx('text-xs px-2 py-1 rounded-full border', cls.optionalSubjectIds.includes(s.id) ? 'border-amber-400/40 bg-amber-50 text-amber-600' : 'border-border bg-bg text-ink')}>{s.name}</span>
        ))}</div>
      ) : <p className="text-sm text-ink-faint">{t('academics.classes.noneOnClass')}</p>}
      <p className="text-xs text-ink-muted mt-4">{t('academics.classes.gradingLine', { name: cls.gradingSchemeName ?? '—' })}</p>

      {editing && <SectionForm cls={cls} section={editing === 'new' ? null : editing} yearId={year.id} onClose={() => setEditing(null)}
        onSaved={() => { onChanged(); showSuccess(t('academics.sections.saved')); setEditing(null) }} />}
    </Drawer>
  )
}

export default function Classes() {
  const { t } = useTranslation('academics')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const [yearId, setYearId] = useState('')
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['academic-classes', yearId], queryFn: () => fetchClasses(yearId) })
  const [editing, setEditing] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [quick, setQuick] = useState(false)
  const [view, setView] = useState('board')
  const [sectionEdit, setSectionEdit] = useState(null) // { cls, section } — Edit from the board's section drawer
  const refresh = () => { qc.invalidateQueries({ queryKey: ['academic-classes'] }); qc.invalidateQueries({ queryKey: ['academic-board'] }); qc.invalidateQueries({ queryKey: ['academic-lookup'] }); qc.invalidateQueries({ queryKey: ['subjects'] }) }
  const del = useMutation({ mutationFn: deleteClass, onSuccess: () => { refresh(); showSuccess(t('academics.classes.deleted')) }, onError: (e) => showError(e.message) })

  const year = data?.year
  const classes = data?.classes ?? []
  const open = classes.find((c) => c.id === openId)
  const years = lookup?.years ?? []
  const yearName = (id) => years.find((y) => y.id === id)?.name
  const totals = useMemo(() => ({
    sections: classes.reduce((n, c) => n + c.sections.length, 0),
    students: classes.reduce((n, c) => n + c.sections.reduce((m, s) => m + s.studentCount, 0), 0),
    capacity: classes.every((c) => c.sections.every((s) => s.capacity)) ? classes.reduce((n, c) => n + c.sections.reduce((m, s) => m + s.capacity, 0), 0) : 0,
    biggest: Math.max(1, ...classes.map((c) => c.sections.reduce((m, s) => m + s.studentCount, 0))),
  }), [classes])
  const canCreate = hasPermission('academics.classes.create')

  return (
    <PageContainer>
      <PageHeader icon={Layers} title={t('academics.classes.title')} subtitle={t('academics.classes.subtitle')}
        actions={<>
          {hasPermission('academics.classes.import') && <ImportExportButtons resourceLabel={t('academics.classes.resource')} requires="academics.classes.import"
            onImport={async (file) => importClasses(await readSheet(file), true)} onCommit={(r) => importClasses(r, false)}
            templateHeaders={['name', 'code', 'order', 'department', 'subjects']} templateSample={['Class 8', '8', '11', 'MIDS', 'ENG|HIN|MATH|SCI|SST']} onDone={refresh} />}
          {canCreate && !year?.closed && <HeaderButton icon={Sparkles} requires="create" onClick={() => setQuick(true)}>{t('academics.quickSetup.button')}</HeaderButton>}
          <HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setEditing('new')}>{t('academics.classes.newClass')}</HeaderButton>
        </>} />

      {year && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <ControlChip label={t('academics.classes.year')} value={year.name} active={!year.isCurrent}
            options={years.map((y) => y.name)} onChange={(name) => setYearId(years.find((y) => y.name === name)?.id ?? '')} />
          <span className="text-sm text-ink-muted lg:hidden">{t('academics.classes.totals', { classes: classes.length, sections: totals.sections, students: totals.students })}</span>
          {year.closed && <StatusPill tone="neutral">{t('academics.years.closedPill')}</StatusPill>}
          <SegmentedControl className="ms-auto" value={view} onChange={setView} options={[
            { value: 'board', label: t('academics.board.viewBoard'), icon: LayoutGrid },
            { value: 'list', label: t('academics.board.viewList'), icon: List },
          ]} />
        </div>
      )}

      {classes.length > 0 && (
        <div className="mb-4 hidden grid-cols-4 gap-4 lg:grid">
          <StatCard icon={Layers} tone="brand" label={t('academics.classes.stat.classes')} value={classes.length}
            sub={t('academics.classes.stat.subjects', { count: new Set(classes.flatMap((c) => c.subjects.map((x) => x.id))).size })} />
          <StatCard icon={GraduationCap} tone="violet" label={t('academics.classes.stat.students')} value={totals.students}
            sub={t('academics.classes.stat.perSection', { count: totals.sections ? Math.round(totals.students / totals.sections) : 0 })}
            progress={totals.capacity ? (totals.students / totals.capacity) * 100 : undefined} />
          <ColumnBars className="col-span-2" title={t('academics.classes.stat.strength')} subtitle={t('academics.classes.stat.sections', { count: totals.sections })}
            items={classes.map((c) => ({ id: c.id, label: c.name, short: c.code || c.name, value: c.sections.reduce((m, s) => m + s.studentCount, 0) }))} />
        </div>
      )}

      {view === 'board' ? (
        <ClassBoard classes={classes} year={year} loading={isLoading} onOpenClass={(c) => setOpenId(c.id)}
          onEditSection={(cls, section) => setSectionEdit({ cls, section })}
          emptyAction={canCreate && year && !year.closed && <Button icon={Sparkles} onClick={() => setQuick(true)}>{t('academics.quickSetup.button')}</Button>} />
      ) : <DataTable
        rows={classes}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="classes"
        columns={[
          { key: 'name', header: t('academics.classes.class'), mobilePrimary: true, render: (v, r) => {
            const tone = TONE[hueTone(r.id)]
            return (
              <span className="flex items-center gap-3 min-w-0">
                <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-[11px] font-bold font-mono-num', tone.bg, tone.text, tone.border)}>{(r.code || v).slice(0, 3)}</span>
                <span className="min-w-0 leading-tight"><span className="block truncate font-medium text-ink">{v}</span>
                  {r.departmentName && <span className="block truncate text-[11.5px] text-ink-faint">{r.departmentName}</span>}</span>
              </span>
            )
          } },
          { key: 'sections', header: t('academics.sections.title'), render: (v, r) => (v.length
            ? <div className="flex flex-wrap gap-1.5">{v.map((s) => {
              const tone = TONE[hueTone(r.id)]
              return (
                <span key={s.id} title={s.classTeacherName ?? ''} className={clsx('inline-flex items-center gap-1.5 rounded-lg border ps-2 pe-1 py-0.5 text-xs font-semibold', s.active ? clsx(tone.bg, tone.text, tone.border) : 'border-border text-ink-faint line-through')}>
                  {s.name}
                  <span className="inline-flex items-center gap-0.5 rounded-md bg-white/80 px-1 text-[10.5px] font-medium text-ink-muted tabular-nums"><Users className="h-2.5 w-2.5" aria-hidden />{s.studentCount}</span>
                </span>
              )
            })}</div>
            : <span className="text-ink-faint text-sm">{t('academics.classes.noSections')}</span>) },
          { key: 'strength', header: t('academics.classes.stat.strengthCol'), mobileHidden: true, sortable: true,
            sortAccessor: (r) => r.sections.reduce((m, s) => m + s.studentCount, 0),
            render: (_, r) => {
              const n = r.sections.reduce((m, s) => m + s.studentCount, 0)
              const cap = r.sections.every((s) => s.capacity) ? r.sections.reduce((m, s) => m + s.capacity, 0) : 0
              return cap
                ? <LevelBar value={n} max={cap} highIsBad warnAt={cap * 0.9} dangerAt={cap} />
                : <span className="flex items-center gap-2"><span className="w-7 text-[13px] font-semibold tabular-nums text-ink">{n}</span><LevelBar bare value={n} max={totals.biggest} width="w-24" /></span>
            } },
          { key: 'subjects', header: t('academics.classes.subjects'), align: 'center', mobileHidden: true, render: (v) => <span className="inline-flex items-center gap-1 rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-ink-muted"><BookOpen className="h-3 w-3" aria-hidden />{v.length}</span> },
          { key: 'gradingSchemeName', header: t('academics.classes.grading'), mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{v ?? '—'}{r.gradingIsDefault && v ? ` ${t('academics.classes.defaultTag')}` : ''}</span> },
          { key: 'active', header: t('academics.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('status.active') : t('academics.inactive')}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 90, render: (_, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {hasPermission('academics.classes.edit') && <Button size="sm" variant="ghost" icon={Pencil} title={t('actions.edit')} aria-label={t('actions.edit')} onClick={() => setEditing(r)} />}
              {hasPermission('academics.classes.delete') && <Button size="sm" variant="ghost" icon={Trash2} title={t('actions.delete')} aria-label={t('actions.delete')}
                onClick={async () => { if (await confirm({ title: t('academics.classes.deleteConfirm', { name: r.name }), message: t('academics.cantUndo'), tone: 'danger', confirmLabel: t('actions.delete') })) del.mutate(r.id) }} />}
            </div>
          ) },
        ]}
        onRowClick={(r) => setOpenId(r.id)}
        emptyIcon={Layers} emptyTitle={t('academics.classes.emptyTitle')} emptyHint={t('academics.classes.emptyHint')}
        emptyAction={canCreate && year && !year.closed && <Button icon={Sparkles} onClick={() => setQuick(true)}>{t('academics.quickSetup.button')}</Button>}
      />}

      {open && year && <ClassDrawer cls={open} year={year} onClose={() => setOpenId(null)} onEditClass={() => setEditing(open)} onChanged={refresh} />}
      {sectionEdit && year && <SectionForm cls={sectionEdit.cls} section={sectionEdit.section} yearId={year.id} onClose={() => setSectionEdit(null)}
        onSaved={() => { refresh(); showSuccess(t('academics.sections.saved')); setSectionEdit(null) }} />}
      {editing && <ClassForm cls={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); showSuccess(t('academics.classes.saved')); setEditing(null) }} />}
      {quick && year && <QuickSetup yearId={year.id} yearName={yearName(year.id) ?? year.name} onClose={() => setQuick(false)}
        onDone={(r) => { refresh(); setQuick(false); showSuccess(t('academics.quickSetup.done', { classes: r.classes, sections: r.sections, subjects: r.subjects })) }} />}
    </PageContainer>
  )
}
