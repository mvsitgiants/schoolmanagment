import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FlaskConical, Info, UserRound } from 'lucide-react'
import { FormPage, Money, Note, Panel, SectionCard } from '../../components/system'
import Button from '../../components/ui/Button'
import { ProjectFields, projectBody, projectFormValues, projectReady } from '../../components/research/ProjectForm'
import { ProjectPill, useResearchLabels, useResearchMeta } from '../../components/research/ResearchKit'
import { fetchProjects, saveProject } from '../../api/research'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'

const norm = (s) => String(s ?? '').trim().toLowerCase()
/** The words of a title that say something (four letters or more). */
const wordsOf = (s) => [...new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4))]

/** One project as a line: title, status, agency and the amount sanctioned. */
function ProjectLine({ p }) {
  const L = useResearchLabels()
  return (
    <li className="px-4 py-2.5 space-y-1">
      <span className="block text-sm font-medium text-ink line-clamp-2">{p.title}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
        <ProjectPill status={p.status} />
        <span>{L.agency(p.agency)}</span>
        {p.sanctioned > 0 && <Money value={p.sanctioned} paise compact />}
      </span>
    </li>
  )
}

/** Right-hand panel: projects already added with a similar title or the same sanction order number. */
function AlreadyAdded({ form, rows }) {
  const { t } = useTranslation('research')
  const key = useDebouncedValue(`${norm(form.title)}|${norm(form.referenceNo)}`, 350)
  const [title, ref] = key.split('|')
  const words = wordsOf(title)
  const need = Math.min(2, words.length)
  const hits = (rows ?? []).filter((p) => {
    if (ref.length >= 3 && norm(p.referenceNo) === ref) return true
    if (!need) return false
    const theirs = new Set(wordsOf(p.title))
    return words.filter((w) => theirs.has(w)).length >= need && (words.length > 1 || norm(p.title).includes(title))
  }).slice(0, 5)

  if (!hits.length) {
    return (
      <Panel title={t('research.projects.check.title')}>
        <p className="text-sm text-ink-muted">{t('research.projects.check.empty')}</p>
      </Panel>
    )
  }
  return (
    <SectionCard icon={FlaskConical} tone="warning" title={t('research.projects.check.title')} count={hits.length} flush>
      <p className="px-4 pt-3 text-xs text-ink-muted">{t('research.projects.check.found')}</p>
      <ul className="divide-y divide-border">{hits.map((p) => <ProjectLine key={p.id} p={p} />)}</ul>
    </SectionCard>
  )
}

/** Right-hand panel: the other projects the chosen principal investigator already leads or works on. */
function PiProjects({ piId, rows }) {
  const { t } = useTranslation('research')
  const { data: meta } = useResearchMeta()
  if (!piId) return null
  const name = (meta?.staff ?? []).find((s) => s.id === piId)?.name ?? ''
  const theirs = (rows ?? []).filter((p) => p.piId === piId || p.coPiIds?.includes(piId))
  const running = theirs.filter((p) => p.status === 'ONGOING' || p.status === 'SANCTIONED').length
  return (
    <SectionCard icon={UserRound} title={t('research.projects.piCheck.title', { name })} count={theirs.length || undefined} flush>
      {!theirs.length ? <p className="px-4 py-3 text-sm text-ink-muted">{t('research.projects.piCheck.none')}</p> : (
        <>
          <p className="px-4 pt-3 text-xs text-ink-muted">{t('research.projects.piCheck.running', { count: running })}</p>
          <ul className="divide-y divide-border">{theirs.slice(0, 5).map((p) => <ProjectLine key={p.id} p={p} />)}</ul>
        </>
      )}
    </SectionCard>
  )
}

/** Research › New project: a full page; after saving, back to the list of projects. */
export default function NewProject() {
  const { t } = useTranslation('research')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(() => projectFormValues(null))
  const [errors, setErrors] = useState({})
  // every project the person can see, once — the two checks on the right filter it as they type
  const { data } = useQuery({ queryKey: ['research', 'projects', {}], queryFn: () => fetchProjects({}) })
  const save = useMutation({
    mutationFn: () => saveProject(null, projectBody(form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research'] })
      showSuccess(t('research.projects.saved'))
      navigate('/research/projects')
    },
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })

  return (
    <FormPage
      icon={FlaskConical} title={t('research.projects.newTitle')} subtitle={t('research.projects.form.subtitle')}
      headerActions={<Button to="/research/projects" variant="secondary" icon={FlaskConical}>{t('research.projects.form.allProjects')}</Button>}
      errors={errors}
      submitLabel={t('research.projects.save')} submitIcon={FlaskConical} requires="create"
      onSubmit={() => save.mutate()} saving={save.isPending} canSubmit={projectReady(form)}
      onCancel={() => navigate('/research/projects')}
      aside={<>
        <AlreadyAdded form={form} rows={data?.rows} />
        <PiProjects piId={form.piId} rows={data?.rows} />
        <Note icon={Info}>{t('research.projects.form.requiredNote')}</Note>
      </>}
    >
      <ProjectFields value={form} onChange={setForm} errors={errors} />
    </FormPage>
  )
}
