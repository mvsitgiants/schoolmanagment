import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, CheckCircle2, Medal, Trophy, Undo2, Users, XCircle } from 'lucide-react'
import { RESULT_STATUS } from '@schoolgiant/shared'
import { ColorChip, DataTable, LevelBar, Note, PageContainer, PageHeader, PersonCell, SideNavLayout, StatCardRow, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useExamPick from '../../components/exams/useExamPick'
import { fetchResults, publishResults, unpublishResults } from '../../api/exams'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useIsMobile } from '../../hooks/useMediaQuery'


/** One section's result sheet, and publishing the exam's results. */
export default function Results() {
  const { t } = useTranslation('exams')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const isMobile = useIsMobile()
  const { dateTime, number } = useFormat()
  const num = (n) => (n === null || n === undefined ? '—' : number(Math.round(Number(n) * 100) / 100))
  const { showSuccess, showError } = useSnackbar()
  const { exam, examId, sectionId, section, nav, sectionPills, noExams } = useExamPick()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['exam-results', examId, sectionId], queryFn: () => fetchResults(examId, sectionId), enabled: !!examId && !!sectionId })
  const refresh = () => ['exam-results', 'exams', 'exam', 'exam-candidates'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const canPublish = hasPermission('exams.results.publish')
  const s = data?.summary
  const published = data?.exam.status === 'PUBLISHED'
  const resultLabel = (r) => t(`exams.result.${r}`, RESULT_STATUS[r]?.label ?? r)

  const RANK_TONE = ['warning', 'neutral', 'orange']
  const columns = useMemo(() => [
    { key: 'rollNo', header: t('exams.roll'), width: 60, render: (v) => <span className="font-mono-num">{v ?? '—'}</span> },
    { key: 'name', header: t('exams.student'), mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={r.admissionNo} /> },
    ...(data?.papers ?? []).map((p) => ({
      key: `p_${p.id}`, header: p.locked ? p.subject : `${p.subject} *`,
      align: p.gradeOnly ? 'center' : 'right', sortable: false,
      render: (_, r) => {
        const m = r.marks[p.id]
        if (!m) return <span className="text-ink-faint">—</span>
        if (m.exempt) return <span className="text-ink-faint">{t('exams.results.na')}</span>
        if (m.absent) return <span className="text-danger-600">{t('exams.results.ab')}</span>
        if (p.gradeOnly) return m.grade ?? '—'
        return <span className={m.pass ? undefined : 'text-danger-600 font-medium'}>{num(m.marks)}</span>
      },
    })),
    { key: 'total', header: t('exams.results.total'), align: 'right', render: (v, r) => (v === null || v === undefined ? '—' : `${num(v)} / ${r.max}`) },
    { key: 'pct', header: '%', align: 'right', sortable: true, mobilePrimary: true, mobileLabel: t('exams.results.pctLabel'), render: (v, r) => (v === null || v === undefined ? '—' : (
      <div className="inline-flex items-center justify-end gap-2">
        {!isMobile && <LevelBar bare value={v} max={100} width="w-14" dangerAt={r.result === 'FAIL' ? 100 : undefined} />}
        <span className={r.result === 'FAIL' ? 'font-semibold tabular-nums text-danger-600' : 'font-semibold tabular-nums text-ink'}>{num(v)}{isMobile ? '%' : ''}</span>
        {isMobile && r.grade && <ColorChip label={r.grade} seed={`grade-${r.grade}`} mono />}
        {isMobile && r.rank != null && r.rank <= 3 && <ColorChip label={r.rank} icon={Medal} tone={RANK_TONE[r.rank - 1]} />}
      </div>
    )) },
    { key: 'grade', header: t('exams.results.grade'), align: 'center', render: (v) => <ColorChip label={v} seed={v ? `grade-${v}` : undefined} mono /> },
    { key: 'rank', header: t('exams.results.rank'), align: 'right', sortable: true, render: (v) => (v != null && v <= 3 ? <ColorChip label={v} icon={Medal} tone={RANK_TONE[v - 1]} /> : v ?? '—') },
    { key: 'result', header: t('exams.results.result'), mobileTrail: true, render: (v) => <StatusPill tone={RESULT_STATUS[v]?.tone}>{resultLabel(v)}</StatusPill> },
  ], [data, t, isMobile]) // eslint-disable-line react-hooks/exhaustive-deps
  // each paper's mark as plain text too, so the CSV export carries it
  const rows = useMemo(() => (data?.rows ?? []).map((r) => ({
    ...r,
    ...Object.fromEntries((data?.papers ?? []).map((p) => {
      const m = r.marks[p.id]
      return [`p_${p.id}`, !m ? '' : m.exempt ? t('exams.results.na') : m.absent ? t('exams.results.ab') : p.gradeOnly ? m.grade ?? '' : m.marks ?? '']
    })),
  })), [data, t])
  const anyOpen = (data?.papers ?? []).some((p) => !p.locked)

  return (
    <PageContainer>
      <PageHeader icon={Trophy} title={t('exams.results.title')} subtitle={t('exams.results.subtitle')}
        actions={canPublish && exam && (published
          ? <Button variant="secondary" icon={Undo2} loading={act.isPending} onClick={async () => { if (await confirm({ title: t('exams.results.unpublishConfirm.title', { name: exam.name }), message: t('exams.results.unpublishConfirm.message'), tone: 'danger', confirmLabel: t('exams.results.unpublish') })) act.mutate({ fn: () => unpublishResults(examId), done: t('exams.results.unpublished') }) }}>{t('exams.results.unpublish')}</Button>
          : exam.status === 'SCHEDULED' && <Button icon={Award} loading={act.isPending} onClick={async () => { if (await confirm({ title: t('exams.results.publishConfirm.title', { name: exam.name }), message: t('exams.results.publishConfirm.message'), confirmLabel: t('exams.results.publish') })) act.mutate({ fn: () => publishResults(examId), done: t('exams.results.published') }) }}>{t('exams.results.publish')}</Button>)} />
      {noExams && <Note className="mb-4">{t('exams.pick.noneScheduled')}</Note>}
      <SideNavLayout nav={nav}>
        {sectionPills}
        {data && (published
          ? <Note tone="success">{t('exams.results.publishedNote', { name: data.exam.publishedBy ?? '—', at: dateTime(data.exam.publishedAt) })}</Note>
          : <Note tone={s.sheetsLocked < s.sheetsTotal ? 'warning' : 'info'}>{t('exams.results.provisional', { locked: s.sheetsLocked, total: s.sheetsTotal })}</Note>)}
        {anyOpen && !published && <Note>{t('exams.results.starNote')}</Note>}
        {s && <StatCardRow items={[
          { icon: Users, label: t('exams.results.students'), value: s.students, sub: s.incomplete ? t('exams.results.incompleteSub', { count: s.incomplete }) : undefined },
          { icon: CheckCircle2, label: t('exams.results.passed'), value: s.passed, tone: 'success' },
          { icon: XCircle, label: t('exams.results.failed'), value: s.failed, tone: s.failed ? 'danger' : 'neutral' },
          { icon: Trophy, label: t('exams.results.highest'), value: s.highest === null ? '—' : `${num(s.highest)}%`, sub: s.average === null ? undefined : t('exams.results.averageSub', { avg: num(s.average) }) },
        ]} />}
        <DataTable
          rows={rows}
          rowKey="candidateId"
          loading={isLoading}
          error={error}
          onRetry={refetch}
          exportable exportName="exam-results"
          rowTone={(r) => (r.result === 'FAIL' ? 'danger' : undefined)}
          title={exam && section ? `${exam.name} · ${section.label}` : undefined}
          columns={columns}
          emptyIcon={Trophy} emptyTitle={exam ? t('exams.results.empty') : t('exams.pick.pickFirst')}
        />
      </SideNavLayout>
    </PageContainer>
  )
}
