import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { AlertTriangle, Award, CheckCircle2, GraduationCap, Medal, Printer, Undo2, Users, XCircle } from 'lucide-react'
import { YEAR_RESULT } from '@schoolgiant/shared'
import {
  ColorChip, DataTable, Drawer, LevelBar, Note, PANEL, PageContainer, PageHeader, PersonCell, SideNav, SideNavLayout, StatCardRow, StatusPill, Tabs, TONE, hueTone, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchYearOverview, fetchYearSheet, publishYear, unpublishYear } from '../../api/exams'
import { hasPermission } from '../../api/auth'
import { printDocument, printDocuments } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const RANK_TONE = ['warning', 'neutral', 'orange']
const fmt = (n) => (n === null || n === undefined ? '—' : String(Math.round(Number(n) * 10) / 10))

/** Exams › Year-end results: every published exam of the year combined by exam-type weightage, per class. */
export default function YearResults() {
  const { t } = useTranslation('exams')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const canPublish = hasPermission('exams.year-results.publish')
  const canPrint = hasPermission('exams.year-results.print')
  const overview = useQuery({ queryKey: ['year-results'], queryFn: fetchYearOverview })
  const classes = overview.data?.classes ?? []
  const [classId, setClassId] = useState(null)
  const [sectionId, setSectionId] = useState('')
  const [open, setOpen] = useState(null)
  useEffect(() => { if (!classId && classes.length) setClassId((classes.find((c) => c.exams > 0) ?? classes[0]).id) }, [classes, classId])
  const cls = classes.find((c) => c.id === classId)
  const sheet = useQuery({ queryKey: ['year-sheet', classId, sectionId], queryFn: () => fetchYearSheet(classId, sectionId || undefined), enabled: !!classId })
  const d = sheet.data
  const act = useMutation({
    mutationFn: ({ fn }) => fn(),
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ['year-results'] }); qc.invalidateQueries({ queryKey: ['year-sheet'] }); showSuccess(v.done) },
    onError: (e) => showError(e.message),
  })
  const published = d?.status === 'PUBLISHED'
  const label = (r) => t(`exams.yearResults.result.${r}`, YEAR_RESULT[r]?.label ?? r)
  const secShort = useMemo(() => new Map((cls?.sections ?? []).map((x) => [x.id, x.short])), [cls])

  const columns = useMemo(() => [
    { key: 'rollNo', header: t('exams.roll'), width: 56, render: (v) => <span className="font-mono-num">{v ?? '—'}</span> },
    { key: 'name', header: t('exams.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={[!sectionId && secShort.get(r.sectionId), r.admissionNo].filter(Boolean).join(' · ')} /> },
    { key: 'pct', header: t('exams.yearResults.overall'), align: 'right', sortable: true, render: (v, r) => (v === null ? '—' : (
      <div className="inline-flex items-center justify-end gap-2">
        <LevelBar bare value={v} max={100} width="w-14" dangerAt={r.result === 'FAIL' ? 100 : undefined} />
        <span className={clsx('font-semibold tabular-nums', r.result === 'FAIL' ? 'text-danger-600' : 'text-ink')}>{fmt(v)}%</span>
      </div>
    )) },
    { key: 'grade', header: t('exams.results.grade'), align: 'center', render: (v) => <ColorChip label={v} seed={v ? `grade-${v}` : undefined} mono /> },
    { key: 'rank', header: t('exams.results.rank'), align: 'right', sortable: true, render: (v) => (v != null && v <= 3 ? <ColorChip label={v} icon={Medal} tone={RANK_TONE[v - 1]} /> : v ?? '—') },
    { key: 'result', header: t('exams.results.result'), render: (v) => <StatusPill tone={YEAR_RESULT[v]?.tone}>{label(v)}</StatusPill> },
    ...(d?.subjects ?? []).map((s) => ({
      key: `s_${s.id}`, header: s.name, align: 'right', mobileHidden: true, sortable: false,
      render: (_, r) => {
        const x = r.subjects.find((y) => y.subjectId === s.id)
        if (!x || x.pct === null) return <span className="text-ink-faint">—</span>
        return (
          <span className="inline-flex flex-col items-end leading-tight">
            <span className={clsx('tabular-nums', x.pass === false ? 'font-semibold text-danger-600' : 'text-ink')}>{fmt(x.pct)}</span>
            {x.grade && <span className="text-[10.5px] text-ink-faint">{x.grade}</span>}
          </span>
        )
      },
    })),
    ...(canPrint ? [{ key: 'studentId', header: '', align: 'right', width: 52, sortable: false, render: (id) => <Button size="sm" variant="ghost" icon={Printer} aria-label={t('exams.yearResults.printOne')} title={t('exams.yearResults.printOne')} onClick={(e) => { e.stopPropagation(); printDocument('YEAR_REPORT_CARD', id) }} /> }] : []),
  ], [d, t, canPrint, sectionId, secShort]) // eslint-disable-line react-hooks/exhaustive-deps

  // plain-text subject columns for the CSV export
  const rows = useMemo(() => (d?.rows ?? []).map((r) => ({ ...r, ...Object.fromEntries((d?.subjects ?? []).map((s) => [`s_${s.id}`, r.subjects.find((y) => y.subjectId === s.id)?.pct ?? ''])) })), [d])
  const s = d?.summary

  const publish = async () => {
    if (await confirm({ title: t('exams.yearResults.publishConfirm.title', { name: cls?.name }), message: t('exams.yearResults.publishConfirm.message'), confirmLabel: t('exams.yearResults.publish') })) {
      act.mutate({ fn: () => publishYear(classId), done: t('exams.yearResults.publishedToast') })
    }
  }
  const unpublish = async () => {
    if (await confirm({ title: t('exams.yearResults.unpublishConfirm.title', { name: cls?.name }), message: t('exams.yearResults.unpublishConfirm.message'), tone: 'danger', confirmLabel: t('exams.yearResults.unpublish') })) {
      act.mutate({ fn: () => unpublishYear(classId), done: t('exams.yearResults.unpublishedToast') })
    }
  }

  return (
    <PageContainer>
      <PageHeader icon={GraduationCap} title={t('exams.yearResults.title')} subtitle={t('exams.yearResults.subtitle', { year: overview.data?.year.name ?? '' })}
        actions={d && (
          <div className="flex flex-wrap gap-2">
            {canPrint && rows.length > 0 && <Button variant="secondary" icon={Printer} onClick={() => printDocuments('YEAR_REPORT_CARD', rows.map((r) => r.studentId), { preparing: t('exams.yearResults.preparing') })}>{t('exams.yearResults.printAll', { count: rows.length })}</Button>}
            {canPublish && (published
              ? <Button variant="secondary" icon={Undo2} loading={act.isPending} onClick={unpublish}>{t('exams.yearResults.unpublish')}</Button>
              : <Button icon={Award} loading={act.isPending} disabled={d.plan.provisional} title={d.plan.provisional ? t('exams.yearResults.cantPublish') : undefined} onClick={publish}>{t('exams.yearResults.publish')}</Button>)}
          </div>
        )} />
      <SideNavLayout nav={classes.length > 0 && (
        <SideNav title={t('exams.yearResults.classes')} value={classId} onChange={(id) => { setClassId(id); setSectionId('') }} items={classes.map((c) => ({
          id: c.id, label: c.name,
          hint: c.status === 'PUBLISHED' ? t('exams.yearResults.status.PUBLISHED') : c.exams ? t('exams.yearResults.examsSoFar', { count: c.exams }) : t('exams.yearResults.noExams'),
          count: c.status === 'PUBLISHED' ? '✓' : c.exams, countTone: c.status === 'PUBLISHED' ? undefined : c.exams ? 'warning' : undefined,
        }))} />
      )}>
        <div className="flex min-w-0 flex-col gap-4">
          {overview.data && !classes.length && <Note>{t('exams.yearResults.noClasses')}</Note>}
          {d && <WeightStrip plan={d.plan} published={published} />}
          {d && (published
            ? <Note tone="success">{t('exams.yearResults.publishedNote', { name: d.publishedBy ?? '—', at: dateTime(d.publishedAt) })}</Note>
            : d.plan.provisional
              ? <Note tone="info">{t('exams.yearResults.soFarNote', { missing: d.plan.rows.filter((r) => !r.exams.length).map((r) => r.name).join(', ') })}</Note>
              : <Note tone="warning">{t('exams.yearResults.readyNote')}</Note>)}
          {cls && cls.sections.length > 1 && (
            <Tabs value={sectionId} onChange={setSectionId} tabs={[{ value: '', label: t('exams.yearResults.allSections') }, ...cls.sections.map((x) => ({ value: x.id, label: x.short }))]} />
          )}
          {s && <StatCardRow items={[
            { icon: Users, label: t('exams.results.students'), value: s.students, sub: s.average === null ? undefined : t('exams.results.averageSub', { avg: fmt(s.average) }) },
            { icon: CheckCircle2, label: label('PASS'), value: s.PASS, tone: 'success' },
            { icon: AlertTriangle, label: label('COMPARTMENT'), value: s.COMPARTMENT, tone: s.COMPARTMENT ? 'warning' : 'neutral' },
            { icon: XCircle, label: label('FAIL'), value: s.FAIL, tone: s.FAIL ? 'danger' : 'neutral', sub: s.INCOMPLETE ? t('exams.results.incompleteSub', { count: s.INCOMPLETE }) : undefined },
          ]} />}
          <DataTable
            rows={rows} rowKey="studentId" loading={sheet.isLoading || overview.isLoading} error={sheet.error ?? overview.error} onRetry={sheet.refetch}
            exportable exportName="year-results"
            onRowClick={(r) => setOpen(r)}
            rowTone={(r) => (r.result === 'FAIL' ? 'danger' : r.result === 'COMPARTMENT' ? 'warning' : undefined)}
            columns={columns}
            emptyIcon={GraduationCap} emptyTitle={t('exams.yearResults.empty')}
          />
        </div>
      </SideNavLayout>
      <Breakdown row={open} plan={d?.plan} onClose={() => setOpen(null)} label={label} canPrint={canPrint} />
    </PageContainer>
  )
}

/** How the year is weighted: a bar per exam type sized by its weightage, filled when it has published exams. */
function WeightStrip({ plan, published }) {
  const { t } = useTranslation('exams')
  const { date } = useFormat()
  if (!plan.rows.length) return <Note tone="warning">{t('exams.yearResults.noWeights')}</Note>
  return (
    <div className={clsx(PANEL, 'p-4')}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{t('exams.yearResults.weightsTitle')}</p>
        {plan.total !== 100 && <p className="text-xs text-amber-700">{t('exams.yearResults.weightsNot100', { total: plan.total })}</p>}
      </div>
      <div className="flex h-9 w-full gap-1 overflow-hidden rounded-xl">
        {plan.rows.map((r) => {
          const tone = TONE[hueTone(r.code)]
          return (
            <div key={r.typeId} style={{ flexGrow: r.weight, flexBasis: 0 }} title={`${r.name} · ${r.weight}%`}
              className={clsx('flex min-w-0 items-center justify-center rounded-lg border px-1 text-[11.5px] font-semibold', r.exams.length ? [tone.bg, tone.text, tone.border] : 'border-dashed border-border bg-black/[0.02] text-ink-faint')}>
              <span className="truncate">{r.code} · {r.weight}%</span>
            </div>
          )
        })}
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        {plan.rows.map((r) => (
          <li key={r.typeId} className="flex min-w-0 items-baseline gap-2">
            <span className={clsx('h-2 w-2 shrink-0 rounded-full', r.exams.length ? TONE[hueTone(r.code)].dot : 'bg-ink-faint/40')} />
            <span className="font-medium text-ink">{r.name}</span>
            <span className="min-w-0 truncate text-ink-muted">
              {r.exams.length ? `${r.exams.map((e) => e.name).join(', ')} · ${t('exams.yearResults.counts', { pct: fmt(r.share) })}` : t('exams.yearResults.notYet')}
            </span>
          </li>
        ))}
      </ul>
      {!published && plan.coming?.length > 0 && (
        <p className="mt-2 text-xs text-ink-faint">{t('exams.yearResults.coming', { list: plan.coming.map((e) => (e.startDate ? `${e.name} (${date(e.startDate)})` : e.name)).join(', ') })}</p>
      )}
    </div>
  )
}

/** One student: each subject's % per exam type and the weighted final. */
function Breakdown({ row, plan, onClose, label, canPrint }) {
  const { t } = useTranslation('exams')
  const cols = (plan?.rows ?? []).filter((r) => r.exams.length)
  return (
    <Drawer open={!!row} onClose={onClose} size="lg" title={row?.name} subtitle={row && `${row.admissionNo ?? ''} · ${fmt(row.pct)}%${row.grade ? ` · ${row.grade}` : ''} · ${label(row.result)}`}
      footer={row && canPrint && <Button icon={Printer} onClick={() => printDocument('YEAR_REPORT_CARD', row.studentId)}>{t('exams.yearResults.printOne')}</Button>}>
      {row && (
        <div className="space-y-3">
          {row.subjects.map((x) => (
            <div key={x.subjectId} className="rounded-xl border border-border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{x.subject}</span>
                <span className={clsx('tabular-nums font-semibold', x.pass === false ? 'text-danger-600' : 'text-ink')}>{fmt(x.pct)}%{x.grade ? ` · ${x.grade}` : ''}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {cols.map((c) => {
                  const p = x.parts.find((y) => y.code === c.code)?.pct ?? null
                  return (
                    <div key={c.code} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0 truncate text-ink-muted">{c.name} <span className="text-ink-faint">({fmt(c.share)}%)</span></span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                        <span className={clsx('block h-full rounded-full', TONE[hueTone(c.code)].dot)} style={{ width: `${Math.max(0, Math.min(100, p ?? 0))}%` }} />
                      </span>
                      <span className="w-10 shrink-0 text-right tabular-nums text-ink">{fmt(p)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {row.failed?.length > 0 && <Note tone={row.result === 'COMPARTMENT' ? 'warning' : 'danger'}>{t('exams.yearResults.below', { subjects: row.failed.join(', ') })}</Note>}
        </div>
      )}
    </Drawer>
  )
}
