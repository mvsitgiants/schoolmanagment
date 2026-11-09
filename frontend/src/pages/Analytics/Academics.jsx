import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  BookOpen, CalendarCheck, CalendarRange, CircleCheckBig, ClipboardList, GraduationCap, Percent, ShieldAlert, Trophy, TriangleAlert, Users,
} from 'lucide-react'
import {
  CHART, ColorChip, ColumnBars, DataTable, EmptyState, MiniBarChart, Note, PageContainer, PageHeader, PctCell, PersonCell, RankBars,
  SideNav, SideNavLayout, StatCardRow, TONE, Tag, TrendArea, ViewControls, ControlChip,
} from '../../components/system'
import PctBar, { pctTone } from '../../components/analytics/PctBar'
import GradeSpread from '../../components/analytics/GradeSpread'
import { fetchAcademicAnalytics } from '../../api/analytics'
import { useFormat } from '../../context/SettingsContext'

const RISK_OPTIONS = [33, 40, 50, 60]
const REASON_TONE = { FAILED: 'danger', LOW_RESULT: 'warning', LOW_ATTENDANCE: 'orange' }
const pctText = (v) => (v == null ? '—' : `${v}%`)

/** Analytics › Academic performance: one published exam across the classes in scope, and the year's trend. */
export default function Academics() {
  const { t } = useTranslation('analytics')
  const { date } = useFormat()
  const [yearId, setYearId] = useState('')
  const [examId, setExamId] = useState('')
  const [riskPct, setRiskPct] = useState('')
  const [classId, setClassId] = useState('')
  const params = { yearId, examId, riskPct }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['analytics-academics', params], queryFn: () => fetchAcademicAnalytics(params), placeholderData: keepPreviousData })

  const s = data?.summary
  const exams = data?.exams ?? []
  const picked = data?.classes?.find((c) => c.classId === classId)
  const trendData = useMemo(() => (data?.trend?.exams ?? []).map((e, i) => ({
    label: e.name,
    value: data.trend.overall[i]?.average ?? 0,
    value2: data.trend.classes.find((c) => c.classId === classId)?.byExam?.[e.id]?.average ?? 0,
  })), [data, classId])
  const trendRows = useMemo(() => (data?.trend?.classes ?? []).map((c) => ({ id: c.classId, name: c.name, ...Object.fromEntries((data?.trend?.exams ?? []).map((e) => [e.id, c.byExam?.[e.id]?.average ?? null])) })), [data])
  const minAtt = data?.minAttendancePct || 75
  const reasonLabel = (r) => t(`analytics.academics.reasons.${r}`, { pct: data?.riskPct, min: minAtt })
  // a class picked in the side list narrows the cards, grade spread, toppers and students at risk to it
  const inClass = (rows = []) => (picked ? rows.filter((r) => r.classId === picked.classId) : rows)
  const toppers = inClass(data?.toppers)
  const atRisk = inClass(data?.atRisk)
  const avgTone = (v) => (v == null ? undefined : v < 40 ? 'danger' : v < 60 ? 'warning' : undefined)
  const classNav = (data?.classes?.length ?? 0) > 1 && (
    <SideNav title={t('analytics.academics.classesNav')} value={picked ? picked.classId : ''} onChange={setClassId} items={[
      { id: '', label: t('analytics.academics.allClasses'), icon: GraduationCap, hint: t('analytics.academics.classHint', { pass: pctText(s?.passPct) }), count: pctText(s?.average), countTone: avgTone(s?.average) },
      ...data.classes.map((c) => ({
        id: c.classId, label: c.name, hint: t('analytics.academics.classHint', { pass: pctText(c.passPct) }),
        count: pctText(c.average), countTone: avgTone(c.average),
        progress: c.assessed ? { value: c.passed, max: c.assessed, kind: 'done' } : undefined,
      })),
    ]} />
  )

  const controls = (
    <ViewControls>
      <ControlChip icon={CalendarRange} label={t('analytics.common.year')} value={data?.year?.name} active={!!yearId}
        options={(data?.years ?? []).map((y) => y.name)}
        onChange={(name) => { setYearId(data?.years?.find((y) => y.name === name)?.id ?? ''); setExamId(''); setClassId('') }} />
      {exams.length > 0 && (
        <ControlChip icon={ClipboardList} label={t('analytics.academics.exam')} value={data?.exam?.name} active={!!examId}
          options={[...exams].reverse().map((e) => e.name)} onChange={(name) => setExamId(exams.find((e) => e.name === name)?.id ?? '')} />
      )}
      <ControlChip icon={ShieldAlert} label={t('analytics.academics.riskBelow')} value={pctText(data?.riskPct)} active={!!riskPct}
        options={[...new Set([...RISK_OPTIONS, data?.riskPct].filter((p) => p != null))].sort((a, b) => a - b).map(pctText)} onChange={(v) => setRiskPct(String(parseFloat(v)))} />
    </ViewControls>
  )

  return (
    <PageContainer>
      <PageHeader icon={GraduationCap} title={t('analytics.academics.title')}
        subtitle={data?.exam ? t('analytics.academics.subtitleExam', { exam: data.exam.name, year: data.year?.name }) : t('analytics.academics.subtitle')} />
      <SideNavLayout nav={data?.exam && s && classNav}>
      {controls}
      {error && <Note tone="warning">{error.response?.data?.message || error.message}</Note>}

      {data && !data.exam && !isLoading && (
        <EmptyState icon={ClipboardList} title={t('analytics.academics.noExams')} hint={t('analytics.academics.noExamsHint', { year: data.year?.name })} />
      )}
      {!data && isLoading && <EmptyState icon={GraduationCap} title={t('analytics.common.loading')} />}
      {!data && error && <EmptyState error onRetry={refetch} title={t('analytics.common.loadFailed')} />}

      {data?.exam && s && (
        <div className="flex flex-col gap-4">
          {picked ? (
            <StatCardRow items={[
              { icon: Users, tone: 'brand', label: t('analytics.academics.assessed'), value: picked.assessed, sub: picked.incomplete ? t('analytics.academics.incomplete', { count: picked.incomplete }) : t('analytics.academics.ofCandidates', { count: picked.students }) },
              { icon: Percent, tone: pctTone(picked.average, 60, 40), label: t('analytics.academics.average'), value: pctText(picked.average), progress: picked.average ?? undefined, sub: t('analytics.academics.schoolAvg', { pct: pctText(s.average) }) },
              { icon: CircleCheckBig, tone: 'success', label: t('analytics.academics.passRate'), value: pctText(picked.passPct),
                segments: [{ label: t('analytics.academics.passed'), value: picked.passed, tone: 'success' }, { label: t('analytics.academics.failed'), value: picked.failed, tone: 'danger' }] },
              { icon: TriangleAlert, tone: atRisk.length ? 'danger' : 'success', label: t('analytics.academics.atRisk'), value: atRisk.length, sub: t('analytics.academics.atRiskSub', { pct: data.riskPct, min: minAtt }) },
            ]} />
          ) : (
          // beside the classes list the column is narrower than the viewport says: three a row until there is room for five
          <div className="xl:[&>div]:grid-cols-3 2xl:[&>div]:grid-cols-5">
          <StatCardRow items={[
            { icon: Users, tone: 'brand', label: t('analytics.academics.assessed'), value: s.assessed, sub: s.incomplete ? t('analytics.academics.incomplete', { count: s.incomplete }) : t('analytics.academics.ofCandidates', { count: s.candidates }) },
            { icon: Percent, tone: pctTone(s.average, 60, 40), label: t('analytics.academics.average'), value: pctText(s.average), progress: s.average ?? undefined, sub: t('analytics.academics.highest', { pct: s.highest ?? '—' }) },
            { icon: CircleCheckBig, tone: 'success', label: t('analytics.academics.passRate'), value: pctText(s.passPct),
              segments: [{ label: t('analytics.academics.passed'), value: s.passed, tone: 'success' }, { label: t('analytics.academics.failed'), value: s.failed, tone: 'danger' }] },
            { icon: TriangleAlert, tone: s.atRisk ? 'danger' : 'success', label: t('analytics.academics.atRisk'), value: s.atRisk, sub: t('analytics.academics.atRiskSub', { pct: data.riskPct, min: minAtt }) },
            { icon: CalendarCheck, tone: 'sky', label: t('analytics.academics.attendance'), value: pctText(s.attendancePct), progress: s.attendancePct ?? undefined, sub: t('analytics.academics.attendanceUpto', { date: date(data.attendanceUpto) }) },
          ]} />
          </div>
          )}
          {picked && <Note>{t('analytics.academics.classNote', { cls: picked.name })}</Note>}

          <ColumnBars title={t('analytics.academics.classAverage')} subtitle={t('analytics.academics.classAverageSub')}
            items={data.classes.map((c) => ({ id: c.classId, label: c.name, short: c.code ?? c.name, value: Math.round(c.average ?? 0) }))}
            activeId={classId} onPick={(it) => setClassId(it?.id ?? '')} />

          <div className="grid gap-4 lg:grid-cols-2">
            <TrendArea title={t('analytics.academics.trend')} subtitle={picked ? t('analytics.academics.trendClassSub', { cls: picked.name }) : t('analytics.academics.trendSub')}
              data={trendData} line valueFormat={(v) => `${v}%`}
              series={[{ key: 'value', name: t('analytics.academics.allClasses') }, ...(picked ? [{ key: 'value2', name: picked.name }] : [])]} />
            <GradeSpread classes={picked ? [picked] : data.classes} grades={data.grades} />
          </div>

          <DataTable title={t('analytics.academics.classTable')} exportable exportName={`class-results-${data.exam.name}`} rowKey="classId"
            rows={data.classes} loading={isLoading} onRowClick={(r) => setClassId(r.classId === classId ? '' : r.classId)} selectedId={classId}
            columns={[
              { key: 'name', header: t('analytics.academics.class'), mobilePrimary: true, sortable: true, sortAccessor: (r) => r.order, render: (v, r) => <ColorChip label={v} seed={r.classId} dot /> },
              { key: 'assessed', header: t('analytics.academics.students'), align: 'right', sortable: true, render: (v) => <span className="tabular-nums">{v}</span> },
              { key: 'average', header: t('analytics.academics.averageShort'), align: 'right', sortable: true, render: (v) => <PctBar value={v} good={60} warn={40} /> },
              { key: 'passPct', header: t('analytics.academics.passRate'), align: 'right', sortable: true, render: (v) => <PctBar value={v} good={90} warn={75} /> },
              { key: 'failed', header: t('analytics.academics.failed'), align: 'right', sortable: true, render: (v) => <span className={v ? 'font-semibold text-danger-600 tabular-nums' : 'text-ink-faint tabular-nums'}>{v}</span> },
              { key: 'incomplete', header: t('analytics.academics.marksMissing'), align: 'right', mobileHidden: true, render: (v) => <span className="tabular-nums text-ink-muted">{v}</span> },
            ]}
            emptyIcon={GraduationCap} emptyTitle={t('analytics.common.noData')} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <RankBars title={t('analytics.academics.weakest')} subtitle={t('analytics.academics.weakestSub')} max={6} peak={100}
              color={CHART.status.warning} valueFormat={(v) => `${v}%`}
              rows={data.subjects.map((x) => ({ key: x.subjectId, label: x.name, value: x.average }))} empty={t('analytics.common.noData')} />
            <DataTable title={t('analytics.academics.subjects')} exportable exportName={`subjects-${data.exam.name}`} rowKey="subjectId" rows={data.subjects} maxHeight="420px"
              columns={[
                { key: 'name', header: t('analytics.academics.subject'), mobilePrimary: true, sortable: true, render: (v, r) => <ColorChip label={v} seed={r.subjectId} icon={BookOpen} /> },
                { key: 'average', header: t('analytics.academics.averageShort'), align: 'right', sortable: true, render: (v) => <PctBar value={v} good={60} warn={40} /> },
                { key: 'passPct', header: t('analytics.academics.passRate'), align: 'right', sortable: true, render: (v) => <PctBar value={v} good={90} warn={75} /> },
                { key: 'failed', header: t('analytics.academics.failed'), align: 'right', sortable: true, render: (v) => <span className={v ? 'font-semibold text-danger-600 tabular-nums' : 'text-ink-faint tabular-nums'}>{v}</span> },
                { key: 'weakestClass', header: t('analytics.academics.weakestClass'), mobileHidden: true, sortAccessor: (r) => r.weakestClass?.name ?? '', render: (v) => (v ? <span className="inline-flex items-center gap-2"><ColorChip label={v.name} seed={v.classId} dot /><span className="text-xs text-ink-muted tabular-nums">{v.average}%</span></span> : '—') },
              ]}
              emptyIcon={BookOpen} emptyTitle={t('analytics.common.noData')} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <MiniBarChart title={t('analytics.academics.attVsResult')} subtitle={t('analytics.academics.attVsResultSub')} valueFormat={(v) => `${v}%`}
              data={data.attendanceBands.map((b) => ({ label: t(`analytics.academics.bands.${b.key}`), value: b.average ?? 0 }))} />
            <DataTable title={t('analytics.academics.attBands')} exportable exportName={`attendance-vs-result-${data.exam.name}`} rowKey="key" rows={data.attendanceBands}
              columns={[
                { key: 'key', header: t('analytics.academics.attendanceBand'), mobilePrimary: true, sortAccessor: (r) => t(`analytics.academics.bands.${r.key}`), render: (v, r) => <Tag tone={r.tone} size="xs">{t(`analytics.academics.bands.${v}`)}</Tag> },
                { key: 'students', header: t('analytics.academics.students'), align: 'right', render: (v) => <span className="tabular-nums">{v}</span> },
                { key: 'attendance', header: t('analytics.academics.avgAttendance'), align: 'right', render: (v) => <PctCell value={v} min={minAtt} /> },
                { key: 'average', header: t('analytics.academics.averageShort'), align: 'right', render: (v) => <PctBar value={v} good={60} warn={40} /> },
                { key: 'passPct', header: t('analytics.academics.passRate'), align: 'right', mobileHidden: true, render: (v) => <PctBar value={v} good={90} warn={75} /> },
              ]} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <DataTable title={picked ? t('analytics.academics.toppersInClass', { cls: picked.name }) : t('analytics.academics.toppers')} exportable exportName={`toppers-${data.exam.name}`} rowKey="studentId" rows={toppers}
              columns={[
                { key: 'position', header: '#', width: 48, render: (v) => <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold tabular-nums ${TONE.warning.bg} ${TONE.warning.text}`}>{v}</span> },
                { key: 'name', header: t('analytics.academics.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.admissionNo} /> },
                { key: 'classShort', header: t('analytics.academics.class'), render: (v, r) => <ColorChip label={v} seed={r.classId} /> },
                { key: 'pct', header: '%', align: 'right', render: (v) => <span className="font-semibold tabular-nums text-ink">{v}%</span> },
                { key: 'grade', header: t('analytics.academics.grade'), align: 'right', mobileHidden: true, render: (v) => (v ? <Tag tone="success" size="xs">{v}</Tag> : '—') },
                { key: 'classRank', header: t('analytics.academics.classRank'), align: 'right', mobileHidden: true, render: (v) => <span className="tabular-nums text-ink-muted">{v ?? '—'}</span> },
              ]}
              emptyIcon={Trophy} emptyTitle={t('analytics.common.noData')} />

            <DataTable title={t('analytics.academics.atRiskTitle', { count: atRisk.length })} exportable exportName={`at-risk-${data.exam.name}`} rowKey="studentId" rows={atRisk} maxHeight="460px"
              columns={[
                { key: 'name', header: t('analytics.academics.student'), mobilePrimary: true, sortable: true, render: (v, r) => <PersonCell name={v} sub={r.admissionNo} /> },
                { key: 'classShort', header: t('analytics.academics.class'), sortable: true, render: (v, r) => <ColorChip label={v} seed={r.classId} /> },
                { key: 'pct', header: '%', align: 'right', sortable: true, render: (v) => <PctBar value={v} good={60} warn={data.riskPct} width="w-20" /> },
                { key: 'attendancePct', header: t('analytics.academics.attendanceShort'), align: 'right', sortable: true, render: (v) => <PctCell value={v} min={minAtt} /> },
                { key: 'reasons', header: t('analytics.academics.why'), sortAccessor: (r) => r.reasons.map(reasonLabel).join('; '), render: (v, r) => (
                  <span className="flex flex-wrap gap-1">
                    {v.map((x) => <Tag key={x} tone={REASON_TONE[x]} size="xs" title={x === 'FAILED' ? r.failedSubjects.join(', ') : undefined}>{x === 'FAILED' && r.failedSubjects.length ? t('analytics.academics.failedIn', { subjects: r.failedSubjects.join(', ') }) : reasonLabel(x)}</Tag>)}
                  </span>
                ) },
              ]}
              emptyIcon={CircleCheckBig} emptyTitle={t('analytics.academics.noRisk')} emptyHint={t('analytics.academics.noRiskHint')} />
          </div>

          {data.trend.exams.length > 1 && (
            <DataTable title={t('analytics.academics.trendTable')} exportable exportName={`exam-trend-${data.year?.name}`} rows={trendRows}
              onRowClick={(r) => setClassId(r.id === classId ? '' : r.id)} selectedId={classId}
              columns={[
                { key: 'name', header: t('analytics.academics.class'), mobilePrimary: true, render: (v, r) => <ColorChip label={v} seed={r.id} dot /> },
                ...data.trend.exams.map((e) => ({ key: e.id, header: e.name, align: 'right', sortable: true, render: (v) => <PctBar value={v} good={60} warn={40} /> })),
              ]} />
          )}
        </div>
      )}
      </SideNavLayout>
    </PageContainer>
  )
}
