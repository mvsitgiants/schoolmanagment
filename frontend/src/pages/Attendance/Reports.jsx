import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BarChart3, CalendarCheck, ChevronLeft, LayoutGrid, Percent, TriangleAlert } from 'lucide-react'
import { CodeBadge, ColorChip, DataTable, FormField, Input, LevelBar, Note, PageContainer, PageHeader, PersonCell, SegmentedControl, StatCardRow, TONE } from '../../components/system'
import { attendancePct, takesPeriods } from '@schoolgiant/shared'
import Button from '../../components/ui/Button'
import { fetchAttendanceReport, fetchSubjectReport } from '../../api/attendance'

/** Attendance % as a coloured figure over a thin bar: red under the minimum (75% when none is set), amber under 90%, else green. */
export function PctCell({ value, min }) {
  if (value == null) return <span className="text-ink-faint">—</span>
  const floor = min || 75
  const tone = value < floor ? 'danger' : value < 90 ? 'warning' : 'success'
  return (
    <span className="ms-auto inline-flex w-20 flex-col items-end gap-1">
      <span className={clsx('text-[13px] font-semibold tabular-nums', TONE[tone].text)}>{value}%</span>
      <LevelBar bare value={value} max={100} dangerAt={floor - 0.001} warnAt={89.999} width="w-full" />
    </span>
  )
}
const pctCell = (v, min) => <PctCell value={v} min={min} />
const countCell = (v, tone) => (v ? <span className={clsx('font-semibold tabular-nums', TONE[tone].text)}>{v}</span> : <span className="text-ink-faint tabular-nums">0</span>)

