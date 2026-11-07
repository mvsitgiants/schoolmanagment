import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, CheckCircle2, Trophy, Undo2, Users, XCircle } from 'lucide-react'
import { RESULT_STATUS } from '@schoolgiant/shared'
import { DataTable, Note, PageContainer, PageHeader, StatCardRow, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useExamPick from '../../components/exams/useExamPick'
import { fetchResults, publishResults, unpublishResults } from '../../api/exams'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'


/** One section's result sheet, and publishing the exam's results. */
export default function Results() {
  const { t } = useTranslation('exams')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime, number } = useFormat()
  const num = (n) => (n === null || n === undefined ? '—' : number(Math.round(Number(n) * 100) / 100))
  const { showSuccess, showError } = useSnackbar()
  const { exam, examId, sectionId, chips, noExams } = useExamPick()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['exam-results', examId, sectionId], queryFn: () => fetchResults(examId, sectionId), enabled: !!examId && !!sectionId })
  const refresh = () => ['exam-results', 'exams', 'exam', 'exam-candidates'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const canPublish = hasPermission('exams.results.publish')
  const s = data?.summary
  const published = data?.exam.status === 'PUBLISHED'
  const resultLabel = (r) => t(`exams.result.${r}`, RESULT_STATUS[r]?.label ?? r)

  const columns = useMemo(() => [
    { key: 'rollNo', header: t('exams.roll'), width: 60, render: (v) => <span className="font-mono-num">{v ?? '—'}</span> },
    { key: 'name', header: t('exams.student'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.admissionNo}</p></div> },
    ...(data?.papers ?? []).map((p) => ({
      key: `p_${p.id}`, header: p.locked ? p.subject : `${p.subject} *`,
      align: p.gradeOnly ? 'center' : 'right', mobileHidden: true, sortable: false,
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
    { key: 'pct', header: '%', align: 'right', sortable: true, render: (v) => num(v) },
    { key: 'grade', header: t('exams.results.grade'), align: 'center', render: (v) => v ?? '—' },
    { key: 'rank', header: t('exams.results.rank'), align: 'right', sortable: true, render: (v) => v ?? '—' },
    { key: 'result', header: t('exams.results.result'), render: (v) => <StatusPill tone={RESULT_STATUS[v]?.tone}>{resultLabel(v)}</StatusPill> },
  ], [data, t]) // eslint-disable-line react-hooks/exhaustive-deps
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
      {data && (published
        ? <Note tone="success" className="mb-4">{t('exams.results.publishedNote', { name: data.exam.publishedBy ?? '—', at: dateTime(data.exam.publishedAt) })}</Note>
        : <Note tone={s.sheetsLocked < s.sheetsTotal ? 'warning' : 'info'} className="mb-4">{t('exams.results.provisional', { locked: s.sheetsLocked, total: s.sheetsTotal })}</Note>)}
      {anyOpen && !published && <Note className="mb-4">{t('exams.results.starNote')}</Note>}
      {s && <StatCardRow className="mb-4" items={[
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
        toolbar={<div className="flex flex-wrap justify-end gap-2">{chips}</div>}
        columns={columns}
        emptyIcon={Trophy} emptyTitle={exam ? t('exams.results.empty') : t('exams.pick.pickFirst')}
      />
    </PageContainer>
  )
}
