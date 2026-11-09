import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Building2, CalendarCheck, CalendarRange, CircleCheckBig, GraduationCap, Hourglass, Percent, UserRound, Users } from 'lucide-react'
import { formatINRCompact } from '@schoolgiant/shared'
import {
  CHART, CodeBadge, ControlChip, DataTable, EmptyState, Money, Note, PageContainer, PageHeader, PctCell, RankBars, StackCell, StatCardRow, ViewControls,
} from '../../components/system'
import CampusTile from '../../components/analytics/CampusTile'
import PctBar, { pctTone } from '../../components/analytics/PctBar'
import { fetchCampusAnalytics } from '../../api/analytics'

const pctText = (v) => (v == null ? '—' : `${v}%`)
const rupees = (paise) => (paise == null ? null : paise / 100)
const byDesc = (key) => (a, b) => (b[key] ?? -1) - (a[key] ?? -1)

/** Analytics › Campus comparison: every campus side by side for an academic year. */
export default function Campuses() {
  const { t } = useTranslation('analytics')
  const [yearId, setYearId] = useState('')
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['analytics-campuses', yearId], queryFn: () => fetchCampusAnalytics({ yearId }), placeholderData: keepPreviousData })
  const tot = data?.totals
  const rows = data?.campuses ?? []
  const many = rows.length > 1
  const rank = (key) => rows.filter((r) => r[key] != null).sort(byDesc(key)).map((r) => ({ key: r.id, label: r.name, value: r[key] }))

  return (
    <PageContainer>
      <PageHeader icon={Building2} title={t('analytics.campuses.title')}
        subtitle={data?.year ? t('analytics.campuses.subtitleYear', { year: data.year.name }) : t('analytics.campuses.subtitle')} />
      <ViewControls className="mb-4">
        <ControlChip icon={CalendarRange} label={t('analytics.common.year')} value={data?.year?.name} active={!!yearId}
          options={(data?.years ?? []).map((y) => y.name)} onChange={(name) => setYearId(data?.years?.find((y) => y.name === name)?.id ?? '')} />
      </ViewControls>
      {error && <Note tone="warning" className="mb-4">{error.response?.data?.message || error.message}</Note>}
      {!data && isLoading && <EmptyState icon={Building2} title={t('analytics.common.loading')} />}
      {!data && error && <EmptyState error onRetry={refetch} title={t('analytics.common.loadFailed')} />}

      {data && tot && (
        <div className="flex flex-col gap-4">
          <StatCardRow items={[
            { icon: Building2, tone: 'brand', label: t('analytics.campuses.campuses'), value: tot.campuses, sub: t('analytics.campuses.sectionsN', { count: tot.sections }) },
            { icon: Users, tone: 'violet', label: t('analytics.campuses.students'), value: tot.students,
              segments: rows.filter((r) => r.students).length > 1 ? rows.filter((r) => r.students).map((r) => ({ label: r.code, value: r.students })) : undefined },
            { icon: UserRound, tone: 'teal', label: t('analytics.campuses.staff'), value: tot.staff, sub: tot.staff ? t('analytics.campuses.ratio', { n: Math.round((tot.students / tot.staff) * 10) / 10 }) : undefined },
            { icon: CalendarCheck, tone: pctTone(tot.attendancePct, 90, 75), label: t('analytics.campuses.attendance'), value: pctText(tot.attendancePct), progress: tot.attendancePct ?? undefined },
            { icon: GraduationCap, tone: pctTone(tot.resultPct, 60, 40), label: t('analytics.campuses.result'), value: pctText(tot.resultPct), progress: tot.resultPct ?? undefined,
              sub: t('analytics.campuses.examsN', { count: data.examsPublished }) },
            { icon: CircleCheckBig, tone: pctTone(tot.collectionPct, 85, 60), label: t('analytics.campuses.collection'), value: pctText(tot.collectionPct), progress: tot.collectionPct ?? undefined,
              sub: t('analytics.campuses.outstandingSub', { amount: formatINRCompact(tot.outstanding) }) },
          ]} />
          {data.staffSource === 'USERS' && <Note tone="info">{t('analytics.campuses.staffFromUsers')}</Note>}

          <div className={many ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' : 'grid gap-4 md:grid-cols-2'}>
            {rows.map((c) => <CampusTile key={c.id} campus={c} />)}
          </div>

          {many && (
            <div className="grid gap-4 md:grid-cols-2">
              <RankBars title={t('analytics.campuses.rankAttendance')} peak={100} valueFormat={pctText} color={CHART.series[0]} rows={rank('attendancePct')} empty={t('analytics.common.noData')} />
              <RankBars title={t('analytics.campuses.rankResult')} subtitle={t('analytics.campuses.rankResultSub')} peak={100} valueFormat={pctText} color={CHART.series[1]} rows={rank('resultPct')} empty={t('analytics.common.noData')} />
              <RankBars title={t('analytics.campuses.rankCollection')} peak={100} valueFormat={pctText} color={CHART.series[2]} rows={rank('collectionPct')} empty={t('analytics.common.noData')} />
              <RankBars title={t('analytics.campuses.rankOutstanding')} subtitle={t('analytics.campuses.rankOutstandingSub')} valueFormat={formatINRCompact} color={CHART.status.warning} rows={rank('outstanding').filter((r) => r.value > 0)} empty={t('analytics.campuses.nothingOutstanding')} />
            </div>
          )}

          <DataTable title={t('analytics.campuses.table')} exportable exportName={`campus-comparison-${data.year?.name}`} rows={rows}
            columns={[
              { key: 'name', header: t('analytics.campuses.campus'), mobilePrimary: true, sortable: true, render: (v, r) => <span className="flex items-center gap-2"><CodeBadge>{r.code}</CodeBadge><StackCell title={v} sub={r.city} /></span> },
              { key: 'students', header: t('analytics.campuses.students'), align: 'right', sortable: true, render: (v) => <span className="tabular-nums font-medium">{v}</span> },
              { key: 'staff', header: t('analytics.campuses.staff'), align: 'right', sortable: true, render: (v, r) => <span className="tabular-nums">{v}{r.studentsPerStaff ? <span className="ms-1 text-[11px] text-ink-faint">{t('analytics.campuses.ratioShort', { n: r.studentsPerStaff })}</span> : null}</span> },
              { key: 'attendancePct', header: t('analytics.campuses.attendance'), align: 'right', sortable: true, render: (v) => <PctCell value={v} min={75} /> },
              { key: 'resultPct', header: t('analytics.campuses.result'), align: 'right', sortable: true, render: (v) => <PctBar value={v} good={60} warn={40} /> },
              { key: 'passPct', header: t('analytics.campuses.pass'), align: 'right', sortable: true, mobileHidden: true, render: (v) => <PctBar value={v} good={90} warn={75} /> },
              { key: 'collectionPct', header: t('analytics.campuses.collection'), align: 'right', sortable: true, render: (v) => <PctBar value={v} good={85} warn={60} /> },
              { key: 'outstanding', header: t('analytics.campuses.outstanding'), align: 'right', sortable: true, sortAccessor: (r) => rupees(r.outstanding), render: (v, r) => <Money value={v} paise tone={r.overdue ? 'danger' : undefined} /> },
            ]}
            emptyIcon={Hourglass} emptyTitle={t('analytics.campuses.empty')} />
          {!many && rows.length === 1 && <Note tone="info" icon={Percent}>{t('analytics.campuses.oneCampus')}</Note>}
        </div>
      )}
    </PageContainer>
  )
}
