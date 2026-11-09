import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BarChart3, CalendarCheck, LayoutGrid, Layers, Percent, TriangleAlert, UserX } from 'lucide-react'
import {
  CodeBadge, ColorChip, DataTable, DateRangeChip, Note, PageContainer, PageHeader, PctCell, PersonCell, PillRow, SegmentedControl, SideNav, SideNavLayout,
  StatCardRow, TONE, pillClass, presetRange,
} from '../../components/system'
import { attendancePct, takesPeriods } from '@schoolgiant/shared'
import { fetchAttendanceReport, fetchSubjectReport } from '../../api/attendance'
import groupByClass, { classKeyOf } from '../../components/attendance/groupByClass'

const pctCell = (v, min) => <PctCell value={v} min={min} />
const countCell = (v, tone) => (v ? <span className={clsx('font-semibold tabular-nums', TONE[tone].text)}>{v}</span> : <span className="text-ink-faint tabular-nums">0</span>)
const KEYS = ['P', 'A', 'L', 'HD', 'LV', 'total']
const sumCounts = (list) => list.reduce((m, s) => { for (const k of KEYS) m[k] += s.counts?.[k] ?? 0; return m }, { P: 0, A: 0, L: 0, HD: 0, LV: 0, total: 0 })
const pctTone = (v, min) => (v == null ? 'neutral' : v < (min || 75) ? 'danger' : v < 90 ? 'warning' : 'success')

/**
 * Attendance over a date range. The classes are the page's side list (chips on a phone), a class's
 * sections are chips inside it; pick a section for its students (those under the minimum in red),
 * or — when periods are marked — their attendance subject by subject.
 */
