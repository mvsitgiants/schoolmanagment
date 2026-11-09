import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BarChart3, Download, EyeOff, Inbox, MessageSquareHeart, Percent, Send, Users } from 'lucide-react'
import {
  DataTable, DateCell, Drawer, EmptyState, Note, PageContainer, PageHeader, Panel, PersonCell, SideNav, SideNavLayout, StatCardRow, StatusPill,
} from '../../components/system'
import Button from '../../components/ui/Button'
import FormRenderer from '../../components/forms/FormRenderer'
import { AudienceChip, QuestionChart, RateBar, StatePill } from '../../components/surveys/SurveyKit'
import { downloadSurveyCsv, fetchSurveyResults, fetchSurveys } from '../../api/surveys'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

/** Response rate by class: one bar per section; picking one filters the charts to it. */
function RateByClass({ rows, value, onPick }) {
  const { t } = useTranslation('surveys')
  if (!rows.length) return null
  return (
    <Panel title={t('surveys.results.byClass')} subtitle={t('surveys.results.byClassHint')} icon={Users}>
      <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <button key={r.sectionId} type="button" onClick={() => onPick(value === r.sectionId ? '' : r.sectionId)}
            className={clsx('rounded-lg px-2 py-1.5 text-start transition', value === r.sectionId ? 'bg-brand-50 ring-1 ring-brand-300' : value ? 'opacity-50 hover:opacity-90' : 'hover:bg-black/[0.02]')}>
            <p className="mb-0.5 text-sm font-semibold text-ink">{r.label}</p>
            <RateBar rate={r.rate} responded={r.responded} invited={r.invited} />
          </button>
        ))}
      </div>
    </Panel>
  )
}

function Results({ id }) {
  const { t } = useTranslation('surveys')
  const { showError } = useSnackbar()
  const [sectionId, setSectionId] = useState('')
  const [open, setOpen] = useState(null)
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['surveys', 'results', id, sectionId], queryFn: () => fetchSurveyResults(id, sectionId), enabled: !!id })
  const csv = useMutation({ mutationFn: () => downloadSurveyCsv(id, `${data?.survey?.title ?? 'survey'}.csv`), onError: (e) => showError(e.message) })
  if (isLoading) return <div className="h-64 animate-pulse rounded-2xl bg-black/[0.04]" />
  if (error) return <EmptyState error={error} onRetry={refetch} />
  if (!data) return null
  const s = data.survey
  const section = data.bySection.find((b) => b.sectionId === sectionId)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-xl font-semibold text-ink">{s.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5"><StatePill value={s.state} /><AudienceChip value={s.audience} />{s.anonymous && <StatusPill tone="neutral"><EyeOff className="me-1 inline h-3 w-3" />{t('surveys.list.anonymous')}</StatusPill>}{section && <StatusPill tone="info">{section.label}</StatusPill>}</div>
        </div>
        {hasPermission('surveys.responses.export') && <Button variant="secondary" icon={Download} loading={csv.isPending} disabled={!data.responded} onClick={() => csv.mutate()}>{t('surveys.results.csv')}</Button>}
      </div>
      <StatCardRow items={[
        { icon: Send, tone: 'brand', label: t('surveys.results.responded'), value: data.responded },
        { icon: Users, tone: 'sky', label: t('surveys.results.invited'), value: data.invited ?? '—', sub: data.invited == null ? t('surveys.results.publicLink') : undefined },
        { icon: Percent, tone: data.rate == null ? 'neutral' : data.rate >= 70 ? 'success' : data.rate >= 40 ? 'warning' : 'danger', label: t('surveys.results.rate'), value: data.rate != null ? `${data.rate}%` : '—', progress: data.rate ?? undefined },
      ]} />
      <RateByClass rows={data.bySection} value={sectionId} onPick={setSectionId} />
      {!data.responded ? <EmptyState icon={Inbox} title={t('surveys.results.none')} hint={t('surveys.results.noneHint')} /> : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">{data.questions.map((q) => <QuestionChart key={q.key} q={q} />)}</div>
          {s.anonymous ? <Note tone="info">{t('surveys.results.anonymousNote')}</Note> : (
            <Panel title={t('surveys.results.who')} icon={Users} flush>
              <DataTable rows={data.responses} onRowClick={(r) => setOpen(r)} emptyTitle={t('surveys.results.none')}
                columns={[
                  { key: 'name', header: t('surveys.results.name'), mobilePrimary: true, render: (v, r) => <PersonCell name={v ?? '—'} sub={r.classLabel ?? undefined} /> },
                  { key: 'kind', header: t('surveys.results.kind'), mobileHidden: true, render: (v) => t(`surveys.kinds.${v}`, v ?? '') },
                  { key: 'submittedAt', header: t('surveys.results.submitted'), render: (v) => <DateCell value={v} time /> },
                ]} />
            </Panel>
          )}
        </>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.name ?? t('surveys.results.answer')} subtitle={open?.classLabel ?? undefined}>
        {open && data.definition && <FormRenderer definition={data.definition} values={open.values} readOnly />}
      </Drawer>
    </div>
  )
}

/** Surveys & feedback › Responses: pick a survey on the left; response rate by class, a chart per question, CSV. */
export default function SurveysResponses() {
  const { t } = useTranslation('surveys')
  const [params, setParams] = useSearchParams()
  const { data = [], isLoading } = useQuery({ queryKey: ['surveys', 'list'], queryFn: fetchSurveys })
  const sent = data.filter((s) => s.state !== 'DRAFT')
  const picked = params.get('survey') || sent[0]?.id || ''
  return (
    <PageContainer>
      <PageHeader icon={BarChart3} title={t('surveys.results.title')} subtitle={t('surveys.results.subtitle')} />
      {isLoading ? <div className="h-64 animate-pulse rounded-2xl bg-black/[0.04]" /> : !sent.length ? (
        <EmptyState icon={MessageSquareHeart} title={t('surveys.results.noSurveys')} hint={t('surveys.results.noSurveysHint')} />
      ) : (
        <SideNavLayout nav={<SideNav title={t('surveys.results.surveys')} value={picked} onChange={(id) => setParams({ survey: id }, { replace: true })}
          items={sent.map((s) => ({ id: s.id, label: s.title, hint: t(`surveys.states.${s.state}`), count: s.responses, progress: s.invited ? { value: s.responses, max: s.invited, kind: 'done' } : undefined }))} />}>
          <Results key={picked} id={picked} />
        </SideNavLayout>
      )}
    </PageContainer>
  )
}
