import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, BookMarked, GraduationCap, Layers, Pencil, Plus, Scale, Trash2, UserPlus, Users } from 'lucide-react'
import { ENROLMENT_STATUS, PROGRAM_COURSE_TYPES } from '@schoolgiant/shared'
import {
  BulkActionBar, CodeBadge, ColorChip, ColumnBars, DataTable, EmptyState, FactGrid, HeaderButton, PageContainer, PageHeader, Panel, PersonCell,
  SideNav, SideNavLayout, StatCardRow, StatusPill, Tabs, usePrompt, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { CourseForm, EnrolModal, EnrolmentForm, ProgramForm, RegulationForm } from '../../components/programs/ProgramForms'
import useProgramList from '../../components/programs/useProgramList'
import { deleteCourse, deleteEnrolment, deleteProgram, deleteRegulation, fetchEnrolments, fetchProgram, fetchRegulations, updateEnrolments } from '../../api/programs'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

function Curriculum({ program, onChanged }) {
  const { t } = useTranslation('programs')
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [semester, setSemester] = useState('')
  const [editing, setEditing] = useState(null)
  const canEdit = hasPermission('programs.programs.edit') || hasPermission('programs.programs.create')
  const rows = useMemo(() => program.courses.filter((c) => !semester || c.semester === Number(semester)), [program, semester])
  const remove = async (c) => {
    if (!(await confirm({ title: t('programs.courses.deleteConfirm', { code: c.code }), message: t('programs.cantUndo'), tone: 'danger', confirmLabel: t('actions.delete') }))) return
    try { await deleteCourse(c.id); showSuccess(t('programs.courses.deleted')); onChanged() } catch (e) { showError(e.message) }
  }
  return (
    <div className="space-y-4">
      <ColumnBars title={t('programs.courses.creditsPerSemester')} subtitle={t('programs.courses.creditsPerSemesterHint')}
        items={program.semesterSummary.map((s) => ({ id: String(s.semester), label: t('programs.semesterN', { n: s.semester }), short: `${t('programs.semShort', { n: s.semester })}`, value: s.credits + s.electiveCredits }))}
        activeId={semester} onPick={(it) => setSemester(it?.id ?? '')} />
      <DataTable
        title={semester ? t('programs.semesterN', { n: semester }) : t('programs.courses.title_all')}
        exportable exportName={`${program.code}-curriculum`}
        toolbar={canEdit && <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>{t('programs.courses.add')}</Button>}
        rows={rows}
        rowKey="id"
        onSelect={canEdit ? setEditing : undefined}
        emptyIcon={Layers}
        emptyTitle={t('programs.courses.empty')}
        emptyHint={t('programs.courses.emptyHint')}
        emptyAction={canEdit && <Button icon={Plus} onClick={() => setEditing('new')}>{t('programs.courses.add')}</Button>}
        columns={[
          { key: 'code', header: t('programs.courses.code'), sortable: true, nowrap: true, render: (v) => <CodeBadge>{v}</CodeBadge> },
          { key: 'title', header: t('programs.courses.title'), sortable: true, mobileTitle: true, render: (v, c) => <span className={c.active ? 'font-medium text-ink' : 'text-ink-faint line-through'}>{v}</span> },
          { key: 'semester', header: t('programs.courses.semester'), sortable: true, render: (v) => <ColorChip label={`${t('programs.semShort', { n: v })}`} seed={`sem${v}`} /> },
          { key: 'type', header: t('programs.courses.type'), sortable: true, render: (v, c) => <ColorChip label={t(`programs.courseTypes.${v}`, PROGRAM_COURSE_TYPES[v]?.label)} seed={v} sub={c.electiveGroup || undefined} /> },
          { key: 'l', header: t('programs.courses.ltp'), nowrap: true, render: (_, c) => <span className="font-mono-num text-sm text-ink-muted">{c.l}-{c.t}-{c.p}</span> },
          { key: 'credits', header: t('programs.courses.credits'), align: 'right', sortable: true, render: (v) => <span className="font-semibold">{v}</span> },
          { key: 'internalMax', header: t('programs.courses.marks'), align: 'right', render: (v, c) => <span className="text-sm text-ink-muted">{v} + {c.externalMax}</span> },
          { key: 'prerequisites', header: t('programs.courses.prerequisites'), render: (v) => (v?.length ? v.join(', ') : <span className="text-ink-faint">—</span>) },
          { key: 'actions', header: '', align: 'right', render: (_, c) => canEdit && (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('actions.edit')} onClick={() => setEditing(c)} />
              {hasPermission('programs.programs.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('actions.delete')} onClick={() => remove(c)} />}
            </div>
          ) },
        ]}
      />
      {editing && <CourseForm program={program} courses={program.courses} semester={semester} course={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); showSuccess(t('programs.courses.saved')); onChanged() }} />}
    </div>
  )
}

