import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, Calculator, Download, FileCheck2, FolderOpen, NotebookPen, Printer, RotateCcw, Sparkles } from 'lucide-react'
import { ACCR_METRIC_STATUS, ACCR_NARRATIVE_WORDS, PRINT_DOC_BY } from '@schoolgiant/shared'
import {
  CodeBadge, Drawer, EmptyState, FactGrid, FormField, HeaderButton, Input, Note, PageContainer, PageHeader, PillRow, ProgressBar, SegmentedControl,
  SideNav, SideNavLayout, Skeleton, StatCardRow, Tag, Textarea, pillClass,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { exportAccrReport, fetchAccrReport, saveAccrMetric } from '../../api/accreditation'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import {
  FrameworkYearBar, KindTag, MetricStatusPill, NarrativeEditor, NarrativeView, SourceTag, useAccrLabels, useAccrMeta, useAccrValue,
} from '../../components/accreditation/AccrKit'

const REP = 'accreditation.reports'

/** One metric: its computed value (and how it was worked out), the manual value and note, or the narrative; status. */
function MetricDrawer({ framework, year, metric: m, onClose }) {
  const { t } = useTranslation('accreditation')
  const L = useAccrLabels()
  const fmt = useAccrValue()
  const { dateTime } = useFormat()
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const canEdit = hasPermission(`${REP}.edit`)
  const [form, setForm] = useState({ status: m.status, manualValue: m.manualValue ?? '', note: m.note ?? '', narrative: m.narrative ?? '' })
  const qn = m.kind === 'QN'
  const save = useMutation({
    mutationFn: () => saveAccrMetric(framework, year, m.code, {
      status: form.status, note: form.note,
      ...(qn ? { manualValue: form.manualValue === '' ? null : Number(form.manualValue) } : { narrative: form.narrative }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accreditation'] }); showSuccess(t('accreditation.reports.saved')); onClose() },
    onError: (e) => showError(e.message),
  })
  return (
    <Drawer open onClose={onClose} size="xl" title={`${m.code} · ${L.metric(framework, m)}`}
      subtitle={`${L.kind(m.kind)} · ${L.source(m.source)}`}
      footer={canEdit && <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>{t('accreditation.reports.save')}</Button>
      </div>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <KindTag kind={m.kind} /><SourceTag source={m.source} />
          {m.updatedBy && <span className="text-xs text-ink-faint">{t('accreditation.reports.updated', { by: m.updatedBy, at: dateTime(m.updatedAt) })}</span>}
        </div>
        <FormField label={t('accreditation.reports.status')}>
          <SegmentedControl size="md" value={form.status} onChange={(status) => canEdit && setForm((f) => ({ ...f, status }))}
            options={Object.keys(ACCR_METRIC_STATUS).map((s) => ({ value: s, label: L.status(s) }))} />
        </FormField>
        {qn ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-bg p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint"><Calculator className="w-3.5 h-3.5" />{t('accreditation.reports.computed')}</p>
                <p className="mt-1 font-display text-2xl font-semibold text-ink">{fmt(m.computed, m.unit) ?? <span className="text-base font-normal text-ink-faint">{m.auto ? t('accreditation.reports.noData') : t('accreditation.reports.notComputed')}</span>}</p>
                {m.detail.length > 0 && <FactGrid cols={2} className="mt-3" items={m.detail.map((d) => ({ key: d.key, label: L.detail(d.key), value: d.value }))} />}
              </div>
              <div className="rounded-xl border border-border p-4 space-y-2">
                <FormField label={t('accreditation.reports.manualValue')} hint={m.auto ? t('accreditation.reports.manualHintAuto') : t('accreditation.reports.manualHint')}>
                  <div className="flex gap-2">
                    <Input type="number" step="any" value={form.manualValue} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, manualValue: e.target.value }))} placeholder={t(`accreditation.unitHints.${m.unit ?? 'count'}`)} />
                    {form.manualValue !== '' && canEdit && <Button variant="secondary" icon={RotateCcw} onClick={() => setForm((f) => ({ ...f, manualValue: '' }))} aria-label={t('accreditation.reports.clearManual')} />}
                  </div>
                </FormField>
                <p className="text-sm text-ink-muted">{t('accreditation.reports.reported')}: <b className="text-ink">{fmt(form.manualValue !== '' ? Number(form.manualValue) : m.computed, m.unit) ?? '—'}</b></p>
              </div>
            </div>
            <FormField label={t('accreditation.reports.note')} hint={t('accreditation.reports.noteHint')}>
              <Textarea rows={3} value={form.note} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </FormField>
          </>
        ) : (
          canEdit
            ? <NarrativeEditor value={form.narrative} onChange={(narrative) => setForm((f) => ({ ...f, narrative }))} />
            : <NarrativeView text={form.narrative || t('accreditation.reports.noNarrative')} className="text-sm leading-relaxed text-ink" />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-ink">
            <FolderOpen className="w-4 h-4 text-ink-faint" />
            {t('accreditation.reports.evidenceN', { count: m.evidence, files: m.files })}
            {m.checklist && <span className="text-xs text-ink-faint">{t('accreditation.reports.checklistN', { done: m.checklist.done, total: m.checklist.total })}</span>}
          </span>
          {hasPermission('accreditation.evidence.view') && <Button size="sm" variant="secondary" to={`/accreditation/evidence?framework=${framework}&year=${year}&metric=${encodeURIComponent(m.code)}`}>{t('accreditation.reports.openEvidence')}</Button>}
        </div>
      </div>
    </Drawer>
  )
}

/** A metric as a tile: code, title, value or narrative excerpt, status, evidence. */
function MetricTile({ framework, m, onOpen }) {
  const { t } = useTranslation('accreditation')
  const L = useAccrLabels()
  const fmt = useAccrValue()
  const tone = ACCR_METRIC_STATUS[m.status]?.tone ?? 'neutral'
  const edge = { success: 'border-s-emerald-500', warning: 'border-s-amber-400', neutral: 'border-s-slate-300' }[tone]
  return (
    <button type="button" onClick={() => onOpen(m)}
      className={`group flex min-w-0 flex-col gap-2 rounded-xl border border-border border-s-4 ${edge} bg-surface p-3.5 text-start shadow-card transition-colors hover:border-brand-300`}>
      <span className="flex items-start gap-2">
        <CodeBadge>{m.code}</CodeBadge>
        <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-ink line-clamp-2">{L.metric(framework, m)}</span>
        <MetricStatusPill status={m.status} />
      </span>
      {m.kind === 'QN' ? (
        <span className="flex items-end justify-between gap-2">
          <span className="font-display text-xl font-semibold text-ink">{fmt(m.value, m.unit) ?? <span className="text-sm font-normal text-ink-faint">{t('accreditation.reports.toEnter')}</span>}</span>
          {m.valueFrom && <Tag size="xs" tone={m.valueFrom === 'AUTO' ? 'success' : 'info'} icon={m.valueFrom === 'AUTO' ? Sparkles : NotebookPen}>{m.valueFrom === 'AUTO' ? t('accreditation.reports.auto') : t('accreditation.reports.entered')}</Tag>}
        </span>
      ) : (
        <span className="space-y-1.5">
          <span className="block text-xs text-ink-muted line-clamp-2">{m.narrative ? m.narrative.replace(/[*#]/g, '').slice(0, 220) : t('accreditation.reports.noNarrative')}</span>
          <ProgressBar value={Math.min(100, ((m.words ?? 0) / ACCR_NARRATIVE_WORDS) * 100)} tone={m.words > ACCR_NARRATIVE_WORDS ? 'danger' : 'brand'} showValue={false} />
        </span>
      )}
      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
        <KindTag kind={m.kind} /><SourceTag source={m.source} />
        <span className="ms-auto inline-flex items-center gap-1"><FolderOpen className="w-3.5 h-3.5" />{m.evidence}</span>
        {m.checklist && <span className="inline-flex gap-0.5" title={t('accreditation.reports.checklistN', { done: m.checklist.done, total: m.checklist.total })}>
          {Array.from({ length: m.checklist.total }, (_, i) => <span key={i} className={i < m.checklist.done ? 'h-2 w-2 rounded-full bg-emerald-500' : 'h-2 w-2 rounded-full bg-black/10'} />)}
        </span>}
      </span>
    </button>
  )
}

/** Accreditation › Reports: a framework's return for a year, criterion by criterion, metric by metric. */
export default function Reports() {
  const { t } = useTranslation('accreditation')
  const L = useAccrLabels()
  const { showError } = useSnackbar()
  const { date } = useFormat()
  const { data: meta } = useAccrMeta()
  const [framework, setFramework] = useState('NAAC')
  const [year, setYear] = useState('')
  const [criterion, setCriterion] = useState('')
  const [kind, setKind] = useState('')
  const [open, setOpen] = useState(null)
  useEffect(() => { if (!year && meta?.current) setYear(meta.current) }, [meta, year])
  const { data: r, isLoading, error, refetch } = useQuery({ queryKey: ['accreditation', 'report', framework, year], queryFn: () => fetchAccrReport(framework, year), enabled: !!year })
  const crit = r?.criteria.find((c) => c.id === criterion) ?? r?.criteria[0]
  const shown = useMemo(() => (crit?.metrics ?? []).filter((m) => (kind === 'PENDING' ? m.status !== 'COMPLETE' : !kind || m.kind === kind)), [crit, kind])
  const live = open && r?.criteria.flatMap((c) => c.metrics).find((m) => m.code === open.code)
  const s = r?.summary
  const canExport = hasPermission(`${REP}.export`)
  const nav = r && (
    <SideNav title={t('accreditation.reports.criteria')} value={crit?.id} onChange={setCriterion} items={r.criteria.map((c) => ({
      id: c.id, label: `${c.code} · ${L.criterion(framework, c)}`, hint: c.weight ? t('accreditation.reports.weight', { weight: c.weight }) : undefined,
      count: `${c.completion.complete}/${c.completion.total}`, progress: { value: c.completion.complete, max: c.completion.total, kind: 'done' },
    }))} />
  )
  return (
    <PageContainer>
      <PageHeader icon={BadgeCheck} title={t('accreditation.reports.pageTitle')} subtitle={t('accreditation.reports.pageSubtitle')}
        actions={r && canExport && <>
          <HeaderButton icon={Download} onClick={() => exportAccrReport(framework, year).catch((e) => showError(e.message))}>{t('accreditation.reports.export')}</HeaderButton>
          {!!PRINT_DOC_BY.ACCREDITATION_SSR && <HeaderButton icon={Printer} onClick={() => printDocument('ACCREDITATION_SSR', r.id)}>{t('accreditation.reports.print')}</HeaderButton>}
        </>} />
      <FrameworkYearBar framework={framework} year={year} onFramework={(f) => { setFramework(f); setCriterion(''); setKind('') }} onYear={setYear} />
      {isLoading || !year ? <Skeleton className="h-64" /> : error ? <EmptyState error={error} onRetry={refetch} /> : r && (
        <SideNavLayout nav={nav}>
          <StatCardRow items={[
            { icon: BadgeCheck, label: t('accreditation.reports.completion'), value: `${s.pct}%`, progress: s.pct, segments: [
              { label: L.status('COMPLETE'), value: s.complete, tone: 'success' }, { label: L.status('DRAFT'), value: s.draft, tone: 'warning' },
              { label: L.status('NOT_STARTED'), value: s.total - s.complete - s.draft, tone: 'neutral' }] },
            { icon: Calculator, label: t('accreditation.reports.valuesReady'), value: `${s.valued}/${s.quantitative}`, progress: s.quantitative ? (s.valued / s.quantitative) * 100 : undefined, sub: t('accreditation.reports.computedN', { count: s.computed }) },
            { icon: NotebookPen, label: t('accreditation.reports.narratives'), value: `${s.narratives}/${s.qualitative}`, progress: s.qualitative ? (s.narratives / s.qualitative) * 100 : undefined },
            { icon: FileCheck2, label: t('accreditation.reports.evidence'), value: s.evidence },
          ]} />
          {crit && (
            <div className="ui-panel bg-surface border border-border/80 rounded-2xl shadow-card p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{L.frameworkName(framework)} · {year}</p>
                  <h2 className="font-display text-lg font-semibold text-ink">{crit.code} · {L.criterion(framework, crit)}</h2>
                </div>
                <div className="w-full sm:w-64">
                  <ProgressBar value={crit.completion.pct} />
                  <p className="mt-1 text-xs text-ink-muted">{t('accreditation.reports.criterionDone', { done: crit.completion.complete, total: crit.completion.total, draft: crit.completion.draft })}</p>
                </div>
              </div>
              <PillRow>
                {[['', t('accreditation.reports.all')], ['QN', L.kind('QN')], ['QL', L.kind('QL')], ['PENDING', t('accreditation.reports.pending')]].map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={kind === v} className={pillClass(kind === v)} onClick={() => setKind(v)}>{label}</button>
                ))}
              </PillRow>
            </div>
          )}
          {year && !r.criteria.some((c) => c.metrics.some((m) => m.valueFrom === 'AUTO')) && <Note>{t('accreditation.reports.noRecordsHint')}</Note>}
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((m) => <MetricTile key={m.code} framework={framework} m={m} onOpen={setOpen} />)}
          </div>
          {!shown.length && <EmptyState title={t('accreditation.reports.noneHere')} />}
          <p className="text-xs text-ink-faint">{t('accreditation.reports.rangeNote', { from: date(r.range.from), to: date(r.range.to) })}</p>
        </SideNavLayout>
      )}
      {live && <MetricDrawer key={live.code} framework={framework} year={year} metric={live} onClose={() => setOpen(null)} />}
    </PageContainer>
  )
}
