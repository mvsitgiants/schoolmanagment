import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Search, X } from 'lucide-react'
import {
  PROGRAM_COURSE_TYPES, PROGRAM_LEVELS, UGC_CBCS_REGULATION, checkGradeScale, creditsFromLtp,
} from '@schoolgiant/shared'
import { DataTable, FormField, Input, Modal, PersonCell, Select } from '../system'
import Button from '../ui/Button'
import { Switch } from '../app/Controls'
import { fetchBranches, fetchDepartments } from '../../api/core'
import {
  createCourse, createProgram, createRegulation, enrolStudents, fetchEnrolmentCandidates, fetchProgramStaff, fetchRegulations,
  updateCourse, updateEnrolment, updateProgram, updateRegulation,
} from '../../api/programs'
import { useSnackbar } from '../../context/SnackbarContext'

const fieldErrors = (e) => e.response?.data?.details?.fields ?? {}
const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v))

// ───────────────────────────────────────────────────────── regulation

const blankBand = { grade: '', min: '', max: '', points: '', label: '', pass: true }

export function RegulationForm({ regulation, onClose, onSaved }) {
  const { t } = useTranslation('programs')
  const { showError } = useSnackbar()
  const base = regulation ?? { ...UGC_CBCS_REGULATION, code: `R${new Date().getFullYear()}`, name: '' }
  const [form, setForm] = useState(() => ({
    code: base.code ?? '', name: base.name ?? '', effectiveFrom: base.effectiveFrom ?? '',
    minCredits: base.minCredits ?? 160, semesterMinCredits: base.semesterMinCredits ?? 16, semesterMaxCredits: base.semesterMaxCredits ?? 28,
    passRules: { ...UGC_CBCS_REGULATION.passRules, ...base.passRules },
    gradeScale: (base.gradeScale?.length ? base.gradeScale : UGC_CBCS_REGULATION.gradeScale).map((b) => ({ ...blankBand, ...b })),
    iaComponents: (base.iaComponents?.length ? base.iaComponents : UGC_CBCS_REGULATION.iaComponents).map((c) => ({ ...c })),
    attainment: { ...UGC_CBCS_REGULATION.attainment, ...base.attainment },
    countFailed: base.gpa?.countFailed ?? true,
  }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const setIn = (group, k) => (e) => setForm((f) => ({ ...f, [group]: { ...f[group], [k]: e.target.value } }))
  const setRow = (list, i, k) => (e) => setForm((f) => ({ ...f, [list]: f[list].map((x, j) => (j === i ? { ...x, [k]: e?.target ? e.target.value : e } : x)) }))
  const scaleErrors = checkGradeScale(form.gradeScale.map((b) => ({ ...b, min: Number(b.min), max: Number(b.max), points: Number(b.points) })))
  const iaTotal = form.iaComponents.reduce((n, c) => n + (Number(c.maxMarks) || 0), 0)
  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code, name: form.name || undefined, effectiveFrom: numOrNull(form.effectiveFrom),
        minCredits: Number(form.minCredits), semesterMinCredits: Number(form.semesterMinCredits), semesterMaxCredits: Number(form.semesterMaxCredits),
        passRules: Object.fromEntries(Object.entries(form.passRules).map(([k, v]) => [k, Number(v)])),
        gradeScale: form.gradeScale.map((b) => ({ grade: b.grade, min: Number(b.min), max: Number(b.max), points: Number(b.points), label: b.label || undefined, pass: !!b.pass })),
        iaComponents: form.iaComponents.map((c) => ({ code: c.code, name: c.name, maxMarks: Number(c.maxMarks) })),
        gpa: { countFailed: !!form.countFailed },
        attainment: { targetPct: Number(form.attainment.targetPct), internalWeight: Number(form.attainment.internalWeight), levels: form.attainment.levels },
      }
      return regulation?.id ? updateRegulation(regulation.id, body) : createRegulation(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  const scaleCols = [
    { key: 'grade', header: t('programs.regulations.grade'), width: 80, render: (_, b) => <Input value={b.grade} onChange={setRow('gradeScale', b.i, 'grade')} maxLength={4} aria-label={t('programs.regulations.grade')} /> },
    { key: 'min', header: t('programs.regulations.fromPct'), width: 90, render: (_, b) => <Input type="number" value={b.min} onChange={setRow('gradeScale', b.i, 'min')} aria-label={t('programs.regulations.fromPct')} /> },
    { key: 'max', header: t('programs.regulations.toPct'), width: 90, render: (_, b) => <Input type="number" value={b.max} onChange={setRow('gradeScale', b.i, 'max')} aria-label={t('programs.regulations.toPct')} /> },
    { key: 'points', header: t('programs.regulations.points'), width: 80, render: (_, b) => <Input type="number" value={b.points} onChange={setRow('gradeScale', b.i, 'points')} aria-label={t('programs.regulations.points')} /> },
    { key: 'label', header: t('programs.regulations.meaning'), render: (_, b) => <Input value={b.label ?? ''} onChange={setRow('gradeScale', b.i, 'label')} maxLength={40} aria-label={t('programs.regulations.meaning')} /> },
    { key: 'pass', header: t('programs.regulations.pass'), width: 70, render: (_, b) => <Switch size="sm" checked={!!b.pass} onChange={setRow('gradeScale', b.i, 'pass')} label={t('programs.regulations.pass')} /> },
    { key: 'x', header: '', width: 44, render: (_, b) => <Button size="sm" variant="ghost" icon={X} aria-label={t('programs.remove')} onClick={() => setForm((f) => ({ ...f, gradeScale: f.gradeScale.filter((_, j) => j !== b.i) }))} /> },
  ]
  const iaCols = [
    { key: 'code', header: t('programs.regulations.componentCode'), width: 100, render: (_, c) => <Input value={c.code} onChange={setRow('iaComponents', c.i, 'code')} maxLength={8} aria-label={t('programs.regulations.componentCode')} /> },
    { key: 'name', header: t('programs.regulations.componentName'), render: (_, c) => <Input value={c.name} onChange={setRow('iaComponents', c.i, 'name')} maxLength={40} aria-label={t('programs.regulations.componentName')} /> },
    { key: 'maxMarks', header: t('programs.regulations.maxMarks'), width: 100, render: (_, c) => <Input type="number" value={c.maxMarks} onChange={setRow('iaComponents', c.i, 'maxMarks')} aria-label={t('programs.regulations.maxMarks')} /> },
    { key: 'x', header: '', width: 44, render: (_, c) => <Button size="sm" variant="ghost" icon={X} aria-label={t('programs.remove')} onClick={() => setForm((f) => ({ ...f, iaComponents: f.iaComponents.filter((_, j) => j !== c.i) }))} /> },
  ]
  const valid = form.code && !Object.keys(scaleErrors).length && form.iaComponents.length > 0
  return (
    <Modal open onClose={onClose} size="xl" title={regulation?.id ? t('programs.regulations.editTitle', { code: regulation.code }) : t('programs.regulations.new')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-6">
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label={t('programs.regulations.code')} required error={errors.code} hint={t('programs.regulations.codeHint')}><Input value={form.code} onChange={set('code')} maxLength={10} /></FormField>
          <FormField label={t('programs.regulations.name')} error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('programs.regulations.namePlaceholder')} /></FormField>
          <FormField label={t('programs.regulations.effectiveFrom')} hint={t('programs.regulations.effectiveFromHint')}><Input type="number" value={form.effectiveFrom} onChange={set('effectiveFrom')} placeholder="2026" /></FormField>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink mb-2">{t('programs.regulations.credits')}</p>
          <div className="grid sm:grid-cols-3 gap-4">
            <FormField label={t('programs.regulations.minCredits')} error={errors.minCredits}><Input type="number" value={form.minCredits} onChange={set('minCredits')} /></FormField>
            <FormField label={t('programs.regulations.semesterMin')} error={errors.semesterMinCredits}><Input type="number" value={form.semesterMinCredits} onChange={set('semesterMinCredits')} /></FormField>
            <FormField label={t('programs.regulations.semesterMax')} error={errors.semesterMaxCredits}><Input type="number" value={form.semesterMaxCredits} onChange={set('semesterMaxCredits')} /></FormField>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink mb-2">{t('programs.regulations.passRules')}</p>
          <div className="grid sm:grid-cols-3 gap-4">
            <FormField label={t('programs.regulations.minInternal')}><Input type="number" value={form.passRules.minInternalPct} onChange={setIn('passRules', 'minInternalPct')} /></FormField>
            <FormField label={t('programs.regulations.minExternal')}><Input type="number" value={form.passRules.minExternalPct} onChange={setIn('passRules', 'minExternalPct')} /></FormField>
            <FormField label={t('programs.regulations.minTotal')}><Input type="number" value={form.passRules.minTotalPct} onChange={setIn('passRules', 'minTotalPct')} /></FormField>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-ink">{t('programs.regulations.gradeScale')}</p>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, gradeScale: [...f.gradeScale, { ...blankBand }] }))}>{t('programs.regulations.addGrade')}</Button>
          </div>
          <DataTable dense rows={form.gradeScale.map((b, i) => ({ ...b, i, id: String(i) }))} columns={scaleCols} />
          {Object.values(scaleErrors).length > 0 && <p className="mt-2 text-xs text-danger-600">{[...new Set(Object.values(scaleErrors))].join(' · ')}</p>}
          <div className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
            <Switch size="sm" checked={form.countFailed} onChange={set('countFailed')} label={t('programs.regulations.countFailed')} />
            {t('programs.regulations.countFailed')}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-ink">{t('programs.regulations.components', { total: iaTotal })}</p>
            <Button size="sm" variant="ghost" icon={Plus} disabled={form.iaComponents.length >= 10} onClick={() => setForm((f) => ({ ...f, iaComponents: [...f.iaComponents, { code: '', name: '', maxMarks: 10 }] }))}>{t('programs.regulations.addComponent')}</Button>
          </div>
          <DataTable dense rows={form.iaComponents.map((c, i) => ({ ...c, i, id: String(i) }))} columns={iaCols} />
          <p className="mt-1 text-xs text-ink-faint">{t('programs.regulations.componentsHint')}</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink mb-2">{t('programs.regulations.attainment')}</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label={t('programs.regulations.targetPct')} hint={t('programs.regulations.targetPctHint')}><Input type="number" value={form.attainment.targetPct} onChange={setIn('attainment', 'targetPct')} /></FormField>
            <FormField label={t('programs.regulations.internalWeight')} hint={t('programs.regulations.internalWeightHint')}><Input type="number" value={form.attainment.internalWeight} onChange={setIn('attainment', 'internalWeight')} /></FormField>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ───────────────────────────────────────────────────────── program

export function ProgramForm({ program, onClose, onSaved }) {
  const { t } = useTranslation('programs')
  const { showError } = useSnackbar()
  const { data: regs = [] } = useQuery({ queryKey: ['regulations'], queryFn: fetchRegulations })
  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const { data: branches = [] } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches })
  const { data: staff = [] } = useQuery({ queryKey: ['program-staff'], queryFn: fetchProgramStaff })
  const [form, setForm] = useState(() => ({
    name: '', code: '', level: 'UG', durationYears: 4, semesters: 8, intake: '', regulationId: regs[0]?.id ?? '',
    departmentId: '', branchId: '', coordinatorId: '', active: true,
    ...Object.fromEntries(Object.entries(program ?? {}).map(([k, v]) => [k, v ?? ''])),
  }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const regulationId = form.regulationId || regs.find((r) => r.active)?.id || ''
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name, code: form.code, level: form.level, durationYears: Number(form.durationYears), semesters: Number(form.semesters),
        intake: numOrNull(form.intake), regulationId: regulationId || null, departmentId: form.departmentId || null, branchId: form.branchId || null,
        coordinatorId: form.coordinatorId || null, ...(program && { active: !!form.active }),
      }
      return program ? updateProgram(program.id, body) : createProgram(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  const setLevel = (e) => {
    const level = e.target.value
    const years = PROGRAM_LEVELS[level]?.years ?? 3
    setForm((f) => ({ ...f, level, ...(!program && { durationYears: years, semesters: years * 2 }) }))
  }
  return (
    <Modal open onClose={onClose} size="lg" title={program ? t('programs.programs.editTitle', { name: program.name }) : t('programs.programs.new')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name || !form.code} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2"><FormField label={t('programs.programs.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('programs.programs.namePlaceholder')} /></FormField></div>
        <FormField label={t('programs.programs.code')} required error={errors.code}><Input value={form.code} onChange={set('code')} maxLength={12} placeholder="BTCSE" /></FormField>
        <FormField label={t('programs.programs.level')}>
          <Select value={form.level} onChange={setLevel}>{Object.keys(PROGRAM_LEVELS).map((k) => <option key={k} value={k}>{t(`programs.levels.${k}`)}</option>)}</Select>
        </FormField>
        <FormField label={t('programs.programs.years')} error={errors.durationYears}><Input type="number" value={form.durationYears} onChange={set('durationYears')} /></FormField>
        <FormField label={t('programs.programs.semesters')} error={errors.semesters}><Input type="number" value={form.semesters} onChange={set('semesters')} /></FormField>
        <FormField label={t('programs.programs.regulation')} error={errors.regulationId}>
          <Select value={regulationId} onChange={set('regulationId')}>
            <option value="">{t('programs.none')}</option>
            {regs.map((r) => <option key={r.id} value={r.id}>{r.code}{r.name ? ` · ${r.name}` : ''}</option>)}
          </Select>
        </FormField>
        <FormField label={t('programs.programs.intake')} error={errors.intake}><Input type="number" value={form.intake} onChange={set('intake')} /></FormField>
        <FormField label={t('programs.programs.department')}>
          <Select value={form.departmentId} onChange={set('departmentId')}>
            <option value="">{t('programs.none')}</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t('programs.programs.campus')}>
          <Select value={form.branchId} onChange={set('branchId')}>
            <option value="">{t('programs.allCampuses')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </FormField>
        <div className="sm:col-span-2"><FormField label={t('programs.programs.coordinator')}>
          <Select value={form.coordinatorId} onChange={set('coordinatorId')}>
            <option value="">{t('programs.none')}</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.name}{u.designation ? ` · ${u.designation}` : ''}</option>)}
          </Select>
        </FormField></div>
        {program && <div className="flex items-end gap-2 pb-2 text-sm text-ink-muted"><Switch checked={!!form.active} onChange={set('active')} label={t('programs.active')} />{t('programs.active')}</div>}
      </div>
    </Modal>
  )
}

// ───────────────────────────────────────────────────────── course

export function CourseForm({ program, course, courses = [], semester, onClose, onSaved }) {
  const { t } = useTranslation('programs')
  const { showError } = useSnackbar()
  const [form, setForm] = useState(() => ({
    code: '', title: '', semester: semester || 1, type: 'CORE', electiveGroup: '', l: 3, t: 0, p: 0, credits: 3, internalMax: 40, externalMax: 60, prerequisiteIds: [], active: true,
    ...Object.fromEntries(Object.entries(course ?? {}).map(([k, v]) => [k, v ?? ''])),
  }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const setLtp = (k) => (e) => setForm((f) => {
    const next = { ...f, [k]: e.target.value }
    return { ...next, credits: creditsFromLtp(next.l, next.t, next.p) || f.credits }
  })
  const earlier = courses.filter((c) => c.semester < Number(form.semester) && c.id !== course?.id)
  const elective = form.type === 'ELECTIVE' || form.type === 'OPEN_ELECTIVE'
  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code, title: form.title, semester: Number(form.semester), type: form.type, electiveGroup: elective ? form.electiveGroup || null : null,
        l: Number(form.l), t: Number(form.t), p: Number(form.p), credits: Number(form.credits), internalMax: Number(form.internalMax), externalMax: Number(form.externalMax),
        prerequisiteIds: form.prerequisiteIds.filter((id) => earlier.some((c) => c.id === id)), ...(course && { active: !!form.active }),
      }
      return course ? updateCourse(course.id, body) : createCourse({ ...body, programId: program.id })
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  const togglePre = (id) => setForm((f) => ({ ...f, prerequisiteIds: f.prerequisiteIds.includes(id) ? f.prerequisiteIds.filter((x) => x !== id) : [...f.prerequisiteIds, id] }))
  return (
    <Modal open onClose={onClose} size="lg" title={course ? t('programs.courses.editTitle', { code: course.code }) : t('programs.courses.new', { program: program.code })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.code || !form.title} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <FormField label={t('programs.courses.code')} required error={errors.code}><Input value={form.code} onChange={set('code')} maxLength={12} placeholder="CS301" /></FormField>
        <div className="col-span-1 sm:col-span-3"><FormField label={t('programs.courses.title')} required error={errors.title}><Input value={form.title} onChange={set('title')} /></FormField></div>
        <FormField label={t('programs.courses.semester')} error={errors.semester}>
          <Select value={form.semester} onChange={set('semester')}>{Array.from({ length: program.semesters }, (_, i) => <option key={i + 1} value={i + 1}>{t('programs.semesterN', { n: i + 1 })}</option>)}</Select>
        </FormField>
        <FormField label={t('programs.courses.type')}>
          <Select value={form.type} onChange={set('type')}>{Object.keys(PROGRAM_COURSE_TYPES).map((k) => <option key={k} value={k}>{t(`programs.courseTypes.${k}`)}</option>)}</Select>
        </FormField>
        {elective && <FormField label={t('programs.courses.group')} hint={t('programs.courses.groupHint')}><Input value={form.electiveGroup} onChange={set('electiveGroup')} maxLength={10} placeholder="PE1" /></FormField>}
        <FormField label={t('programs.courses.ltp')} hint={t('programs.courses.ltpHint')}>
          <div className="flex gap-1.5">
            <Input type="number" value={form.l} onChange={setLtp('l')} aria-label="L" />
            <Input type="number" value={form.t} onChange={setLtp('t')} aria-label="T" />
            <Input type="number" value={form.p} onChange={setLtp('p')} aria-label="P" />
          </div>
        </FormField>
        <FormField label={t('programs.courses.credits')} required error={errors.credits}><Input type="number" step="0.5" value={form.credits} onChange={set('credits')} /></FormField>
        <FormField label={t('programs.courses.internalMax')} error={errors.internalMax}><Input type="number" value={form.internalMax} onChange={set('internalMax')} /></FormField>
        <FormField label={t('programs.courses.externalMax')} error={errors.externalMax}><Input type="number" value={form.externalMax} onChange={set('externalMax')} /></FormField>
      </div>
      <div className="mt-5">
        <p className="text-sm font-semibold text-ink">{t('programs.courses.prerequisites')}</p>
        <p className="text-xs text-ink-faint mb-2">{t('programs.courses.prerequisitesHint')}</p>
        {errors.prerequisiteIds && <p className="text-xs text-danger-600 mb-2">{errors.prerequisiteIds}</p>}
        {earlier.length === 0 ? <p className="text-sm text-ink-faint">{t('programs.courses.noEarlier')}</p> : (
          <div className="flex flex-wrap gap-2">
            {earlier.map((c) => {
              const on = form.prerequisiteIds.includes(c.id)
              return (
                <button key={c.id} type="button" onClick={() => togglePre(c.id)} aria-pressed={on}
                  className={on ? 'rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700' : 'rounded-full border border-border bg-surface px-3 py-1 text-xs text-ink-muted hover:bg-bg'}>
                  {c.code} · {c.title}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {course && <div className="mt-4 flex items-center gap-2 text-sm text-ink-muted"><Switch checked={!!form.active} onChange={set('active')} label={t('programs.active')} />{t('programs.active')}</div>}
    </Modal>
  )
}

// ───────────────────────────────────────────────────────── students

export function EnrolModal({ program, onClose, onSaved }) {
  const { t } = useTranslation('programs')
  const { showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState([])
  const [batch, setBatch] = useState(new Date().getFullYear())
  const [semester, setSemester] = useState(1)
  const [advisorId, setAdvisorId] = useState('')
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['enrol-candidates', search], queryFn: () => fetchEnrolmentCandidates(search) })
  const { data: staff = [] } = useQuery({ queryKey: ['program-staff'], queryFn: fetchProgramStaff })
  const save = useMutation({
    mutationFn: () => enrolStudents(program.id, { studentIds: picked, batch: Number(batch), currentSemester: Number(semester), advisorId: advisorId || undefined }),
    onSuccess: onSaved,
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} size="lg" title={t('programs.students.enrolTitle', { program: program.code })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!picked.length} onClick={() => save.mutate()}>{t('programs.students.enrolN', { count: picked.length })}</Button>
    </>}>
      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        <FormField label={t('programs.students.batch')} hint={t('programs.students.batchHint')}><Input type="number" value={batch} onChange={(e) => setBatch(e.target.value)} /></FormField>
        <FormField label={t('programs.students.semester')}>
          <Select value={semester} onChange={(e) => setSemester(e.target.value)}>{Array.from({ length: program.semesters }, (_, i) => <option key={i + 1} value={i + 1}>{t('programs.semesterN', { n: i + 1 })}</option>)}</Select>
        </FormField>
        <FormField label={t('programs.students.advisor')}>
          <Select value={advisorId} onChange={(e) => setAdvisorId(e.target.value)}>
            <option value="">{t('programs.none')}</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField>
      </div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" aria-hidden />
        <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('programs.students.searchPlaceholder')} aria-label={t('programs.students.searchPlaceholder')} />
      </div>
      <DataTable dense maxHeight="40vh" loading={isLoading} rows={rows} selectable selectedIds={picked} onSelectionChange={setPicked}
        emptyTitle={t('programs.students.noCandidates')} emptyHint={t('programs.students.noCandidatesHint')}
        columns={[
          { key: 'name', header: t('programs.students.student'), render: (v, r) => <PersonCell name={v} sub={r.admissionNo} /> },
        ]} />
    </Modal>
  )
}

export function EnrolmentForm({ program, enrolment, onClose, onSaved }) {
  const { t } = useTranslation('programs')
  const { showError } = useSnackbar()
  const { data: staff = [] } = useQuery({ queryKey: ['program-staff'], queryFn: fetchProgramStaff })
  const [form, setForm] = useState({ registerNo: enrolment.registerNo ?? '', currentSemester: enrolment.currentSemester, status: enrolment.status, advisorId: enrolment.advisorId ?? '', batch: enrolment.batch })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => updateEnrolment(enrolment.id, { registerNo: form.registerNo || null, currentSemester: Number(form.currentSemester), status: form.status, advisorId: form.advisorId || null, batch: Number(form.batch) }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={enrolment.name} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('programs.students.registerNo')} error={errors.registerNo}><Input value={form.registerNo} onChange={set('registerNo')} maxLength={20} /></FormField>
        <FormField label={t('programs.students.batch')}><Input type="number" value={form.batch} onChange={set('batch')} /></FormField>
        <FormField label={t('programs.students.semester')} error={errors.currentSemester}>
          <Select value={form.currentSemester} onChange={set('currentSemester')}>{Array.from({ length: program.semesters }, (_, i) => <option key={i + 1} value={i + 1}>{t('programs.semesterN', { n: i + 1 })}</option>)}</Select>
        </FormField>
        <FormField label={t('programs.students.status')}>
          <Select value={form.status} onChange={set('status')}>{['ACTIVE', 'DETAINED', 'COMPLETED', 'DISCONTINUED'].map((k) => <option key={k} value={k}>{t(`programs.enrolmentStatus.${k}`)}</option>)}</Select>
        </FormField>
        <div className="sm:col-span-2"><FormField label={t('programs.students.advisor')}>
          <Select value={form.advisorId} onChange={set('advisorId')}>
            <option value="">{t('programs.none')}</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField></div>
      </div>
    </Modal>
  )
}