function Students({ program, onChanged }) {
  const { t } = useTranslation('programs')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [semester, setSemester] = useState('')
  const [selected, setSelected] = useState([])
  const [enrolling, setEnrolling] = useState(false)
  const [editing, setEditing] = useState(null)
  const key = ['program-students', program.id]
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => fetchEnrolments(program.id) })
  const canEdit = hasPermission('programs.programs.edit')
  const shown = rows.filter((r) => !semester || r.currentSemester === Number(semester))
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); onChanged() }
  const move = async () => {
    const to = await prompt({ title: t('programs.students.moveTitle', { count: selected.length }), label: t('programs.students.moveLabel', { max: program.semesters }), required: true })
    if (!to) return
    try { await updateEnrolments(selected, { currentSemester: Number(to) }); setSelected([]); showSuccess(t('programs.students.moved')); refresh() } catch (e) { showError(e.message) }
  }
  const remove = async (r) => {
    if (!(await confirm({ title: t('programs.students.removeConfirm', { name: r.name }), message: t('programs.students.removeHint'), tone: 'danger', confirmLabel: t('programs.remove') }))) return
    try { await deleteEnrolment(r.id); showSuccess(t('programs.students.removed')); refresh() } catch (e) { showError(e.message) }
  }
  return (
    <div className="space-y-4">
      <ColumnBars title={t('programs.students.perSemester')} items={program.semesterSummary.map((s) => ({ id: String(s.semester), label: t('programs.semesterN', { n: s.semester }), short: `${t('programs.semShort', { n: s.semester })}`, value: s.students }))}
        activeId={semester} onPick={(it) => setSemester(it?.id ?? '')} />
      <BulkActionBar count={selected.length} onClear={() => setSelected([])} noun={t('programs.students.noun')}>
        <Button size="sm" variant="secondary" icon={ArrowRightLeft} onClick={move}>{t('programs.students.move')}</Button>
      </BulkActionBar>
      <DataTable
        title={t('programs.students.title', { count: shown.length })}
        exportable exportName={`${program.code}-students`}
        toolbar={canEdit && <Button size="sm" icon={UserPlus} onClick={() => setEnrolling(true)}>{t('programs.students.enrol')}</Button>}
        rows={shown} loading={isLoading} error={error} onRetry={refetch}
        selectable={canEdit} selectedIds={selected} onSelectionChange={setSelected}
        onSelect={canEdit ? setEditing : undefined}
        emptyIcon={Users} emptyTitle={t('programs.students.empty')} emptyHint={t('programs.students.emptyHint')}
        emptyAction={canEdit && <Button icon={UserPlus} onClick={() => setEnrolling(true)}>{t('programs.students.enrol')}</Button>}
        columns={[
          { key: 'name', header: t('programs.students.student'), sortable: true, mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={r.registerNo || r.admissionNo} /> },
          { key: 'batch', header: t('programs.students.batch'), sortable: true, render: (v) => <ColorChip label={String(v)} seed={`batch${v}`} /> },
          { key: 'currentSemester', header: t('programs.students.semester'), sortable: true, render: (v) => <ColorChip label={`${t('programs.semShort', { n: v })}`} seed={`sem${v}`} /> },
          { key: 'advisorName', header: t('programs.students.advisor'), sortable: true, render: (v) => v || <span className="text-ink-faint">—</span> },
          { key: 'regulationCode', header: t('programs.students.regulation'), render: (v) => v || '—' },
          { key: 'status', header: t('programs.students.status'), render: (v) => <StatusPill tone={ENROLMENT_STATUS[v]?.tone}>{t(`programs.enrolmentStatus.${v}`)}</StatusPill> },
          { key: 'actions', header: '', align: 'right', render: (_, r) => hasPermission('programs.programs.delete') && (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" icon={Trash2} aria-label={t('programs.remove')} onClick={() => remove(r)} /></div>
          ) },
        ]}
      />
      {enrolling && <EnrolModal program={program} onClose={() => setEnrolling(false)} onSaved={(d) => { setEnrolling(false); showSuccess(t('programs.students.enrolled', { count: d.enrolled })); refresh() }} />}
      {editing && <EnrolmentForm program={program} enrolment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); showSuccess(t('programs.students.saved')); refresh() }} />}
    </div>
  )
}

