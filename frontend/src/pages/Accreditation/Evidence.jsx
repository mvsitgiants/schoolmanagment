import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, ExternalLink, FileCheck2, FolderOpen, Link2, Paperclip, Plus, ShieldCheck, ShieldQuestion, Trash2 } from 'lucide-react'
import { accrCriteria, accrMetric, accrMetrics } from '@schoolgiant/shared'
import {
  Attachments, CodeBadge, Drawer, EmptyState, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, PersonCell, SearchInput, Select,
  SideNav, SideNavLayout, Skeleton, StatCardRow, Textarea, useConfirm, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteEvidence, fetchEvidence, saveEvidence, setEvidenceDvv } from '../../api/accreditation'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { DvvPill, FrameworkYearBar, KindTag, useAccrLabels, useAccrMeta } from '../../components/accreditation/AccrKit'

const EVI = 'accreditation.evidence'

/** Add or change a piece of evidence: what it is, the metrics it backs, which DVV documents it answers. */
function EvidenceForm({ framework, item, preset, years, onClose, onSaved }) {
  const { t } = useTranslation('accreditation')
  const L = useAccrLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({
    title: item?.title ?? '', description: item?.description ?? '', year: item?.year ?? preset?.year ?? '', link: item?.link ?? '',
    metricCodes: item?.metricCodes ?? (preset?.metric ? [preset.metric] : []), checklist: item?.checklist ?? (preset?.checklist ? [preset.checklist] : []),
  })
  const [pick, setPick] = useState('')
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const metrics = accrMetrics(framework)
  const toggleDoc = (key) => setForm((f) => ({ ...f, checklist: f.checklist.includes(key) ? f.checklist.filter((x) => x !== key) : [...f.checklist, key] }))
  const save = useMutation({
    mutationFn: () => saveEvidence(item?.id, { ...(!item && { framework }), ...form, year: form.year || null, link: form.link || null }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={item ? t('accreditation.evidence.editTitle') : t('accreditation.evidence.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.title.trim().length < 2 || !form.metricCodes.length} onClick={() => save.mutate()}>{t('accreditation.evidence.save')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('accreditation.evidence.title')} required error={errors.title}><Input value={form.title} onChange={set('title')} placeholder={t('accreditation.evidence.titlePlaceholder')} /></FormField>
        <FormField label={t('accreditation.evidence.metrics')} required error={errors.metricCodes}>
          <div className="space-y-2">
            {form.metricCodes.map((code) => {
              const m = accrMetric(framework, code)
              return (
                <div key={code} className="rounded-xl border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <CodeBadge>{code}</CodeBadge>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{m ? L.metric(framework, m) : code}</span>
                    <button type="button" className="text-xs text-ink-faint hover:text-danger-600" onClick={() => setForm((f) => ({ ...f, metricCodes: f.metricCodes.filter((x) => x !== code), checklist: f.checklist.filter((k) => !k.startsWith(`${code}#`)) }))}>{t('accreditation.evidence.unlink')}</button>
                  </div>
                  {m?.dvv?.length > 0 && (
                    <div className="mt-2 space-y-1 ps-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('accreditation.evidence.answers')}</p>
                      {m.dvv.map((doc, i) => {
                        const key = `${code}#${i}`
                        return (
                          <label key={key} className="flex items-center gap-2 text-sm text-ink">
                            <input type="checkbox" checked={form.checklist.includes(key)} onChange={() => toggleDoc(key)} className="rounded border-border text-brand-500" />
                            {L.doc(framework, code, i, doc)}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            <Select value={pick} onChange={(e) => { const code = e.target.value; setPick(''); if (code && !form.metricCodes.includes(code)) setForm((f) => ({ ...f, metricCodes: [...f.metricCodes, code] })) }} aria-label={t('accreditation.evidence.addMetric')}>
              <option value="">{t('accreditation.evidence.addMetric')}</option>
              {accrCriteria(framework).map((c) => (
                <optgroup key={c.id} label={`${c.code} · ${L.criterion(framework, c)}`}>
                  {c.metrics.filter((m) => !form.metricCodes.includes(m.code)).map((m) => <option key={m.code} value={m.code}>{`${m.code} · ${L.metric(framework, m)}`}</option>)}
                </optgroup>
              ))}
            </Select>
          </div>
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('accreditation.evidence.year')} hint={t('accreditation.evidence.yearHint')}>
            <Select value={form.year} onChange={set('year')}>
              <option value="">{t('accreditation.evidence.anyYear')}</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </FormField>
          <FormField label={t('accreditation.evidence.link')} error={errors.link} hint={t('accreditation.evidence.linkHint')}><Input type="url" value={form.link} onChange={set('link')} placeholder="https://" /></FormField>
        </div>
        <FormField label={t('accreditation.evidence.description')}><Textarea rows={3} value={form.description} onChange={set('description')} /></FormField>
        {!item && <Note>{t('accreditation.evidence.filesAfter')}</Note>}
      </div>
    </Modal>
  )
}

/** One piece of evidence: its files (files engine), the metrics and documents it backs, DVV. */
function EvidenceDrawer({ framework, item, onClose, onEdit, onChanged }) {
  const { t } = useTranslation('accreditation')
  const L = useAccrLabels()
  const { dateTime } = useFormat()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { showError, showSuccess } = useSnackbar()
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { onChanged(); showSuccess(v.done); if (v.close) onClose() }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission(`${EVI}.edit`)
  const clarify = async () => {
    const note = await prompt({ title: t('accreditation.evidence.clarifyTitle'), label: t('accreditation.evidence.clarifyNote') })
    if (note === null || note === undefined) return
    act.mutate({ fn: () => setEvidenceDvv(item.id, { status: 'CLARIFY', note }), done: t('accreditation.evidence.dvvSaved') })
  }
  return (
    <Drawer open onClose={onClose} size="xl" title={item.title} subtitle={item.metricCodes.join(' · ')}
      footer={<div className="flex flex-wrap gap-2">
        {canEdit && <Button variant="secondary" onClick={onEdit}>{t('accreditation.edit')}</Button>}
        {canEdit && item.dvv.status !== 'VERIFIED' && <Button variant="secondary" icon={ShieldCheck} onClick={() => act.mutate({ fn: () => setEvidenceDvv(item.id, { status: 'VERIFIED' }), done: t('accreditation.evidence.dvvSaved') })}>{t('accreditation.evidence.verify')}</Button>}
        {canEdit && item.dvv.status !== 'CLARIFY' && <Button variant="secondary" icon={ShieldQuestion} onClick={clarify}>{t('accreditation.evidence.clarify')}</Button>}
        {hasPermission(`${EVI}.delete`) && <Button variant="ghost" icon={Trash2} className="ms-auto"
          onClick={async () => { if (await confirm({ title: t('accreditation.evidence.deleteConfirm', { title: item.title }), message: t('accreditation.evidence.deleteHint'), confirmLabel: t('accreditation.delete'), tone: 'danger' })) act.mutate({ fn: () => deleteEvidence(item.id), done: t('accreditation.evidence.deleted'), close: true }) }}>{t('accreditation.delete')}</Button>}
      </div>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <DvvPill status={item.dvv.status} />
          {item.dvv.by && <span className="text-xs text-ink-faint">{t('accreditation.evidence.dvvBy', { by: item.dvv.by, at: dateTime(item.dvv.at) })}</span>}
          {item.year && <span className="text-xs text-ink-muted">{t('accreditation.evidence.forYear', { year: item.year })}</span>}
        </div>
        {item.dvv.note && <Note tone="warning">{item.dvv.note}</Note>}
        {item.description && <p className="whitespace-pre-line text-sm text-ink">{item.description}</p>}
        {item.link && <a href={item.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 break-all text-sm text-brand-700 hover:underline"><ExternalLink className="w-4 h-4" />{item.link}</a>}
        <div className="space-y-2">
          {item.metricCodes.map((code) => {
            const m = accrMetric(framework, code)
            return (
              <div key={code} className="rounded-xl border border-border px-3 py-2">
                <p className="flex items-center gap-2 text-sm"><CodeBadge>{code}</CodeBadge><span className="text-ink">{m ? L.metric(framework, m) : code}</span></p>
                {(m?.dvv ?? []).map((doc, i) => item.checklist.includes(`${code}#${i}`) && (
                  <p key={i} className="mt-1 flex items-center gap-1.5 ps-1 text-xs text-ink-muted"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />{L.doc(framework, code, i, doc)}</p>
                ))}
              </div>
            )
          })}
        </div>
        <Attachments entityType="accreditation_evidence" entityId={item.id} canAdd={hasPermission(`${EVI}.create`) || canEdit} label={t('accreditation.evidence.files')} onChange={onChanged} />
        <PersonCell name={item.uploadedBy} sub={t('accreditation.evidence.addedOn', { at: dateTime(item.createdAt) })} size={28} />
      </div>
    </Drawer>
  )
}

/** A metric's checklist and evidence (opened from its tile). */
function MetricPanel({ framework, row, items, onAdd, onOpen }) {
  const { t } = useTranslation('accreditation')
  const L = useAccrLabels()
  const m = accrMetric(framework, row.code)
  return (
    <Drawer open onClose={() => onOpen(null)} size="lg" title={`${row.code} · ${m ? L.metric(framework, m) : row.code}`} subtitle={L.kind(row.kind)}
      footer={hasPermission(`${EVI}.create`) && <Button icon={Plus} onClick={() => onAdd({ metric: row.code })}>{t('accreditation.evidence.addFor', { code: row.code })}</Button>}>
      <div className="space-y-5">
        {row.items.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('accreditation.evidence.checklist')}</p>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {row.items.map((it, i) => (
                <li key={it.key} className="flex items-center gap-2.5 px-3 py-2.5">
                  {it.done ? <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" /> : <Circle className="w-5 h-5 shrink-0 text-ink-faint" />}
                  <span className="min-w-0 flex-1 text-sm text-ink">{L.doc(framework, row.code, i, it.label)}</span>
                  {it.evidence > 0 && <span className="text-xs text-ink-faint">{t('accreditation.evidence.itemsN', { count: it.evidence })}</span>}
                  {!it.done && hasPermission(`${EVI}.create`) && <Button size="sm" variant="secondary" icon={Plus} onClick={() => onAdd({ metric: row.code, checklist: it.key })} aria-label={t('accreditation.evidence.addFor', { code: row.code })} />}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('accreditation.evidence.items')}</p>
          {items.length ? (
            <div className="space-y-2">
              {items.map((e) => (
                <button key={e.id} type="button" onClick={() => onOpen(row, e)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-start hover:border-brand-300">
                  <FileCheck2 className="w-5 h-5 shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{e.title}</span>
                    <span className="block truncate text-xs text-ink-faint">{[e.year, e.uploadedBy].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-ink-muted">{e.link && <Link2 className="w-3.5 h-3.5" />}<Paperclip className="w-3.5 h-3.5" />{e.files}</span>
                  <DvvPill status={e.dvv.status} />
                </button>
              ))}
            </div>
          ) : <EmptyState icon={FolderOpen} title={t('accreditation.evidence.noneForMetric')} />}
        </div>
      </div>
    </Drawer>
  )
}

/** Accreditation › Evidence repository: documents behind each metric, with the DVV checklist per metric. */
export default function Evidence() {
  const { t } = useTranslation('accreditation')
  const L = useAccrLabels()
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const { data: meta } = useAccrMeta()
  const [framework, setFramework] = useState(params.get('framework') || 'NAAC')
  const [year, setYear] = useState(params.get('year') || '')
  const [criterion, setCriterion] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [panel, setPanel] = useState(null) // metric code
  const [openItem, setOpenItem] = useState(null)
  const [form, setForm] = useState(null) // { item } | { preset }
  // opened from a report's metric: start on its criterion with its panel open
  useEffect(() => {
    const code = params.get('metric')
    if (!code) return
    const m = accrMetric(params.get('framework') || 'NAAC', code)
    if (m) { setCriterion(m.criterion); setPanel(code) }
    setParams({}, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const query = { framework, year, search: q }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['accreditation', 'evidence', query], queryFn: () => fetchEvidence(query) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['accreditation'] })
  const criteria = accrCriteria(framework)
  const crit = criteria.find((c) => c.id === criterion) ?? criteria[0]
  const byCode = useMemo(() => new Map((data?.checklist ?? []).map((c) => [c.code, c])), [data])
  const navItems = criteria.map((c) => {
    const rows = c.metrics.map((m) => byCode.get(m.code)).filter(Boolean)
    const total = rows.reduce((n, r) => n + r.items.length, 0)
    const done = rows.reduce((n, r) => n + r.items.filter((i) => i.done).length, 0)
    const items = rows.reduce((n, r) => n + r.evidence, 0)
    return { id: c.id, label: `${c.code} · ${L.criterion(framework, c)}`, count: items, progress: total ? { value: done, max: total, kind: 'done' } : undefined, hint: total ? t('accreditation.evidence.docsDone', { done, total }) : undefined }
  })
  const tiles = (crit?.metrics ?? []).map((m) => byCode.get(m.code)).filter(Boolean)
  const itemsOf = (code) => (data?.rows ?? []).filter((e) => e.metricCodes.includes(code))
  const s = data?.summary
  const panelRow = panel && byCode.get(panel)
  const liveItem = openItem && (data?.rows ?? []).find((e) => e.id === openItem)
  const years = meta?.years ?? []
  return (
    <PageContainer>
      <PageHeader icon={FolderOpen} title={t('accreditation.evidence.pageTitle')} subtitle={t('accreditation.evidence.pageSubtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires={`${EVI}.create`} onClick={() => setForm({ preset: { year } })}>{t('accreditation.evidence.new')}</HeaderButton>} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FrameworkYearBar framework={framework} year={year} allYears onFramework={(f) => { setFramework(f); setCriterion(''); setPanel(null) }} onYear={setYear} />
        <div className="w-full sm:w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('accreditation.evidence.search')} /></div>
      </div>
      {isLoading ? <Skeleton className="h-64" /> : error ? <EmptyState error={error} onRetry={refetch} /> : (
        <SideNavLayout nav={<SideNav title={t('accreditation.evidence.criteria')} value={crit?.id} onChange={setCriterion} items={navItems} />}>
          {s && <StatCardRow items={[
            { icon: FileCheck2, label: t('accreditation.evidence.itemsTotal'), value: s.items, sub: t('accreditation.evidence.filesN', { count: s.files }) },
            { icon: FolderOpen, label: t('accreditation.evidence.covered'), value: `${s.metricsCovered}/${s.metrics}`, progress: s.metrics ? (s.metricsCovered / s.metrics) * 100 : undefined },
            { icon: CheckCircle2, label: t('accreditation.evidence.checklistDone'), value: `${s.checklistDone}/${s.checklistTotal}`, progress: s.checklistTotal ? (s.checklistDone / s.checklistTotal) * 100 : undefined },
            { icon: ShieldCheck, label: t('accreditation.evidence.verified'), value: s.verified, tone: 'success', sub: s.clarify ? t('accreditation.evidence.clarifyN', { count: s.clarify }) : undefined },
          ]} />}
          {s && !s.items && !q && <Note>{t('accreditation.evidence.emptyHint')}</Note>}
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {tiles.map((row) => {
              const m = accrMetric(framework, row.code)
              const done = row.items.filter((i) => i.done).length
              return (
                <button key={row.code} type="button" onClick={() => setPanel(row.code)}
                  className={`flex min-w-0 flex-col gap-2 rounded-xl border bg-surface p-3.5 text-start shadow-card transition-colors hover:border-brand-300 ${row.items.length && done === row.items.length ? 'border-emerald-300' : 'border-border'}`}>
                  <span className="flex items-start gap-2">
                    <CodeBadge>{row.code}</CodeBadge>
                    <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-ink line-clamp-2">{m ? L.metric(framework, m) : row.code}</span>
                    <KindTag kind={row.kind} />
                  </span>
                  {row.items.length > 0 ? (
                    <span className="flex items-center gap-2">
                      <span className="flex flex-1 gap-1">{row.items.map((it) => <span key={it.key} title={it.label} className={`h-1.5 flex-1 rounded-full ${it.done ? 'bg-emerald-500' : it.evidence ? 'bg-amber-400' : 'bg-black/10'}`} />)}</span>
                      <span className="text-[11px] tabular-nums text-ink-faint">{done}/{row.items.length}</span>
                    </span>
                  ) : <span className="text-[11px] text-ink-faint">{t('accreditation.evidence.noChecklist')}</span>}
                  <span className="flex items-center gap-3 text-xs text-ink-muted">
                    <span className="inline-flex items-center gap-1"><FileCheck2 className="w-3.5 h-3.5" />{t('accreditation.evidence.itemsN', { count: row.evidence })}</span>
                    <span className="inline-flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />{row.files}</span>
                    {row.verified > 0 && <span className="inline-flex items-center gap-1 text-emerald-700"><ShieldCheck className="w-3.5 h-3.5" />{row.verified}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </SideNavLayout>
      )}
      {panelRow && !liveItem && <MetricPanel framework={framework} row={panelRow} items={itemsOf(panelRow.code)}
        onAdd={(preset) => setForm({ preset: { ...preset, year } })} onOpen={(row, e) => { if (!row) setPanel(null); else if (e) setOpenItem(e.id) }} />}
      {liveItem && <EvidenceDrawer framework={framework} item={liveItem} onClose={() => setOpenItem(null)} onEdit={() => setForm({ item: liveItem })} onChanged={refresh} />}
      {form && <EvidenceForm framework={framework} item={form.item} preset={form.preset} years={years} onClose={() => setForm(null)}
        onSaved={(saved) => { setForm(null); refresh(); showSuccess(t('accreditation.evidence.saved')); setOpenItem(saved.id) }} />}
    </PageContainer>
  )
}