export default function Reports() {
  const { t } = useTranslation('attendance')
  const [range, setRange] = useState(() => presetRange('thisMonth'))
  const { from, to } = range
  const [classKey, setClassKey] = useState('') // '' = every class
  const [sectionId, setSectionId] = useState('')
  const [view, setView] = useState('overall') // one section: overall, or by subject (period-wise attendance)
  const ready = !!from && !!to

  // every section in scope — the side list and the class tables come from this one list
  const { data: all, isLoading, error } = useQuery({ queryKey: ['attendance-report', from, to, ''], queryFn: () => fetchAttendanceReport({ from, to, sectionId: '' }), enabled: ready })
  const { data: one, isLoading: oneLoading } = useQuery({ queryKey: ['attendance-report', from, to, sectionId], queryFn: () => fetchAttendanceReport({ from, to, sectionId }), enabled: ready && !!sectionId })
  const mode = all?.mode ?? one?.mode
  const bySubject = view === 'subject' && !!sectionId && takesPeriods(mode)
  const { data: subj, isLoading: subjLoading } = useQuery({ queryKey: ['attendance-subject-report', from, to, sectionId], queryFn: () => fetchSubjectReport({ from, to, sectionId }), enabled: ready && bySubject })
  const min = all?.minimumPct ?? one?.minimumPct ?? 0

  // the sections grouped into their classes, each with its attendance and students under the minimum
  const classes = useMemo(() => groupByClass(all?.sections).map((c) => ({ ...c, pct: attendancePct(sumCounts(c.sections)), below: c.sections.reduce((n, s) => n + s.below, 0) })), [all])
  const cls = classes.find((c) => c.key === classKey)
  const shown = cls ? cls.sections : all?.sections ?? []
  const section = shown.find((s) => s.id === sectionId)
  const overall = all ? attendancePct(sumCounts(shown)) : null
  // a class with one section opens straight on its students
  const pickClass = (key) => { setClassKey(key); setSectionId(classes.find((c) => c.key === key)?.sections.length === 1 ? classes.find((c) => c.key === key).sections[0].id : ''); setView('overall') }
  const pickSection = (s) => { setClassKey(classKeyOf(s)); setSectionId(s.id) }

  const nav = classes.length > 1 && (
    <SideNav title={t('attendance.reports.classesNav')} value={classKey} onChange={pickClass} items={[
      { id: '', label: t('attendance.reports.allClasses'), icon: Layers, count: all?.sections.length },
      ...classes.map((c) => ({
        id: c.key, label: c.name,
        hint: [t('attendance.reports.sectionsN', { count: c.sections.length }), c.below ? t('attendance.reports.belowN', { count: c.below }) : null].filter(Boolean).join(' · '),
        count: c.pct == null ? '—' : `${c.pct}%`,
        countTone: c.pct == null ? undefined : c.pct < (min || 75) ? 'danger' : c.pct < 90 ? 'warning' : undefined,
        progress: c.pct == null ? undefined : { value: c.pct, max: 100, kind: 'done' },
      })),
    ]} />
  )

  return (
    <PageContainer>
      <PageHeader icon={BarChart3} title={t('attendance.reports.title')} subtitle={t('attendance.reports.subtitle', { min })} />
      <SideNavLayout className="mt-4" nav={nav}>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeChip value={range} onChange={setRange} align="left" />
          {sectionId && takesPeriods(mode) && (
            <SegmentedControl className="ms-auto" value={view} onChange={setView} options={[{ value: 'overall', label: t('attendance.reports.viewOverall') }, { value: 'subject', label: t('attendance.reports.viewSubject') }]} />
          )}
        </div>
        {error && <Note tone="warning">{error.message}</Note>}

        {cls && cls.sections.length > 1 && (
          <PillRow>
            <button type="button" aria-pressed={!sectionId} onClick={() => { setSectionId(''); setView('overall') }} className={pillClass(!sectionId)}>
              {t('attendance.reports.allSections')} <span className="tabular-nums opacity-70">· {cls.sections.length}</span>
            </button>
            {cls.sections.map((s) => (
              <button key={s.id} type="button" aria-pressed={sectionId === s.id} onClick={() => setSectionId(s.id)} className={pillClass(sectionId === s.id)}>
                {s.short}
                {s.pct != null && <span className={clsx('tabular-nums font-semibold', TONE[pctTone(s.pct, min)].text)}>{s.pct}%</span>}
              </button>
            ))}
          </PillRow>
        )}

        {all && !sectionId && (
          <>
            <StatCardRow items={[
              { icon: LayoutGrid, tone: 'brand', label: t('attendance.reports.sections'), value: shown.length },
              { icon: CalendarCheck, tone: 'info', label: t('attendance.reports.taken'), value: shown.filter((s) => s.daysTaken).length, progress: shown.length ? (shown.filter((s) => s.daysTaken).length / shown.length) * 100 : undefined },
              { icon: Percent, tone: pctTone(overall, min), label: cls ? t('attendance.reports.classAverage') : t('attendance.reports.overall'), value: overall == null ? '—' : `${overall}%`, progress: overall ?? undefined },
              { icon: TriangleAlert, label: t('attendance.reports.belowMinShort', { min }), value: shown.reduce((n, s) => n + s.below, 0), tone: 'danger' },
            ]} />
            <DataTable rows={shown} loading={isLoading} exportable exportName={`attendance-${cls ? cls.name : 'all'}-${from}-${to}`}
              title={cls ? t('attendance.reports.classTitle', { name: cls.name }) : undefined}
              columns={[
                { key: 'label', header: t('attendance.reports.section'), render: (v, r) => <ColorChip label={v} seed={`class-${r.classOrder}`} dot /> },
                { key: 'daysTaken', header: t('attendance.reports.daysTaken'), align: 'right', mobilePrimary: true, render: (v) => (v ? <span className="font-semibold tabular-nums text-ink">{v}</span> : <span className="text-ink-faint tabular-nums">0</span>) },
                { key: 'pct', header: t('attendance.reports.average'), align: 'right', mobileTrail: true, sortable: true, render: (v) => pctCell(v, min) },
                { key: 'absent', header: t('attendance.reports.absences'), align: 'right', sortable: true, sortAccessor: (r) => r.counts.A, render: (_, r) => countCell(r.counts.A, 'warning') },
                { key: 'below', header: t('attendance.reports.belowMinShort', { min }), align: 'right', mobilePrimary: true, sortable: true, render: (v) => countCell(v, 'danger') },
              ]}
              rowTone={(r) => (r.below ? 'danger' : undefined)}
              onRowClick={pickSection}
              emptyIcon={BarChart3} emptyTitle={t('attendance.reports.empty')} />
          </>
        )}

        {bySubject && subj && (
          <>
            <StatCardRow items={[
              { icon: CalendarCheck, tone: 'brand', label: t('attendance.reports.periodsTaken'), value: subj.periodsTaken, sub: t('attendance.reports.subjectsN', { count: subj.subjects.length }) },
              ...subj.subjects.filter((x) => x.name).slice(0, 3).map((x) => ({ icon: Percent, tone: pctTone(x.pct, min), label: x.name, value: x.pct == null ? '—' : `${x.pct}%`, sub: t('attendance.reports.periodsN', { count: x.periods }), progress: x.pct ?? undefined })),
            ]} />
            <DataTable rows={subj.students} loading={subjLoading} exportable exportName={`attendance-subjects-${subj.section?.label}-${from}-${to}`}
              title={t('attendance.reports.subjectTitle', { section: subj.section?.label, periods: subj.periodsTaken })}
              columns={[
                { key: 'rollNo', header: t('attendance.register.roll'), width: 60, mobileHidden: true, render: (v) => <CodeBadge>{v}</CodeBadge> },
                { key: 'name', header: t('attendance.register.student'), mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={r.belowSubjects ? t('attendance.reports.belowIn', { count: r.belowSubjects }) : rollSub(t, r)} /> },
                ...subj.subjects.map((x) => ({
                  key: `s-${x.id}`, header: x.name ?? t('attendance.reports.noSubject'), align: 'right',
                  sortable: true, sortAccessor: (r) => r.bySubject[x.id]?.pct ?? -1,
                  render: (_, r) => pctCell(r.bySubject[x.id]?.pct ?? null, min),
                })),
                { key: 'pct', header: t('attendance.reports.allPeriods'), align: 'right', mobileTrail: true, sortable: true, render: (v) => pctCell(v, min) },
              ]}
              rowTone={(r) => (r.belowSubjects ? 'danger' : undefined)}
              emptyIcon={BarChart3} emptyTitle={t('attendance.reports.noPeriods')} />
          </>
        )}

        {sectionId && !bySubject && (
          <>
            {one && (
              <StatCardRow items={[
                { icon: CalendarCheck, tone: 'info', label: t('attendance.reports.daysTaken'), value: one.daysTaken },
                { icon: Percent, tone: pctTone(section?.pct, min), label: t('attendance.reports.average'), value: section?.pct == null ? '—' : `${section.pct}%`, progress: section?.pct ?? undefined },
                { icon: UserX, tone: 'warning', label: t('attendance.reports.absences'), value: section?.counts?.A ?? 0 },
                { icon: TriangleAlert, tone: section?.below ? 'danger' : 'success', label: t('attendance.reports.belowMinShort', { min }), value: one.students.filter((s) => s.below).length },
              ]} />
            )}
            <DataTable rows={one?.students ?? []} loading={oneLoading} exportable exportName={`attendance-${one?.section?.label ?? 'section'}-${from}-${to}`}
              title={one ? t('attendance.reports.studentsTitle', { section: one.section?.label, days: one.daysTaken }) : undefined}
              columns={[
                { key: 'rollNo', header: t('attendance.register.roll'), width: 60, mobileHidden: true, render: (v) => <CodeBadge>{v}</CodeBadge> },
                { key: 'name', header: t('attendance.register.student'), mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={rollSub(t, r)} /> },
                { key: 'present', header: t('attendance.register.present'), align: 'right', sortable: true, sortAccessor: (r) => r.counts.P + r.counts.L + 0.5 * r.counts.HD, render: (_, r) => countCell(r.counts.P + r.counts.L + 0.5 * r.counts.HD, 'success') },
                { key: 'absent', header: t('attendance.register.absent'), align: 'right', mobilePrimary: true, sortable: true, sortAccessor: (r) => r.counts.A, render: (_, r) => countCell(r.counts.A, 'danger') },
                { key: 'leave', header: t('attendance.reports.leave'), align: 'right', render: (_, r) => countCell(r.counts.LV, 'info') },
                { key: 'pct', header: '%', mobileLabel: t('attendance.reports.average'), align: 'right', mobileTrail: true, sortable: true, render: (v) => pctCell(v, min) },
              ]}
              rowTone={(r) => (r.below ? 'danger' : undefined)}
              emptyIcon={BarChart3} emptyTitle={t('attendance.reports.noStudents')} />
          </>
        )}
      </SideNavLayout>
    </PageContainer>
  )
}

const rollSub = (t, r) => [r.rollNo != null ? t('attendance.reports.rollN', { n: r.rollNo }) : null, r.admissionNo].filter(Boolean).join(' · ') || undefined
