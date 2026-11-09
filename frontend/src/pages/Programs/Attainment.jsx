import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Gauge as GaugeIcon, GraduationCap, Grid3x3, Printer, Target, TrendingUp } from 'lucide-react'
import { PRINT_DOC_BY } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, ControlChip, DataTable, EmptyState, HeaderButton, MiniBarChart, Note, PageContainer, PageHeader, Panel, SideNav, SideNavLayout, StatCardRow,
} from '../../components/system'
import HeatGrid, { HeatLegend, LevelValue } from '../../components/programs/HeatGrid'
import useProgramList from '../../components/programs/useProgramList'
import { fetchAttainment } from '../../api/programs'
import { printDocument } from '../../components/print/printDocument'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'

export default function Attainment() {
  const { t } = useTranslation('programs')
  const { number } = useFormat()
  const { programs, programId, setProgramId, isLoading } = useProgramList()
  const [sessionId, setSessionId] = useState('')
  const { data: a, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['attainment', programId, sessionId], queryFn: () => fetchAttainment(programId, sessionId), enabled: !!programId,
  })
  const pos = a?.outcomes ?? []
  const coRows = useMemo(() => (a?.courses ?? []).flatMap((c) => c.cos.map((co) => ({ ...co, id: `${c.id}-${co.code}`, course: c.code, courseTitle: c.title }))), [a])
  const maxCos = Math.max(0, ...(a?.courses ?? []).map((c) => c.cos.length))
  const fmt = (v) => (v === null || v === undefined ? '—' : number ? number(v) : v)
  const canPrint = !!PRINT_DOC_BY.ATTAINMENT_REPORT && hasPermission('programs.attainment.view')

  if (!isLoading && !programs.length) {
    return (
      <PageContainer>
        <PageHeader icon={TrendingUp} title={t('programs.attainment.title')} subtitle={t('programs.attainment.subtitle')} />
        <EmptyState icon={GraduationCap} title={t('programs.programs.emptyTitle')} hint={t('programs.outcomes.noProgramsHint')} />
      </PageContainer>
    )
  }
  return (
    <PageContainer>
      <PageHeader icon={TrendingUp} title={t('programs.attainment.title')} subtitle={t('programs.attainment.subtitle')}
        actions={canPrint && programId && <HeaderButton icon={Printer} onClick={() => printDocument('ATTAINMENT_REPORT', programId)}>{t('programs.attainment.print')}</HeaderButton>} />
      <SideNavLayout nav={<SideNav title={t('programs.programs.list')} value={programId} onChange={(id) => { setProgramId(id); setSessionId('') }}
        items={programs.map((p) => ({ id: p.id, label: p.name, hint: p.code, icon: GraduationCap }))} />}>
        {loading && <p className="text-sm text-ink-faint">{t('programs.loading')}</p>}
        {error && <EmptyState error={error} onRetry={refetch} />}
        {a && !a.sessions.length && (
          <EmptyState icon={Target} title={t('programs.attainment.noMarks')} hint={t('programs.attainment.noMarksHint')} />
        )}
        {a && a.sessions.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ControlChip icon={Target} label={t('programs.attainment.session')} value={a.sessions.find((s) => s.id === a.sessionId)?.name}
                options={a.sessions.map((s) => ({ value: s.id, label: s.name }))} onChange={setSessionId} />
              <span className="text-xs text-ink-faint">{t('programs.attainment.rules', { target: a.rules.targetPct, weight: a.rules.internalWeight, levels: a.rules.levels.map((l) => `L${l.level} ≥ ${l.min}%`).join(', ') })}</span>
            </div>
            <StatCardRow items={[
              { icon: Grid3x3, tone: 'brand', label: t('programs.attainment.courses'), value: a.summary.courses, sub: t('programs.attainment.coursesSub') },
              { icon: Target, tone: 'violet', label: t('programs.attainment.cosAttained'), value: `${a.summary.cosAttained} / ${a.summary.cos}`, sub: t('programs.attainment.cosAttainedSub'), progress: a.summary.cos ? (a.summary.cosAttained / a.summary.cos) * 100 : 0 },
              { icon: GaugeIcon, tone: a.summary.poAverage >= 2 ? 'success' : a.summary.poAverage >= 1 ? 'warning' : 'danger', label: t('programs.attainment.poAverage'), value: fmt(a.summary.poAverage), sub: t('programs.attainment.poAverageSub'), progress: a.summary.poAverage ? (a.summary.poAverage / 3) * 100 : 0 },
            ]} />
            {a.summary.cos === 0 && <Note tone="warning">{t('programs.attainment.noCos')}</Note>}
            {pos.length > 0 && (
              <div className="grid xl:grid-cols-2 gap-4">
                <MiniBarChart title={t('programs.attainment.poChart')} subtitle={t('programs.attainment.poChartHint')}
                  data={pos.map((p) => ({ label: p.code, value: a.po[p.code] ?? 0 }))} valueFormat={(v) => fmt(v)} />
                <Panel title={t('programs.attainment.coursePo')} subtitle={t('programs.attainment.coursePoHint')} icon={Grid3x3}>
                  <HeatGrid rows={a.courses.map((c) => ({ key: c.id, label: c.code, sub: c.title }))} columns={pos.map((p) => ({ key: p.code, label: p.code, hint: p.title }))}
                    rowHeader={t('programs.attainment.course')} value={(r, c) => a.courses.find((x) => x.id === r.key).poAttainment[c.key]} format={fmt} />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <HeatLegend items={[t('programs.attainment.l0'), t('programs.attainment.l1'), t('programs.attainment.l2'), t('programs.attainment.l3')]} />
                  </div>
                </Panel>
              </div>
            )}
            {maxCos > 0 && (
              <Panel title={t('programs.attainment.coMap')} subtitle={t('programs.attainment.coMapHint')} icon={Target}>
                <HeatGrid rows={a.courses.map((c) => ({ key: c.id, label: c.code, sub: c.title }))}
                  columns={Array.from({ length: maxCos }, (_, i) => ({ key: `CO${i + 1}`, label: `CO${i + 1}` }))}
                  rowHeader={t('programs.attainment.course')} value={(r, col) => a.courses.find((x) => x.id === r.key).cos.find((co) => co.code === col.key)?.attainment ?? null}
                  format={fmt} footer={{ label: t('programs.attainment.average'), value: (r) => a.courses.find((x) => x.id === r.key).average, format: fmt }} />
              </Panel>
            )}
            <DataTable
              title={t('programs.attainment.detail')} exportable exportName={`${a.program.code}-co-attainment`}
              rows={coRows} rowKey="id"
              emptyIcon={Target} emptyTitle={t('programs.attainment.noCos')}
              columns={[
                { key: 'course', header: t('programs.attainment.course'), sortable: true, nowrap: true, render: (v) => <CodeBadge>{v}</CodeBadge> },
                { key: 'code', header: t('programs.attainment.co'), sortable: true, render: (v, r) => <span title={r.statement}><ColorChip label={v} seed={v} /></span> },
                { key: 'statement', header: t('programs.attainment.statement'), render: (v) => <span className="text-sm text-ink-muted">{v}</span> },
                { key: 'bloom', header: t('programs.attainment.bloom'), render: (v) => (v ? `${v} · ${t(`programs.bloom.${v}`)}` : '—') },
                { key: 'internalPct', header: t('programs.attainment.internalPct'), align: 'right', sortable: true, render: (v) => (v === null ? '—' : `${fmt(v)}%`) },
                { key: 'internalLevel', header: t('programs.attainment.internalLevel'), align: 'right', render: (v) => <LevelValue value={v} /> },
                { key: 'externalPct', header: t('programs.attainment.externalPct'), align: 'right', sortable: true, render: (v) => (v === null ? '—' : `${fmt(v)}%`) },
                { key: 'externalLevel', header: t('programs.attainment.externalLevel'), align: 'right', render: (v) => <LevelValue value={v} /> },
                { key: 'attainment', header: t('programs.attainment.direct'), align: 'right', sortable: true, render: (v) => <LevelValue value={v} /> },
              ]}
            />
          </>
        )}
      </SideNavLayout>
    </PageContainer>
  )
}