/** Attendance over a date range: every section, then one section's students (those under the minimum in red). */
export default function Reports() {
  const { t } = useTranslation('attendance')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [view, setView] = useState('overall') // one section: overall, or by subject (period-wise attendance)
  useEffect(() => {
    const d = new Date()
    setTo(d.toISOString().slice(0, 10))
    setFrom(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10))
  }, [])
  const ready = !!from && !!to
  const { data, isLoading, error } = useQuery({ queryKey: ['attendance-report', from, to, sectionId], queryFn: () => fetchAttendanceReport({ from, to, sectionId }), enabled: ready })
  const bySubject = view === 'subject' && !!sectionId && takesPeriods(data?.mode)
  const { data: subj, isLoading: subjLoading } = useQuery({ queryKey: ['attendance-subject-report', from, to, sectionId], queryFn: () => fetchSubjectReport({ from, to, sectionId }), enabled: ready && bySubject })
  const min = data?.minimumPct ?? 0
  // every section's marks added up, for the overall figure on the tiles
  const overall = data?.sections ? attendancePct(data.sections.reduce((m, s) => { for (const k of ['P', 'A', 'L', 'HD', 'LV', 'total']) m[k] += s.counts?.[k] ?? 0; return m }, { P: 0, A: 0, L: 0, HD: 0, LV: 0, total: 0 })) : null
  const overallTone = overall == null ? 'neutral' : overall < (min || 75) ? 'danger' : overall < 90 ? 'warning' : 'success'

  return (
    <PageContainer>
      <PageHeader icon={BarChart3} title={t('attendance.reports.title')} subtitle={t('attendance.reports.subtitle', { min })} />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <FormField label={t('attendance.reports.from')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
        <FormField label={t('attendance.reports.to')}><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></FormField>
        {sectionId && <Button variant="ghost" icon={ChevronLeft} onClick={() => { setSectionId(''); setView('overall') }}>{t('attendance.reports.allSections')}</Button>}
        {sectionId && takesPeriods(data?.mode) && (
          <SegmentedControl className="ms-auto" value={view} onChange={setView} options={[{ value: 'overall', label: t('attendance.reports.viewOverall') }, { value: 'subject', label: t('attendance.reports.viewSubject') }]} />
        )}
      </div>
      {error && <Note tone="warning">{error.message}</Note>}

      {data && !sectionId && (
        <>
          <StatCardRow items={[
            { icon: LayoutGrid, tone: 'brand', label: t('attendance.reports.sections'), value: data.sections.length },
            { icon: CalendarCheck, tone: 'info', label: t('attendance.reports.taken'), value: data.sections.filter((s) => s.daysTaken).length, progress: data.sections.length ? (data.sections.filter((s) => s.daysTaken).length / data.sections.length) * 100 : undefined },
            { icon: Percent, tone: overallTone, label: t('attendance.reports.overall'), value: overall == null ? '—' : `${overall}%`, progress: overall ?? undefined },
            { icon: TriangleAlert, label: t('attendance.reports.belowMin'), value: data.sections.reduce((n, s) => n + s.below, 0), tone: 'danger' },
          ]} />
          <DataTable rows={data.sections} loading={isLoading} exportable exportName={`attendance-${from}-${to}`}
            columns={[
              { key: 'label', header: t('attendance.reports.section'), mobilePrimary: true, render: (v, r) => <ColorChip label={v} seed={`class-${r.classOrder}`} dot /> },
              { key: 'daysTaken', header: t('attendance.reports.daysTaken'), align: 'right', render: (v) => (v ? <span className="font-semibold tabular-nums text-ink">{v}</span> : <span className="text-ink-faint tabular-nums">0</span>) },
              { key: 'pct', header: t('attendance.reports.average'), align: 'right', render: (v) => pctCell(v, min) },
              { key: 'absent', header: t('attendance.reports.absences'), align: 'right', render: (_, r) => countCell(r.counts.A, 'warning') },
              { key: 'below', header: t('attendance.reports.belowMinShort', { min }), align: 'right', render: (v) => countCell(v, 'danger') },
            ]}
            onRowClick={(r) => setSectionId(r.id)}
            emptyIcon={BarChart3} emptyTitle={t('attendance.reports.empty')} />
        </>
      )}

      {bySubject && subj && (
        <>
          <StatCardRow items={[
            { icon: CalendarCheck, tone: 'brand', label: t('attendance.reports.periodsTaken'), value: subj.periodsTaken, sub: t('attendance.reports.subjectsN', { count: subj.subjects.length }) },
            ...subj.subjects.filter((x) => x.name).slice(0, 3).map((x) => ({ icon: Percent, tone: x.pct == null ? 'neutral' : x.pct < (min || 75) ? 'danger' : x.pct < 90 ? 'warning' : 'success', label: x.name, value: x.pct == null ? '—' : `${x.pct}%`, sub: t('attendance.reports.periodsN', { count: x.periods }), progress: x.pct ?? undefined })),
          ]} />
          <DataTable rows={subj.students} loading={subjLoading} exportable exportName={`attendance-subjects-${subj.section?.label}-${from}-${to}`}
            title={t('attendance.reports.subjectTitle', { section: subj.section?.label, periods: subj.periodsTaken })}
            columns={[
              { key: 'rollNo', header: t('attendance.register.roll'), width: 60, render: (v) => <CodeBadge>{v}</CodeBadge> },
              { key: 'name', header: t('attendance.register.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.belowSubjects ? t('attendance.reports.belowIn', { count: r.belowSubjects }) : r.admissionNo} /> },
              ...subj.subjects.map((x) => ({
                key: `s-${x.id}`, header: x.name ?? t('attendance.reports.noSubject'), align: 'right', mobileHidden: subj.subjects.length > 4,
                sortable: true, sortAccessor: (r) => r.bySubject[x.id]?.pct ?? -1,
                render: (_, r) => pctCell(r.bySubject[x.id]?.pct ?? null, min),
              })),
              { key: 'pct', header: t('attendance.reports.allPeriods'), align: 'right', sortable: true, render: (v) => pctCell(v, min) },
            ]}
            rowTone={(r) => (r.belowSubjects ? 'danger' : undefined)}
            emptyIcon={BarChart3} emptyTitle={t('attendance.reports.noPeriods')} />
        </>
      )}

      {data && sectionId && !bySubject && (
        <DataTable rows={data.students ?? []} loading={isLoading} exportable exportName={`attendance-${data.section?.label}-${from}-${to}`}
          title={t('attendance.reports.studentsTitle', { section: data.section?.label, days: data.daysTaken })}
          columns={[
            { key: 'rollNo', header: t('attendance.register.roll'), width: 60, render: (v) => <CodeBadge>{v}</CodeBadge> },
            { key: 'name', header: t('attendance.register.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.admissionNo} /> },
            { key: 'present', header: t('attendance.register.present'), align: 'right', render: (_, r) => countCell(r.counts.P + r.counts.L + 0.5 * r.counts.HD, 'success') },
            { key: 'absent', header: t('attendance.register.absent'), align: 'right', render: (_, r) => countCell(r.counts.A, 'danger') },
            { key: 'leave', header: t('attendance.reports.leave'), align: 'right', mobileHidden: true, render: (_, r) => countCell(r.counts.LV, 'info') },
            { key: 'pct', header: '%', align: 'right', render: (v) => pctCell(v, min) },
          ]}
          emptyIcon={BarChart3} emptyTitle={t('attendance.reports.noStudents')} />
      )}
    </PageContainer>
  )
}
