import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Download, ListChecks, Send, XCircle } from 'lucide-react'
import { ATTEMPT_STATUS, QUESTION_TYPES } from '@schoolgiant/shared'
import { DataTable, Drawer, FormField, Input, Note, PageContainer, PageHeader, Panel, ProgressBar, Select, StatCardRow, StatusPill, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { downloadResults, evaluateAttempt, fetchAttempt, fetchTestAttempts, fetchTests, releaseResults } from '../../api/onlineTests'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

/** The student's answer, as text. */
function answerText(line, t) {
  const a = line.answer
  if (a === null || a === undefined || a === '' || (Array.isArray(a) && !a.length)) return <span className="text-ink-faint">{t('tests.attempts.blank')}</span>
  if (['MCQ', 'TRUE_FALSE'].includes(line.type)) return line.options?.[Number(a)]?.text ?? '?'
  if (line.type === 'MULTI') return [].concat(a).map((i) => line.options?.[i]?.text ?? '?').join(', ')
  return <span className="whitespace-pre-line">{String(a)}</span>
}

function AttemptDrawer({ id, onClose, onChanged }) {
  const { t } = useTranslation('tests')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: a } = useQuery({ queryKey: ['attempt', id], queryFn: () => fetchAttempt(id) })
  const [manual, setManual] = useState({})
  const [feedback, setFeedback] = useState({})
  const save = useMutation({
    mutationFn: () => evaluateAttempt(id, { manual: Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, v === '' ? null : Number(v)])), feedback }),
    onSuccess: (r) => { qc.setQueryData(['attempt', id], r); setManual({}); onChanged(); showSuccess(t('tests.attempts.markedDone')) },
    onError: (e) => showError(e.message),
  })
  if (!a) return <Drawer open onClose={onClose} title={t('tests.loading')}><span /></Drawer>
  const canEval = hasPermission('online-tests.attempts.evaluate')
  return (
    <Drawer open onClose={onClose} size="xl" title={a.student?.name} subtitle={`${a.testTitle} · ${t('tests.attempts.scoreLine', { total: a.score?.total ?? 0, max: a.totalMarks, pct: a.score?.pct ?? 0 })}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <StatusPill tone={ATTEMPT_STATUS[a.status]?.tone}>{t(`tests.attemptStatus.${a.status}`)}</StatusPill>
          <span>{t('tests.attempts.startedAt', { at: dateTime(a.startedAt) })}</span>
          {a.submittedAt && <span>· {t('tests.attempts.submittedAt', { at: dateTime(a.submittedAt), how: t(`tests.reasons.${a.submitReason}`) })}</span>}
          {a.tabSwitches > 0 && <span className="text-amber-700">· {t('tests.attempts.leftTimes', { count: a.tabSwitches })}</span>}
        </div>
        {a.lines.map((l) => (
          <Panel key={l.index} title={<span className="text-sm font-normal text-ink">{l.index + 1}. {l.text}</span>}
            actions={<span className="text-sm whitespace-nowrap">{l.auto ? (l.correct ? <CheckCircle2 className="inline w-4 h-4 text-success-600" /> : <XCircle className="inline w-4 h-4 text-danger-600" />) : null} {l.pending ? t('tests.attempts.toMark') : `${l.marks}/${l.max}`}</span>}>
            <div className="space-y-2 text-sm">
              <p><span className="text-ink-muted">{t('tests.attempts.theirAnswer')}</span> {answerText(l, t)}</p>
              {l.auto && !l.correct && <p className="text-xs text-ink-muted">{t('tests.attempts.correct')} {l.type === 'FILL' ? (l.answers ?? []).join(' | ') : (l.options ?? []).filter((o) => o.correct).map((o) => o.text).join(', ')}</p>}
              {!QUESTION_TYPES[l.type]?.auto && l.answers?.length > 0 && <p className="text-xs text-ink-muted whitespace-pre-line">{t('tests.attempts.model')} {l.answers.join('\n')}</p>}
              {!l.auto && !l.blank && canEval && a.status !== 'IN_PROGRESS' && (
                <div className="grid sm:grid-cols-[100px_1fr] gap-2 items-start">
                  <FormField label={t('tests.attempts.marks', { max: l.max })}><Input type="number" min="0" max={l.max} step="0.5" value={manual[l.index] ?? (l.pending ? '' : l.marks)} onChange={(e) => setManual((m) => ({ ...m, [l.index]: e.target.value }))} /></FormField>
                  <FormField label={t('tests.attempts.feedback')}><Textarea rows={2} value={feedback[l.index] ?? l.feedback ?? ''} onChange={(e) => setFeedback((f) => ({ ...f, [l.index]: e.target.value }))} /></FormField>
                </div>
              )}
            </div>
          </Panel>
        ))}
        {canEval && a.lines.some((l) => !l.auto && !l.blank) && <Button loading={save.isPending} onClick={() => save.mutate()}>{t('tests.attempts.saveMarks')}</Button>}
      </div>
    </Drawer>
  )
}

/** Online tests › Attempts & results: who took a test, marks, the questions most got wrong; mark written answers. */
export default function Attempts() {
  const { t } = useTranslation('tests')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: tests = [] } = useQuery({ queryKey: ['tests', 'given'], queryFn: () => fetchTests({}) })
  const given = tests.filter((x) => x.status !== 'DRAFT')
  const [testId, setTestId] = useState('')
  const [open, setOpen] = useState(null)
  const id = testId || given[0]?.id
  const test = given.find((x) => x.id === id)
  const { data, isLoading } = useQuery({ queryKey: ['test-attempts', id], queryFn: () => fetchTestAttempts(id), enabled: !!id })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['test-attempts', id] }); qc.invalidateQueries({ queryKey: ['tests'] }) }
  const release = useMutation({ mutationFn: () => releaseResults(id), onSuccess: () => { refresh(); showSuccess(t('tests.attempts.released')) }, onError: (e) => showError(e.message) })
  const s = data?.stats
  return (
    <PageContainer>
      <PageHeader icon={ListChecks} title={t('tests.attempts.title')} subtitle={t('tests.attempts.subtitle')} />
      {!given.length ? <Note>{t('tests.attempts.none')}</Note> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-80"><Select value={id} onChange={(e) => setTestId(e.target.value)} aria-label={t('tests.attempts.test')}>{given.map((x) => <option key={x.id} value={x.id}>{`${x.title} · ${x.className}`}</option>)}</Select></div>
            {hasPermission('online-tests.attempts.export') && <Button size="sm" variant="secondary" icon={Download} onClick={() => downloadResults(id).catch((e) => showError(e.message))}>{t('tests.attempts.export')}</Button>}
            {test?.results === 'MANUAL' && !test.resultsReleasedAt && <Button size="sm" icon={Send} loading={release.isPending} onClick={() => release.mutate()}>{t('tests.attempts.release')}</Button>}
          </div>
          {s && <StatCardRow items={[
            { label: t('tests.attempts.attempted'), value: `${s.attempted}/${s.students}` },
            { label: t('tests.attempts.toEvaluate'), value: s.toEvaluate, tone: s.toEvaluate ? 'warning' : 'neutral' },
            { label: t('tests.attempts.average'), value: s.average ?? '—' },
            { label: t('tests.attempts.highest'), value: s.highest ?? '—' },
            { label: t('tests.attempts.passed'), value: s.passed },
          ]} />}
          <DataTable rows={data?.rows ?? []} loading={isLoading} rowKey="studentId" columns={[
            { key: 'name', header: t('tests.attempts.student'), mobilePrimary: true, render: (v, r) => <span>{v}<span className="block text-xs text-ink-faint">{[r.section, r.rollNo && t('tests.attempts.roll', { n: r.rollNo })].filter(Boolean).join(' · ')}</span></span> },
            { key: 'status', header: t('tests.statusCol'), render: (v) => (v ? <StatusPill tone={ATTEMPT_STATUS[v]?.tone}>{t(`tests.attemptStatus.${v}`)}</StatusPill> : <span className="text-xs text-ink-faint">{t('tests.attempts.notTaken')}</span>) },
            { key: 'score', header: t('tests.attempts.marksCol'), align: 'right', render: (v, r) => (v ? <span className={r.passed === false ? 'text-danger-600' : ''}>{v.total}/{data.test.totalMarks}<span className="block text-[11px] text-ink-faint">{v.pct}%</span></span> : '—') },
            { key: 'submittedAt', header: t('tests.attempts.submitted'), mobileHidden: true, render: (v, r) => (v ? <span className="text-xs">{dateTime(v)}<span className="block text-ink-faint">{t(`tests.reasons.${r.submitReason}`)}</span></span> : '—') },
            { key: 'tabSwitches', header: t('tests.attempts.left'), align: 'right', mobileHidden: true, render: (v) => (v ? <span className="text-amber-700">{v}</span> : '0') },
          ]} onRowClick={(r) => r.attemptId && setOpen(r.attemptId)} emptyTitle={t('tests.attempts.noStudents')} />
          {(data?.questions ?? []).length > 0 && (
            <Panel title={t('tests.attempts.byQuestion')} flush>
              <div className="divide-y divide-border">
                {data.questions.map((q) => (
                  <div key={q.index} className="grid sm:grid-cols-[1fr_200px] gap-2 px-4 py-2 items-center">
                    <p className="text-sm text-ink truncate">{q.index + 1}. {q.text}</p>
                    {q.pct === null ? <span className="text-xs text-ink-faint">{t('tests.attempts.teacherMarked', { count: q.answered })}</span> : <div className="flex items-center gap-2"><div className="flex-1"><ProgressBar value={q.pct} showValue={false} /></div><span className="text-xs text-ink-muted w-10 text-right">{q.pct}%</span></div>}
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}
      {open && <AttemptDrawer id={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </PageContainer>
  )
}