function ProgramDetail({ programId, onEdit, onDeleted }) {
  const { t } = useTranslation('programs')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [tab, setTab] = useState('curriculum')
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: ['program', programId], queryFn: () => fetchProgram(programId), enabled: !!programId })
  const changed = () => { qc.invalidateQueries({ queryKey: ['program', programId] }); qc.invalidateQueries({ queryKey: ['programs'] }) }
  if (isLoading) return <p className="text-sm text-ink-faint">{t('programs.loading')}</p>
  if (error || !p) return <EmptyState error={error} onRetry={refetch} />
  const remove = async () => {
    if (!(await confirm({ title: t('programs.programs.deleteConfirm', { name: p.name }), message: t('programs.cantUndo'), tone: 'danger', confirmLabel: t('actions.delete') }))) return
    try { await deleteProgram(p.id); showSuccess(t('programs.programs.deleted')); onDeleted() } catch (e) { showError(e.message) }
  }
  const required = p.regulation?.minCredits ?? null
  return (
    <>
      <Panel title={p.name} subtitle={[p.code, t(`programs.levels.${p.level}`), p.departmentName, p.branchName].filter(Boolean).join(' · ')} icon={GraduationCap}
        actions={<div className="flex gap-1">
          {hasPermission('programs.programs.edit') && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEdit(p)}>{t('actions.edit')}</Button>}
          {hasPermission('programs.programs.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('actions.delete')} onClick={remove} />}
        </div>}>
        <FactGrid cols={4} items={[
          { label: t('programs.programs.regulation'), value: p.regulation ? `${p.regulation.code}${p.regulation.name ? ` · ${p.regulation.name}` : ''}` : null },
          { label: t('programs.programs.duration'), value: t('programs.programs.durationValue', { years: p.durationYears, semesters: p.semesters }) },
          { label: t('programs.programs.intake'), value: p.intake },
          { label: t('programs.programs.passRule'), value: p.regulation ? t('programs.programs.passRuleValue', p.regulation.passRules) : null },
        ]} />
      </Panel>
      <StatCardRow items={[
        { icon: Layers, tone: 'brand', label: t('programs.programs.courses'), value: p.courses.filter((c) => c.active).length, sub: t('programs.programs.coursesSub', { semesters: p.semesterSummary.filter((s) => s.courses).length }) },
        { icon: Scale, tone: 'violet', label: t('programs.programs.credits'), value: p.totalCredits, sub: required ? t('programs.programs.creditsSub', { required }) : null, progress: required ? Math.min(100, (p.totalCredits / required) * 100) : undefined },
        { icon: Users, tone: 'teal', label: t('programs.programs.students'), value: p.studentCount, sub: p.intake ? t('programs.programs.intakeSub', { intake: p.intake }) : null },
        { icon: BookMarked, tone: 'orange', label: t('programs.programs.outcomes'), value: p.outcomes?.length ?? 0, sub: t('programs.programs.outcomesSub') },
      ]} />
      <Tabs tabs={[{ value: 'curriculum', label: t('programs.programs.curriculum') }, { value: 'students', label: t('programs.programs.studentsTab') }]} value={tab} onChange={setTab} />
      {tab === 'curriculum' ? <Curriculum program={p} onChanged={changed} /> : <Students program={p} onChanged={changed} />}
    </>
  )
}

