import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, ChartColumn, Clock, IndianRupee, UsersRound } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import { ColorChip, DataTable, DateCell, LevelBar, Money, PageContainer, PageHeader, Panel, PersonCell, Skeleton, StatCardRow } from '../../components/system'
import { fetchScholarshipReport } from '../../api/scholarships'
import { hasPermission } from '../../api/auth'

/** A small "who got it" table: students and money per group. */
function GroupTable({ title, rows, label }) {
  const { t } = useTranslation('scholarships')
  const max = Math.max(1, ...rows.map((r) => r.students))
  return (
    <Panel title={title}>
      {!rows.length ? <p className="text-sm text-ink-muted">{t('scholarships.report.nothing')}</p> : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-ink">{label(r)}</span>
              <span className="flex items-center gap-3">
                <LevelBar value={r.students} max={max} label={t('scholarships.report.studentsN', { count: r.students })} width="w-32" bare />
                <span className="w-24 text-end text-sm tabular-nums text-ink-muted">{formatINR(r.amount)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Scholarships of the year: who got what, the money given, received and still awaited — and the list for NAAC / UDISE+. */
export default function Reports() {
  const { t } = useTranslation('scholarships')
  const { data, isLoading, error } = useQuery({ queryKey: ['scholarship-report'], queryFn: () => fetchScholarshipReport() })
  if (isLoading) return <PageContainer><Skeleton className="h-96 rounded-xl" /></PageContainer>
  const r = data
  const tt = r?.totals ?? {}
  return (
    <PageContainer>
      <PageHeader icon={ChartColumn} title={t('scholarships.report.title')} subtitle={r?.year ? t('scholarships.report.subtitleYear', { year: r.year.name }) : t('scholarships.report.subtitle')} />
      {error && <p className="text-sm text-danger-600">{error.message}</p>}
      {r && (
        <>
          <StatCardRow items={[
            { icon: UsersRound, tone: 'brand', label: t('scholarships.report.students'), value: tt.students, sub: t('scholarships.report.studentsSub', { approved: tt.approved, applied: tt.applied }) },
            { icon: BadgeCheck, tone: 'success', label: t('scholarships.report.given'), value: formatINR(tt.amount), sub: t('scholarships.report.givenSub') },
            { icon: IndianRupee, tone: 'info', label: t('scholarships.report.received'), value: formatINR(tt.received), sub: tt.awaited ? t('scholarships.report.awaitedSub', { amount: formatINR(tt.awaited) }) : t('scholarships.report.nothingAwaited') },
            { icon: Clock, tone: tt.open ? 'warning' : 'neutral', label: t('scholarships.report.open'), value: tt.open, sub: tt.held ? t('scholarships.report.heldSub', { amount: formatINR(tt.held) }) : t('scholarships.report.openSub') },
          ]} />

          <DataTable title={t('scholarships.report.byScheme')} rows={r.schemes} rowKey="id"
            columns={[
              { key: 'name', header: t('scholarships.schemes.name'), mobilePrimary: true, render: (v, x) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{t(`scholarships.provider.${x.provider}`)} · {x.valueText}</p></div> },
              { key: 'applied', header: t('scholarships.report.appliedCol'), align: 'right' },
              { key: 'approved', header: t('scholarships.report.approvedCol'), align: 'right', render: (v, x) => (x.seats ? <LevelBar value={v} max={x.seats} label={`${v} / ${x.seats}`} highIsBad warnAt={x.seats} width="w-24" /> : v) },
              { key: 'notApproved', header: t('scholarships.report.notApprovedCol'), align: 'right', mobileHidden: true },
              { key: 'open', header: t('scholarships.report.openCol'), align: 'right', mobileHidden: true },
              { key: 'amount', header: t('scholarships.report.amountCol'), align: 'right', render: (v, x) => (x.budget ? <LevelBar value={v} max={x.budget} label={formatINR(v)} highIsBad warnAt={x.budget} width="w-28" /> : <Money value={v} paise />) },
              { key: 'received', header: t('scholarships.report.receivedCol'), align: 'right', mobileHidden: true, render: (v) => (v ? <Money value={v} paise /> : <span className="text-ink-faint">—</span>) },
              { key: 'awaited', header: t('scholarships.report.awaitedCol'), align: 'right', render: (v) => (v ? <Money value={v} paise /> : <span className="text-ink-faint">—</span>) },
            ]}
            emptyIcon={ChartColumn} emptyTitle={t('scholarships.report.noApplications')} />

          <div className="grid gap-4 lg:grid-cols-3">
            <GroupTable title={t('scholarships.report.byProvider')} rows={r.byProvider} label={(x) => t(`scholarships.provider.${x.key}`, x.key)} />
            <GroupTable title={t('scholarships.report.byCategory')} rows={r.byCategory} label={(x) => (x.key === 'NONE' ? t('scholarships.report.notRecorded') : t(`scholarships.category.${x.key}`, x.key))} />
            <GroupTable title={t('scholarships.report.byClass')} rows={r.byClass} label={(x) => x.name ?? t('scholarships.report.notRecorded')} />
          </div>

          <DataTable title={t('scholarships.report.beneficiaries', { count: r.beneficiaries.length })} rows={r.beneficiaries} rowKey="id"
            exportable={hasPermission('scholarships.reports.export')} exportName={`scholarship-beneficiaries-${r.year.name}`}
            columns={[
              { key: 'student', header: t('scholarships.list.student'), mobilePrimary: true, render: (v, x) => <span className="flex items-center gap-2 min-w-0"><PersonCell name={v?.name ?? '—'} sub={[v?.admissionNo, x.applicationNo].filter(Boolean).join(' · ')} size={28} />{v?.classShort && <ColorChip label={v.classShort} seed={v.classId ?? v.classShort} />}</span>, sortAccessor: (x) => x.student?.name ?? '' },
              { key: 'category', header: t('scholarships.check.category'), render: (v) => (v ? t(`scholarships.category.${v}`, v) : '—'), sortAccessor: (x) => (x.category ? t(`scholarships.category.${x.category}`, x.category) : '') },
              { key: 'scheme', header: t('scholarships.list.scheme') },
              { key: 'amount', header: t('scholarships.report.amountCol'), align: 'right', render: (v) => <Money value={v} paise />, sortAccessor: (x) => x.amount / 100 },
              { key: 'received', sortAccessor: (x) => x.received / 100, header: t('scholarships.report.receivedCol'), align: 'right', mobileHidden: true, render: (v, x) => (x.awaitingMoney ? t('scholarships.money.awaited', { amount: formatINR(Math.max(0, x.amount - v)) }) : v ? <Money value={v} paise /> : '—') },
              { key: 'decidedAt', header: t('scholarships.report.approvedOn'), mobileHidden: true, render: (v) => (v ? <DateCell value={v} /> : '—') },
            ]}
            emptyIcon={BadgeCheck} emptyTitle={t('scholarships.report.noBeneficiaries')} />
        </>
      )}
    </PageContainer>
  )
}
