import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, BadgeCheck, Calculator, FileStack, FileText, GraduationCap, Megaphone, Printer, TrendingUp, TriangleAlert, Users } from 'lucide-react'
import { COE_SESSION_STATUS, PRINT_DOC_BY } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, ColumnBars, ControlChip, DataTable, Drawer, EmptyState, FactGrid, Fraction, HeaderButton, MiniBarChart, Note, PageContainer,
  PageHeader, PersonCell, StatCardRow, StatusPill, TrendArea, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import useSessionPick from '../../components/coe/useSessionPick'
import { computeResults, fetchResult, fetchSessionResults, publishResults } from '../../api/coe'
import { printDocument } from '../../components/print/printDocument'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const GRADE_TONE = { O: 'success', 'A+': 'success', A: 'teal', 'B+': 'sky', B: 'info', C: 'violet', P: 'warning', F: 'danger', Ab: 'danger' }

function ResultDrawer({ id, onClose, canPrintCard, canPrintTranscript }) {
  const { t } = useTranslation('coe')
  const { data: r } = useQuery({ queryKey: ['coe-result', id], queryFn: () => fetchResult(id), enabled: !!id })
  return (
    <Drawer open={!!id} onClose={onClose} size="lg" subtitle={t('coe.gradeCards.drawerSubtitle')} title={r?.name}
      footer={r && <div className="flex flex-wrap gap-2">
        {canPrintCard && <Button icon={Printer} onClick={() => printDocument('GRADE_CARD', r.id)}>{t('coe.gradeCards.printCard')}</Button>}
        {canPrintTranscript && r.enrolmentId && <Button variant="secondary" icon={FileText} onClick={() => printDocument('TRANSCRIPT', r.enrolmentId)}>{t('coe.gradeCards.printTranscript')}</Button>}
      </div>}>
      {r && (
        <div className="space-y-5">
          <FactGrid cols={3} boxed items={[
            { label: t('coe.sgpa'), value: r.sgpa ?? '—' },
            { label: t('coe.cgpa'), value: r.cgpa ?? '—' },
            { label: t('coe.gradeCards.credits'), value: `${r.creditsEarned} / ${r.creditsRegistered}` },
            { label: t('coe.registerNo'), value: r.registerNo || r.admissionNo, mono: true },
            { label: t('coe.semester'), value: r.semester },
            { label: t('coe.gradeCards.arrears'), value: r.arrears },
          ]} />
          <DataTable dense rows={r.courses} rowKey="id" rowTone={(c) => (c.pass ? undefined : 'danger')} columns={[
            { key: 'code', header: t('coe.course'), render: (v, c) => <span><CodeBadge>{v}</CodeBadge> <span className="text-xs text-ink-muted">{c.title}</span></span> },
            { key: 'credits', header: t('coe.credits'), align: 'right' },
            { key: 'internal', header: t('coe.gradeCards.internal'), align: 'right', render: (v, c) => `${v ?? '—'}/${c.internalMax}` },
            { key: 'external', header: t('coe.gradeCards.external'), align: 'right', render: (v, c) => (c.absent ? t('coe.gradeCards.absent') : `${v ?? '—'}/${c.externalMax}`) },
            { key: 'total', header: t('coe.gradeCards.total'), align: 'right', render: (v, c) => <Fraction value={v} max={c.max} /> },
            { key: 'grade', header: t('coe.grade'), render: (v, c) => <span className="inline-flex items-center gap-1"><StatusPill tone={GRADE_TONE[v] ?? 'neutral'} dot={false}>{v}</StatusPill>{c.attempt > 1 && <ColorChip label={t('coe.gradeCards.attemptN', { n: c.attempt })} seed="attempt" />}{c.revalued && <ColorChip label={t('coe.gradeCards.revalued')} seed="reval" />}</span> },
            { key: 'points', header: t('coe.gradeCards.points'), align: 'right' },
            { key: 'reason', header: t('coe.gradeCards.result'), render: (v, c) => (c.pass ? <span className="text-success-600 text-sm">{t('coe.gradeCards.passed')}</span> : <span className="text-danger-600 text-sm">{t(`coe.failReasons.${v}`)}</span>) },
          ]} />
          {r.trend.length > 1 && (
            <TrendArea title={t('coe.gradeCards.trend')} data={r.trend.map((x) => ({ label: `${t('coe.semShort', { n: x.semester })} · ${x.session}`, sgpa: x.sgpa ?? 0, cgpa: x.cgpa ?? 0 }))}
              series={[{ key: 'sgpa', name: t('coe.sgpa') }, { key: 'cgpa', name: t('coe.cgpa') }]} height={180} line />
          )}
        </div>
      )}
    </Drawer>
  )
}