function Regulations({ onEdit }) {
  const { t } = useTranslation('programs')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { data: regs = [], isLoading, error, refetch } = useQuery({ queryKey: ['regulations'], queryFn: fetchRegulations })
  const del = useMutation({ mutationFn: deleteRegulation, onSuccess: () => { qc.invalidateQueries({ queryKey: ['regulations'] }); showSuccess(t('programs.regulations.deleted')) }, onError: (e) => showError(e.message) })
  if (!isLoading && !regs.length) {
    return <EmptyState icon={Scale} error={error} onRetry={refetch} title={t('programs.regulations.empty')} hint={t('programs.regulations.emptyHint')}
      action={hasPermission('programs.programs.create') && <Button icon={Plus} onClick={() => onEdit('new')}>{t('programs.regulations.fromTemplate')}</Button>} />
  }
  return (
    <div className="grid xl:grid-cols-2 gap-5">
      {regs.map((r) => (
        <Panel key={r.id} title={`${r.code}${r.name ? ` · ${r.name}` : ''}`} subtitle={t('programs.regulations.usedBy', { count: r.usedBy })} icon={Scale}
          actions={<div className="flex gap-1">
            {!r.active && <StatusPill tone="neutral">{t('programs.inactive')}</StatusPill>}
            {hasPermission('programs.programs.edit') && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('actions.edit')} onClick={() => onEdit(r)} />}
            {hasPermission('programs.programs.delete') && !r.usedBy && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('actions.delete')}
              onClick={async () => { if (await confirm({ title: t('programs.regulations.deleteConfirm', { code: r.code }), message: t('programs.cantUndo'), tone: 'danger', confirmLabel: t('actions.delete') })) del.mutate(r.id) }} />}
          </div>}>
          <FactGrid cols={3} items={[
            { label: t('programs.regulations.minCredits'), value: r.minCredits },
            { label: t('programs.regulations.perSemester'), value: `${r.semesterMinCredits}–${r.semesterMaxCredits}` },
            { label: t('programs.regulations.passShort'), value: t('programs.programs.passRuleValue', r.passRules) },
          ]} />
          <p className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('programs.regulations.gradeScale')}</p>
          <div className="flex flex-wrap gap-1.5">
            {r.gradeScale.map((b) => (
              <span key={b.grade} className={b.pass ? 'rounded-md border border-border bg-bg px-2 py-1 text-xs' : 'rounded-md border border-danger-200 bg-danger-50 px-2 py-1 text-xs text-danger-700'}>
                <b>{b.grade}</b> <span className="text-ink-muted">{b.points} · {b.min}%+</span>
              </span>
            ))}
          </div>
          <p className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('programs.regulations.componentsShort')}</p>
          <div className="flex flex-wrap gap-1.5">
            {r.iaComponents.map((c) => <ColorChip key={c.code} label={c.code} sub={String(c.maxMarks)} seed={c.code} />)}
          </div>
        </Panel>
      ))}
    </div>
  )
}

export default function Programs() {
  const { t } = useTranslation('programs')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const [tab, setTab] = useState('programs')
  const [editing, setEditing] = useState(null) // program form
  const [regEditing, setRegEditing] = useState(null)
  const { programs, programId, setProgramId, isLoading, error, refetch } = useProgramList()
  const { data: regs = [] } = useQuery({ queryKey: ['regulations'], queryFn: fetchRegulations })
  const start = () => (regs.length ? setEditing('new') : setRegEditing('new'))

  return (
    <PageContainer>
      <PageHeader icon={BookMarked} title={t('programs.programs.title')} subtitle={t('programs.programs.subtitle')}
        actions={tab === 'programs'
          ? <HeaderButton icon={Plus} variant="primary" requires="create" onClick={start}>{t('programs.programs.new')}</HeaderButton>
          : <HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setRegEditing('new')}>{t('programs.regulations.new')}</HeaderButton>} />
      <Tabs tabs={[{ value: 'programs', label: t('programs.programs.tab') }, { value: 'regulations', label: t('programs.regulations.tab') }]} value={tab} onChange={setTab} />
      {tab === 'regulations' ? <Regulations onEdit={setRegEditing} /> : !isLoading && !programs.length ? (
        <EmptyState icon={GraduationCap} error={error} onRetry={refetch} title={t('programs.programs.emptyTitle')}
          hint={regs.length ? t('programs.programs.emptyHint') : t('programs.programs.emptyHintNoRegulation')}
          action={hasPermission('programs.programs.create') && <Button icon={Plus} onClick={start}>{t('programs.programs.setupFirst')}</Button>} />
      ) : (
        <SideNavLayout nav={<SideNav title={t('programs.programs.list')} value={programId} onChange={setProgramId}
          items={programs.map((p) => ({ id: p.id, label: p.name, hint: `${p.code} · ${t(`programs.levels.${p.level}`)}${p.regulationCode ? ` · ${p.regulationCode}` : ''}`, count: p.studentCount, icon: GraduationCap }))} />}>
          {programId && <ProgramDetail programId={programId} onEdit={setEditing} onDeleted={() => { setProgramId(''); qc.invalidateQueries({ queryKey: ['programs'] }) }} />}
        </SideNavLayout>
      )}
      {editing && <ProgramForm program={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(p) => { setEditing(null); showSuccess(t('programs.programs.saved')); qc.invalidateQueries({ queryKey: ['programs'] }); qc.invalidateQueries({ queryKey: ['program', p.id] }); setProgramId(p.id) }} />}
      {regEditing && <RegulationForm regulation={regEditing === 'new' ? null : regEditing} onClose={() => setRegEditing(null)}
        onSaved={() => {
          const first = !regs.length
          setRegEditing(null); showSuccess(t('programs.regulations.saved')); qc.invalidateQueries({ queryKey: ['regulations'] })
          if (first && tab === 'programs') setEditing('new')
        }} />}
    </PageContainer>
  )
}
