import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BarChart3, ChevronLeft } from 'lucide-react'
import { DataTable, FormField, Input, Note, PageContainer, PageHeader, StatCardRow } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAttendanceReport } from '../../api/attendance'

const pctCell = (v, min) => (v == null ? '—' : <span className={clsx('font-semibold', v < min ? 'text-danger-600' : 'text-ink')}>{v}%</span>)

/** Attendance over a date range: every section, then one section's students (those under the minimum in red). */
export default function Reports() {
  const { t } = useTranslation('attendance')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sectionId, setSectionId] = useState('')
  useEffect(() => {
    const d = new Date()
    setTo(d.toISOString().slice(0, 10))
    setFrom(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10))
  }, [])
  const ready = !!from && !!to
  const { data, isLoading, error } = useQuery({ queryKey: ['attendance-report', from, to, sectionId], queryFn: () => fetchAttendanceReport({ from, to, sectionId }), enabled: ready })
  const min = data?.minimumPct ?? 0

  return (
    <PageContainer>
      <PageHeader icon={BarChart3} title={t('attendance.reports.title')} subtitle={t('attendance.reports.subtitle', { min })} />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <FormField label={t('attendance.reports.from')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
        <FormField label={t('attendance.reports.to')}><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></FormField>
        {sectionId && <Button variant="ghost" icon={ChevronLeft} onClick={() => setSectionId('')}>{t('attendance.reports.allSections')}</Button>}
      </div>
      {error && <Note tone="warning">{error.message}</Note>}

      {data && !sectionId && (
        <>
          <StatCardRow items={[
            { label: t('attendance.reports.sections'), value: data.sections.length },
            { label: t('attendance.reports.taken'), value: data.sections.filter((s) => s.daysTaken).length },
            { label: t('attendance.reports.belowMin'), value: data.sections.reduce((n, s) => n + s.below, 0), tone: 'danger' },
          ]} />
          <DataTable rows={data.sections} loading={isLoading} exportable exportName={`attendance-${from}-${to}`}
            columns={[
              { key: 'label', header: t('attendance.reports.section'), mobilePrimary: true, render: (v) => <span className="font-medium text-ink">{v}</span> },
              { key: 'daysTaken', header: t('attendance.reports.daysTaken'), align: 'right' },
              { key: 'pct', header: t('attendance.reports.average'), align: 'right', render: (v) => pctCell(v, min) },
              { key: 'absent', header: t('attendance.reports.absences'), align: 'right', render: (_, r) => r.counts.A },
              { key: 'below', header: t('attendance.reports.belowMinShort', { min }), align: 'right', render: (v) => (v ? <span className="text-danger-600 font-semibold">{v}</span> : 0) },
            ]}
            onRowClick={(r) => setSectionId(r.id)}
            emptyIcon={BarChart3} emptyTitle={t('attendance.reports.empty')} />
        </>
      )}

      {data && sectionId && (
        <DataTable rows={data.students ?? []} loading={isLoading} exportable exportName={`attendance-${data.section?.label}-${from}-${to}`}
          title={t('attendance.reports.studentsTitle', { section: data.section?.label, days: data.daysTaken })}
          columns={[
            { key: 'rollNo', header: t('attendance.register.roll'), width: 60, render: (v) => v ?? '–' },
            { key: 'name', header: t('attendance.register.student'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.admissionNo}</p></div> },
            { key: 'present', header: t('attendance.register.present'), align: 'right', render: (_, r) => r.counts.P + r.counts.L + 0.5 * r.counts.HD },
            { key: 'absent', header: t('attendance.register.absent'), align: 'right', render: (_, r) => r.counts.A },
            { key: 'leave', header: t('attendance.reports.leave'), align: 'right', mobileHidden: true, render: (_, r) => r.counts.LV },
            { key: 'pct', header: '%', align: 'right', render: (v) => pctCell(v, min) },
          ]}
          emptyIcon={BarChart3} emptyTitle={t('attendance.reports.noStudents')} />
      )}
    </PageContainer>
  )
}