export default function GradeCards() {
  const { t } = useTranslation('coe')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { sessions, sessionId, setSessionId, session, isLoading: loadingSessions } = useSessionPick()
  const [program, setProgram] = useState('')
  const [grade, setGrade] = useState('')
  const [open, setOpen] = useState(null)
  const key = ['coe-results', sessionId, program]
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => fetchSessionResults(sessionId, { programId: program || undefined }), enabled: !!sessionId })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['coe-results'] }); qc.invalidateQueries({ queryKey: ['coe-sessions'] }); qc.invalidateQueries({ queryKey: ['coe-board'] }) }
  const compute = useMutation({ mutationFn: () => computeResults(sessionId), onSuccess: (r) => { refresh(); showSuccess(t('coe.marks.computed', { results: r.results, missing: r.missing })) }, onError: (e) => showError(e.message) })
  const publish = useMutation({ mutationFn: () => publishResults(sessionId), onSuccess: (r) => { refresh(); showSuccess(t('coe.gradeCards.publishedN', { count: r.students })) }, onError: (e) => showError(e.message) })
  const published = data?.session.status === 'PUBLISHED'
  const s = data?.summary
  const rows = (data?.rows ?? []).filter((r) => !grade || (grade === 'ARREARS' ? r.arrears > 0 : r.result === grade))
  const canPrint = hasPermission('coe.grade-cards.print') || hasPermission('coe.grade-cards.view')
  const canPrintCard = canPrint && !!PRINT_DOC_BY.GRADE_CARD
  const canPrintTranscript = canPrint && !!PRINT_DOC_BY.TRANSCRIPT
  const programs = [...new Map((session?.targets ?? []).map((x) => [x.programId, x])).values()]
  const doPublish = async () => {
    if (await confirm({ title: t('coe.gradeCards.publishConfirm', { name: session.name }), message: t('coe.gradeCards.publishHint'), confirmLabel: t('coe.gradeCards.publish') })) publish.mutate()
  }

  const header = (
    <PageHeader icon={Award} title={t('coe.gradeCards.title')} subtitle={t('coe.gradeCards.subtitle')}
      actions={session && !published && <HeaderButton icon={Megaphone} variant="primary" requires="publish" onClick={doPublish}>{t('coe.gradeCards.publish')}</HeaderButton>} />
  )
  if (!loadingSessions && !sessions.length) {
    return <PageContainer>{header}<EmptyState icon={FileStack} title={t('coe.gradeCards.noSessions')} hint={t('coe.gradeCards.noSessionsHint')} /></PageContainer>
  }
  return (
    <PageContainer>
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <ControlChip icon={FileStack} label={t('coe.session')} active value={session?.name}
          options={sessions.map((x) => ({ value: x.id, label: `${x.name} — ${t(`coe.sessionStatus.${x.status}`)}` }))} onChange={(v) => { setSessionId(v); setProgram('') }} />
        {programs.length > 1 && <ControlChip icon={GraduationCap} label={t('coe.program')} active={!!program} value={program ? programs.find((x) => x.programId === program)?.programCode : t('coe.all')}
          options={[{ value: '', label: t('coe.all') }, ...programs.map((x) => ({ value: x.programId, label: x.programCode }))]} onChange={setProgram} />}
        <ControlChip icon={BadgeCheck} label={t('coe.gradeCards.show')} active={!!grade} value={grade ? t(`coe.gradeCards.filter.${grade}`) : t('coe.all')}
          options={[{ value: '', label: t('coe.all') }, ...['PASS', 'FAIL', 'ARREARS'].map((k) => ({ value: k, label: t(`coe.gradeCards.filter.${k}`) }))]} onChange={setGrade} />
        {session && <StatusPill tone={COE_SESSION_STATUS[session.status]?.tone}>{t(`coe.sessionStatus.${session.status}`)}</StatusPill>}
        {session && !published && hasPermission('coe.marks.lock') && <Button size="sm" variant="secondary" icon={Calculator} loading={compute.isPending} onClick={() => compute.mutate()} className="ms-auto">{t('coe.marks.compute')}</Button>}
      </div>
      {data && (published
        ? <Note tone="success">{t('coe.marks.publishedNote', { at: dateTime(data.session.publishedAt), by: data.session.publishedBy })}</Note>
        : <Note tone="warning">{t('coe.gradeCards.provisionalNote')}</Note>)}
      {s && (
        <StatCardRow items={[
          { icon: Users, tone: 'brand', label: t('coe.gradeCards.statStudents'), value: s.students, sub: t('coe.gradeCards.statStudentsSub') },
          { icon: BadgeCheck, tone: 'success', label: t('coe.gradeCards.statPass'), value: s.passPct === null ? '—' : `${s.passPct}%`, sub: t('coe.gradeCards.statPassSub', { n: s.passed }), progress: s.passPct ?? 0 },
          { icon: TrendingUp, tone: 'violet', label: t('coe.gradeCards.statSgpa'), value: s.averageSgpa ?? '—', sub: t('coe.gradeCards.statSgpaSub', { top: s.topSgpa ?? '—' }), progress: s.averageSgpa ? s.averageSgpa * 10 : 0 },
          { icon: TriangleAlert, tone: s.withArrears ? 'danger' : 'teal', label: t('coe.gradeCards.statArrears'), value: s.withArrears, sub: t('coe.gradeCards.statArrearsSub'), onClick: () => setGrade('ARREARS') },
        ]} />
      )}
      {s && s.students > 0 && (
        <div className="grid lg:grid-cols-2 gap-4">
          <ColumnBars title={t('coe.gradeCards.gradeSpread')} subtitle={t('coe.gradeCards.gradeSpreadHint')} items={s.grades.map((g) => ({ id: g.grade, label: g.grade, value: g.count, tone: GRADE_TONE[g.grade] }))} height={96} />
          <MiniBarChart title={t('coe.gradeCards.sgpaSpread')} subtitle={t('coe.gradeCards.sgpaSpreadHint')} data={s.sgpaBuckets} />
        </div>
      )}
      <DataTable
        title={t('coe.gradeCards.list', { count: rows.length })} exportable exportName={`results-${session?.name ?? ''}`}
        rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id" onSelect={(r) => setOpen(r.id)}
        rowTone={(r) => (r.result === 'FAIL' ? 'warning' : undefined)}
        emptyIcon={Award} emptyTitle={t('coe.gradeCards.empty')} emptyHint={t('coe.gradeCards.emptyHint')}
        columns={[
          { key: 'name', header: t('coe.student'), sortable: true, mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={r.registerNo || r.admissionNo} /> },
          { key: 'programCode', header: t('coe.program'), sortable: true, render: (v, r) => <ColorChip label={v} seed={v} sub={`${t('coe.semShort', { n: r.semester })}`} /> },
          { key: 'sgpa', header: t('coe.sgpa'), align: 'right', sortable: true, render: (v) => <span className="font-semibold text-ink">{v ?? '—'}</span> },
          { key: 'cgpa', header: t('coe.cgpa'), align: 'right', sortable: true, render: (v) => v ?? '—' },
          { key: 'creditsEarned', header: t('coe.gradeCards.credits'), align: 'right', render: (v, r) => <Fraction value={v} max={r.creditsRegistered} /> },
          { key: 'arrears', header: t('coe.gradeCards.arrears'), align: 'right', sortable: true, render: (v) => (v ? <span className="font-semibold text-danger-600">{v}</span> : <span className="text-ink-faint">0</span>) },
          { key: 'result', header: t('coe.gradeCards.result'), sortable: true, render: (v) => <StatusPill tone={v === 'PASS' ? 'success' : 'danger'}>{t(`coe.gradeCards.filter.${v}`)}</StatusPill> },
          { key: 'actions', header: '', align: 'right', render: (_, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {canPrintCard && <Button size="sm" variant="ghost" icon={Printer} aria-label={t('coe.gradeCards.printCard')} title={t('coe.gradeCards.printCard')} onClick={() => printDocument('GRADE_CARD', r.id)} />}
              {canPrintTranscript && r.enrolmentId && <Button size="sm" variant="ghost" icon={FileText} aria-label={t('coe.gradeCards.printTranscript')} title={t('coe.gradeCards.printTranscript')} onClick={() => printDocument('TRANSCRIPT', r.enrolmentId)} />}
            </div>
          ) },
        ]}
      />
      <ResultDrawer id={open} onClose={() => setOpen(null)} canPrintCard={canPrintCard} canPrintTranscript={canPrintTranscript} />
    </PageContainer>
  )
}
