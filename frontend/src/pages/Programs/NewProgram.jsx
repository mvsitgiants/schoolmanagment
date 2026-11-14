import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookMarked, GraduationCap, Info, Scale } from 'lucide-react'
import { FactGrid, FormPage, Note, Panel, SectionCard } from '../../components/system'
import Button from '../../components/ui/Button'
import { ProgramFields, programBody, programFormValues, programRegulationId } from '../../components/programs/ProgramForms'
import { createProgram, fetchPrograms, fetchRegulations } from '../../api/programs'
import { useSnackbar } from '../../context/SnackbarContext'

const norm = (s) => String(s ?? '').trim().toLowerCase()

/** Right-hand panel: programs already set up with the same code or a similar name — a code can be used once only. */
function AlreadySetUp({ form }) {
  const { t } = useTranslation('programs')
  const { data: programs = [] } = useQuery({ queryKey: ['programs'], queryFn: fetchPrograms })
  const name = norm(form.name)
  const code = norm(form.code)
  const sameCode = code ? programs.find((p) => norm(p.code) === code) : null
  const similar = name.length >= 3 ? programs.filter((p) => p !== sameCode && (norm(p.name).includes(name) || name.includes(norm(p.name)))).slice(0, 5) : []
  const rows = [...(sameCode ? [sameCode] : []), ...similar]

  if (!rows.length) {
    return (
      <Panel title={t('programs.programs.check.title')}>
        <p className="text-sm text-ink-muted">{programs.length ? t('programs.programs.check.empty', { count: programs.length }) : t('programs.programs.check.none')}</p>
      </Panel>
    )
  }
  return (
    <SectionCard icon={GraduationCap} tone="warning" title={t('programs.programs.check.title')} count={rows.length} flush>
      {sameCode && <p className="px-4 pt-3 text-xs font-medium text-danger-600">{t('programs.programs.check.codeTaken', { code: sameCode.code })}</p>}
      {similar.length > 0 && <p className="px-4 pt-3 text-xs text-ink-muted">{t('programs.programs.check.byName')}</p>}
      <ul className="divide-y divide-border">
        {rows.map((p) => (
          <li key={p.id}>
            <Link to={`/programs/programs?program=${p.id}`} className="block px-4 py-2.5 hover:bg-bg">
              <span className="block text-sm font-medium text-ink truncate">{p.name}</span>
              <span className="block text-xs text-ink-muted truncate">
                {[p.code, t(`programs.levels.${p.level}`), p.departmentName, t('programs.programs.check.students', { count: p.studentCount })].filter(Boolean).join(' · ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/** Right-hand panel: what the picked regulation asks of this program — credits to graduate and a semester's share. */
function AtAGlance({ form }) {
  const { t } = useTranslation('programs')
  const { data: regs = [] } = useQuery({ queryKey: ['regulations'], queryFn: fetchRegulations })
  const reg = regs.find((r) => r.id === programRegulationId(form, regs))
  const years = Number(form.durationYears) || 0
  const semesters = Number(form.semesters) || 0
  const perSemester = reg && semesters ? Math.round((reg.minCredits / semesters) * 10) / 10 : null
  const outOfRange = perSemester != null && (perSemester < reg.semesterMinCredits || perSemester > reg.semesterMaxCredits)
  return (
    <Panel title={t('programs.programs.glance.title')} icon={Scale}>
      <FactGrid cols={2} items={[
        { label: t('programs.programs.duration'), value: years && semesters ? t('programs.programs.durationValue', { years, semesters }) : null },
        { label: t('programs.programs.intake'), value: form.intake ? t('programs.programs.intakeSub', { intake: form.intake }) : null },
        { label: t('programs.programs.regulation'), value: reg ? `${reg.code}${reg.name ? ` · ${reg.name}` : ''}` : null },
        { label: t('programs.programs.glance.toGraduate'), value: reg ? t('programs.programs.glance.credits', { count: reg.minCredits }) : null },
      ]} />
      {reg && perSemester != null && (
        <p className={outOfRange ? 'mt-3 text-xs text-danger-600' : 'mt-3 text-xs text-ink-muted'}>
          {t(outOfRange ? 'programs.programs.glance.perSemesterOff' : 'programs.programs.glance.perSemester', { n: perSemester, min: reg.semesterMinCredits, max: reg.semesterMaxCredits })}
        </p>
      )}
      {reg && <p className="mt-2 text-xs text-ink-muted">{t('programs.programs.glance.passRule', { rule: t('programs.programs.passRuleValue', reg.passRules) })}</p>}
      {!regs.length && <p className="mt-3 text-xs text-ink-muted">{t('programs.programs.glance.noRegulation')}</p>}
    </Panel>
  )
}

/** Programs › New program: a full page; after saving, the new program opens so its courses can be added. */
export default function NewProgram() {
  const { t } = useTranslation('programs')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: regs = [] } = useQuery({ queryKey: ['regulations'], queryFn: fetchRegulations })
  const [form, setForm] = useState(() => programFormValues(null))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => createProgram(programBody(form, regs)),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['programs'] })
      showSuccess(t('programs.programs.saved'))
      navigate(`/programs/programs?program=${p.id}`)
    },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const ready = form.name.trim() && form.code.trim()

  return (
    <FormPage
      icon={BookMarked} title={t('programs.programs.new')} subtitle={t('programs.programs.form.subtitle')}
      headerActions={<Button to="/programs/programs" variant="secondary" icon={GraduationCap}>{t('programs.programs.form.allPrograms')}</Button>}
      errors={errors}
      submitLabel={t('programs.programs.form.save')} submitIcon={BookMarked} requires="create"
      onSubmit={() => save.mutate()} saving={save.isPending} canSubmit={!!ready}
      onCancel={() => navigate('/programs/programs')}
      aside={<>
        <AlreadySetUp form={form} />
        <AtAGlance form={form} />
        <Note icon={Info}>{t('programs.programs.form.requiredNote')}</Note>
      </>}
    >
      <ProgramFields value={form} onChange={setForm} errors={errors} />
    </FormPage>
  )
}
