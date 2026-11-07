import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Trans, useTranslation } from 'react-i18next'
import { Braces, Check, Code2, FileText, LayoutTemplate, Plus, Printer, RotateCcw, Star, Trash2 } from 'lucide-react'
import { LETTERHEAD_IDS, LETTERHEAD_MODES, PAPER_BY, PAPER_SIZES, PRINT_DOC_BY } from '@schoolgiant/shared'
import { FormField, Input, Note, PageContainer, PageHeader, Panel, SegmentedControl, Select, StatusPill, Tabs, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import PrintPreview from '../../components/print/PrintPreview'
import DocPreview from '../../components/print/DocPreview'
import { fetchDocumentHelp } from '../../api/documents'
import { forgetPrintLayouts } from '../../components/print/printLayout'
import {
  createPrintTemplate, deletePrintTemplate, fetchLetterhead, fetchPrintTemplates, saveLetterhead, updatePrintTemplate,
} from '../../api/printing'
import { getCurrentUser, hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const MODE_LABEL = Object.fromEntries(LETTERHEAD_MODES.map((m) => [m.value, m.label]))
// labels: admin.printTemplates.docs.<docType> · papers.<paper> · modes.<mode>.label|hint · shortModes.<mode>
const docLabel = (t, d) => t(`admin.printTemplates.docs.${d.value}`, { defaultValue: d.label })
const paperLabel = (t, paper) => (PAPER_BY[paper] ? t(`admin.printTemplates.papers.${paper}`, { defaultValue: PAPER_BY[paper].label }) : paper)
const modeLabel = (t, mode) => t(`admin.printTemplates.modes.${mode}.label`, { defaultValue: MODE_LABEL[mode] ?? mode })
const isCard = (paper) => !!PAPER_BY[paper]?.card
// a document printed on ID cards offers only card sizes; every other document only the others
const papersFor = (doc) => PAPER_SIZES.filter((p) => !!p.card === isCard(doc.paper))
// starting designs of a document (the staff ID card): admin.printTemplates.designs.<key>.name|hint
const designName = (t, d) => t(`admin.printTemplates.designs.${d.key}.name`, { defaultValue: d.key[0].toUpperCase() + d.key.slice(1) })
const layoutLine = (t, tpl) => {
  const paper = PAPER_BY[tpl.paper] ? paperLabel(t, tpl.paper).split(' (')[0] : tpl.paper
  if (isCard(tpl.paper)) return paper // an ID card has no letterhead
  return t(tpl.orientation === 'landscape' ? 'admin.printTemplates.layoutLineLandscape' : 'admin.printTemplates.layoutLine', { paper, mode: modeLabel(t, tpl.letterhead) })
}

/** The institution letterhead and, per printed document, its paper, margins, header and footer. */
export default function PrintTemplates() {
  const { t } = useTranslation('admin')
  const [tab, setTab] = useState('documents')
  return (
    <PageContainer>
      <PageHeader icon={Printer} title={t('admin.printTemplates.title')} subtitle={t('admin.printTemplates.subtitle')} />
      <Tabs tabs={[{ value: 'documents', label: t('admin.printTemplates.tabs.documents') }, { value: 'letterhead', label: t('admin.printTemplates.tabs.letterhead') }]} value={tab} onChange={setTab} />
      {tab === 'letterhead' ? <LetterheadEditor /> : <Documents />}
    </PageContainer>
  )
}

// ───────────────────────────────────────────────────────── letterhead

function LetterheadEditor() {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const canEdit = hasPermission('core.print-templates.edit')
  const { data } = useQuery({ queryKey: ['print-letterhead'], queryFn: fetchLetterhead })
  const [f, setF] = useState(null)
  useEffect(() => { if (data) setF({ align: data.align, showLogo: data.showLogo, showContacts: data.showContacts, ids: data.ids, tagline: data.tagline ?? '', accentColor: data.accentColor ?? '', footerText: data.footerText ?? '' }) }, [data])
  const save = useMutation({
    mutationFn: () => saveLetterhead(f),
    onSuccess: (d) => { qc.setQueryData(['print-letterhead'], d); forgetPrintLayouts(); showSuccess(t('admin.printTemplates.letterhead.saved')) },
    onError: (e) => showError(e.message),
  })
  if (!data || !f) return <div className="h-80 rounded-xl bg-black/5 animate-pulse" />
  const h = data.institution
  const toggleId = (k) => setF((x) => ({ ...x, ids: x.ids.includes(k) ? x.ids.filter((i) => i !== k) : [...x.ids, k] }))
  const preview = { paper: 'A4', margins: { top: 12, right: 12, bottom: 16, left: 12 }, letterhead: 'FULL', showQr: true, showPrintedOn: true }

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
      <Panel title={t('admin.printTemplates.letterhead.title')} subtitle={t('admin.printTemplates.letterhead.subtitle')}>
        <div className="space-y-4">
          <Note tone="info"><Trans t={t} i18nKey="admin.printTemplates.letterhead.profileNote" components={{ link: <Link to="/core/profile" className="text-brand-600 hover:underline" /> }} /></Note>
          <FormField label={t('admin.printTemplates.letterhead.alignment')} hint={f.align === 'LEFT' ? t('admin.printTemplates.letterhead.alignLeftHint') : t('admin.printTemplates.letterhead.alignCenterHint')}><SegmentedControl options={[{ value: 'LEFT', label: t('admin.printTemplates.letterhead.alignLeft') }, { value: 'CENTER', label: t('admin.printTemplates.letterhead.alignCenter') }]} value={f.align} onChange={(v) => canEdit && setF((x) => ({ ...x, align: v }))} /></FormField>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div className="flex items-center gap-2 text-sm text-ink"><Switch size="sm" checked={f.showLogo} disabled={!canEdit} onChange={(v) => setF((x) => ({ ...x, showLogo: v }))} label={t('admin.printTemplates.letterhead.logo')} />{t('admin.printTemplates.letterhead.logo')}{!h.logoUrl && <span className="text-xs text-ink-faint">{t('admin.printTemplates.letterhead.noLogo')}</span>}</div>
            <div className="flex items-center gap-2 text-sm text-ink"><Switch size="sm" checked={f.showContacts} disabled={!canEdit} onChange={(v) => setF((x) => ({ ...x, showContacts: v }))} label={t('admin.printTemplates.letterhead.contacts')} />{t('admin.printTemplates.letterhead.contacts')}</div>
          </div>
          <FormField label={t('admin.printTemplates.letterhead.ids')}>
            <div className="grid sm:grid-cols-2 gap-2">
              {LETTERHEAD_IDS.map((id) => (
                <label key={id.value} className={clsx('flex items-start gap-2 text-sm', h[id.value] ? 'text-ink' : 'text-ink-faint')}>
                  <input type="checkbox" checked={f.ids.includes(id.value)} disabled={!canEdit} onChange={() => toggleId(id.value)} className="mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500" />
                  <span>{t(`admin.printTemplates.idLabels.${id.value}`, { defaultValue: id.label })}<span className="block text-xs text-ink-faint font-mono-num">{h[id.value] || t('admin.printTemplates.letterhead.notInProfile')}</span></span>
                </label>
              ))}
            </div>
          </FormField>
          <FormField label={t('admin.printTemplates.letterhead.tagline')} hint={t('admin.printTemplates.letterhead.taglineHint')}><Input value={f.tagline} disabled={!canEdit} onChange={(e) => setF((x) => ({ ...x, tagline: e.target.value }))} maxLength={120} /></FormField>
          <FormField label={t('admin.printTemplates.letterhead.accent')} hint={t('admin.printTemplates.letterhead.accentHint')}>
            <div className="flex items-center gap-2">
              <input type="color" aria-label={t('admin.printTemplates.letterhead.accent')} value={f.accentColor || h.primaryColor || '#0E7C86'} disabled={!canEdit} onChange={(e) => setF((x) => ({ ...x, accentColor: e.target.value }))} className="h-9 w-12 rounded border border-border bg-surface p-0.5" />
              <Input value={f.accentColor} disabled={!canEdit} onChange={(e) => setF((x) => ({ ...x, accentColor: e.target.value.trim() }))} placeholder={h.primaryColor || '#0E7C86'} className="font-mono-num w-32" maxLength={7} />
              {f.accentColor && canEdit && <Button size="sm" variant="ghost" onClick={() => setF((x) => ({ ...x, accentColor: '' }))}>{t('admin.printTemplates.letterhead.useBrand')}</Button>}
            </div>
          </FormField>
          <FormField label={t('admin.printTemplates.letterhead.footer')} hint={t('admin.printTemplates.letterhead.footerHint')}><Textarea rows={2} value={f.footerText} disabled={!canEdit} onChange={(e) => setF((x) => ({ ...x, footerText: e.target.value }))} maxLength={300} /></FormField>
          {canEdit && <div className="flex justify-end"><Button loading={save.isPending} icon={Check} onClick={() => save.mutate()}>{t('admin.printTemplates.letterhead.save')}</Button></div>}
        </div>
      </Panel>
      <div className="lg:sticky lg:top-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('admin.printTemplates.previewA4')}</p>
        <PrintPreview template={preview} letterhead={{ ...f, institution: h }} docType="LAB_REPORT" height={560} />
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────── documents

function Documents() {
  const { t } = useTranslation('admin')
  const { data: docs, isLoading } = useQuery({ queryKey: ['print-templates'], queryFn: fetchPrintTemplates })
  const { data: letterhead } = useQuery({ queryKey: ['print-letterhead'], queryFn: fetchLetterhead })
  const on = new Set(getCurrentUser()?.enabledModules ?? [])
  const shown = useMemo(() => (docs ?? []).filter((d) => !on.size || on.has(d.module)), [docs, on.size]) // eslint-disable-line react-hooks/exhaustive-deps
  const [docType, setDocType] = useState(null)
  const [editing, setEditing] = useState(null) // template | 'new' | 'pick' (choose a starting design) | { design }
  const doc = shown.find((d) => d.value === docType) ?? shown[0]
  useEffect(() => { setEditing(null) }, [docType])
  const { data: help } = useQuery({ queryKey: ['document-help', doc?.value], queryFn: () => fetchDocumentHelp(doc.value), enabled: !!doc?.server, staleTime: Infinity })
  const designs = doc?.server && help?.docType === doc?.value ? help.designs ?? [] : []

  if (isLoading || !doc) return <div className="h-80 rounded-xl bg-black/5 animate-pulse" />
  const def = doc.templates.find((tp) => tp.isDefault) ?? doc.builtIn
  const docName = docLabel(t, doc)
  const tplName = (tp) => (tp.builtIn ? t('admin.printTemplates.standardLayout') : tp.name)
  return (
    <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-6 items-start">
      <nav className="bg-surface border border-border rounded-xl shadow-card p-2 space-y-0.5" aria-label={t('admin.printTemplates.tabs.documents')}>
        {shown.map((d) => {
          const dd = d.templates.find((tp) => tp.isDefault) ?? d.builtIn
          return (
            <button key={d.value} type="button" onClick={() => setDocType(d.value)}
              className={clsx('w-full text-start rounded-lg px-3 py-2 transition-colors', d.value === doc.value ? 'bg-brand-50 text-brand-700' : 'hover:bg-bg text-ink')}>
              <span className="flex items-center gap-2 text-sm font-medium"><FileText className="w-4 h-4 shrink-0 opacity-60" />{docLabel(t, d)}</span>
              <span className="block ps-6 text-xs text-ink-faint truncate">{d.ready ? `${tplName(dd)} · ${layoutLine(t, dd)}` : t('admin.printTemplates.usesSoon')}</span>
            </button>
          )
        })}
      </nav>
      <div className="space-y-6 min-w-0">
        <Panel title={docName} subtitle={t('admin.printTemplates.docSubtitle', { name: tplName(def) })}
          actions={hasPermission('core.print-templates.create') && <Button size="sm" icon={Plus} onClick={() => setEditing(designs.length ? 'pick' : 'new')}>{t('admin.printTemplates.newTemplate')}</Button>}>
          {!doc.ready && <Note tone="warning" className="mb-4">{t('admin.printTemplates.notReady', { doc: docName.toLowerCase() })}</Note>}
          <div className="divide-y divide-border -my-2">
            {doc.templates.length === 0 && (
              <div className="py-3 flex items-center gap-3 text-sm">
                <StatusPill tone="neutral">{t('admin.printTemplates.builtIn')}</StatusPill><span className="text-ink">{t('admin.printTemplates.standardLayout')}</span><span className="text-xs text-ink-faint">{layoutLine(t, doc.builtIn)}</span>
              </div>
            )}
            {doc.templates.map((tp) => (
              <TemplateRow key={tp.id} tpl={tp} active={editing?.id === tp.id} onEdit={() => setEditing(tp)} />
            ))}
          </div>
        </Panel>
        {editing === 'pick'
          ? <DesignPicker doc={doc} designs={designs} base={def} onPick={(design) => setEditing({ design })} onClose={() => setEditing(null)} />
          : editing
          ? <TemplateEditor key={editing === 'new' ? `new-${doc.value}` : editing.design ? `new-${doc.value}-${editing.design.key}` : editing.id} doc={doc}
              template={editing === 'new' || editing.design ? null : editing} design={editing.design} base={def} letterhead={letterhead} onClose={() => setEditing(null)} />
          : (
            <Panel title={t('admin.printTemplates.preview')} subtitle={`${tplName(def)} · ${paperLabel(t, def.paper)}${doc.server ? ` · ${t('admin.printTemplates.latestRecord')}` : ''}`}>
              {doc.server
                ? <DocPreview key={`${doc.value}-${def.paper}`} docType={doc.value} templateId={def.id} layout={{ paper: def.paper, orientation: def.orientation ?? 'portrait' }} />
                : letterhead && <PrintPreview template={def} letterhead={letterhead} docType={doc.value} />}
            </Panel>
          )}
      </div>
    </div>
  )
}

/** A new template of a document with starting designs (the staff ID card): pick one, then edit it. */
function DesignPicker({ doc, designs, base, onPick, onClose }) {
  const { t } = useTranslation('admin')
  const layout = { paper: base.paper, orientation: base.orientation ?? 'portrait' }
  return (
    <Panel title={t('admin.printTemplates.designPicker.title')} subtitle={t('admin.printTemplates.designPicker.subtitle')}
      actions={<Button size="sm" variant="ghost" onClick={onClose}>{t('actions.close')}</Button>}>
      <div className="grid sm:grid-cols-2 gap-4">
        {designs.map((d) => (
          <div key={d.key} className="rounded-xl border border-border p-3 flex flex-col gap-2.5 hover:border-brand-300 transition-colors">
            <div className="flex items-start gap-2">
              <LayoutTemplate className="w-4 h-4 mt-0.5 shrink-0 text-ink-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink flex items-center gap-2">{designName(t, d)}{d.builtIn && <StatusPill tone="neutral">{t('admin.printTemplates.builtIn')}</StatusPill>}</p>
                <p className="text-xs text-ink-faint">{t(`admin.printTemplates.designs.${d.key}.hint`, { defaultValue: '' })}</p>
              </div>
            </div>
            <div className="pointer-events-none select-none" aria-hidden="true">
              <DocPreview docType={doc.value} body={d.source} layout={layout} height={250} />
            </div>
            <Button size="sm" variant="secondary" onClick={() => onPick(d)}>{t('admin.printTemplates.designPicker.use')}</Button>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function TemplateRow({ tpl, active, onEdit }) {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const makeDefault = useMutation({
    mutationFn: () => updatePrintTemplate(tpl.id, { isDefault: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['print-templates'] }); forgetPrintLayouts(); showSuccess(t('admin.printTemplates.nowDefault', { name: tpl.name })) },
    onError: (e) => showError(e.message),
  })
  return (
    <div className={clsx('py-3 flex flex-wrap items-center gap-x-3 gap-y-1', active && 'bg-brand-50/40 -mx-5 px-5')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink flex items-center gap-2">{tpl.name}{tpl.isDefault && <StatusPill tone="success">{t('admin.printTemplates.default')}</StatusPill>}{!tpl.active && <StatusPill tone="neutral">{t('ui.common.off')}</StatusPill>}</p>
        <p className="text-xs text-ink-faint">{layoutLine(t, tpl)}{tpl.updatedBy ? ` · ${t('admin.printTemplates.changedBy', { name: tpl.updatedBy })}` : ''}</p>
      </div>
      {!tpl.isDefault && tpl.active && hasPermission('core.print-templates.edit') && <Button size="sm" variant="ghost" icon={Star} loading={makeDefault.isPending} onClick={() => makeDefault.mutate()}>{t('admin.printTemplates.makeDefault')}</Button>}
      {hasPermission('core.print-templates.edit') && <Button size="sm" variant="secondary" onClick={onEdit}>{t('actions.edit')}</Button>}
    </div>
  )
}

function TemplateEditor({ doc, template, design, base, letterhead, onClose }) {
  const { t } = useTranslation('admin')
  const docName = docLabel(t, doc)
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  // a new template from a starting design takes the design's name and body; the paper stays the current default's
  const start = template ?? { ...base, name: design ? designName(t, design) : base.builtIn ? '' : t('admin.printTemplates.copyName', { name: base.name }), isDefault: false, active: true }
  const [f, setF] = useState(() => ({
    name: start.name, paper: start.paper, orientation: start.orientation ?? 'portrait', margins: { ...start.margins }, letterhead: start.letterhead,
    headerSpaceMm: start.headerSpaceMm ?? 35, footerSpaceMm: start.footerSpaceMm ?? 20, footerText: start.footerText ?? '',
    showQr: start.showQr !== false, showPrintedOn: start.showPrintedOn !== false, fontScale: start.fontScale ?? 100, active: start.active !== false,
    isDefault: template ? template.isDefault : doc.templates.length === 0,
  }))
  // the document body: null = the standard layout, a string = this institution's own Handlebars template
  const [docBody, setDocBody] = useState(() => (template?.body ? template.body : design ? design.source : start.body || null))
  const [showVars, setShowVars] = useState(false)
  const { data: help } = useQuery({ queryKey: ['document-help', doc.value], queryFn: () => fetchDocumentHelp(doc.value), enabled: !!doc.server, staleTime: Infinity })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const num = (v) => Number(String(v).replace(/[^\d.]/g, '')) || 0
  const setMargin = (k) => (e) => setF((x) => ({ ...x, margins: { ...x.margins, [k]: e.target.value.replace(/[^\d.]/g, '') } }))
  const done = (msg) => { qc.invalidateQueries({ queryKey: ['print-templates'] }); forgetPrintLayouts(); showSuccess(msg); onClose() }

  const body = () => ({
    ...f, margins: Object.fromEntries(Object.entries(f.margins).map(([k, v]) => [k, num(v)])),
    headerSpaceMm: num(f.headerSpaceMm), footerSpaceMm: num(f.footerSpaceMm), fontScale: num(f.fontScale) || 100,
    ...(doc.server && { body: docBody ?? null }),
  })
  const save = useMutation({
    mutationFn: () => (template ? updatePrintTemplate(template.id, body()) : createPrintTemplate({ ...body(), docType: doc.value })),
    onSuccess: (saved) => done(t('admin.printTemplates.savedTemplate', { name: saved.name })),
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const remove = useMutation({ mutationFn: () => deletePrintTemplate(template.id), onSuccess: () => done(t('admin.printTemplates.deleted', { name: template.name })), onError: (e) => showError(e.message) })
  const askDelete = async () => {
    if (await confirm({ title: t('admin.printTemplates.deleteTitle', { name: template.name }), message: template.isDefault ? t('admin.printTemplates.deleteDefaultMsg') : t('admin.printTemplates.deleteMsg'), tone: 'danger', confirmLabel: t('admin.printTemplates.deleteConfirm') })) remove.mutate()
  }
  const preview = body()
  const { name: _n, isDefault: _d, active: _a, body: _b, ...layout } = preview
  const card = isCard(f.paper) // an ID card: edge to edge, no letterhead, the design sets everything else

  return (
    <Panel title={template ? t('admin.printTemplates.editTitle', { name: template.name }) : t('admin.printTemplates.newTitle', { doc: docName.toLowerCase() })} subtitle={PRINT_DOC_BY[doc.value] ? docLabel(t, PRINT_DOC_BY[doc.value]) : docName}
      actions={<Button size="sm" variant="ghost" onClick={onClose}>{t('actions.close')}</Button>}>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-6 items-start">
        <div className="space-y-4">
          <FormField label={t('common.name')} required error={errors.name}><Input value={f.name} onChange={set('name')} maxLength={60} placeholder={t('admin.printTemplates.namePlaceholder')} autoFocus={!template} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('admin.printTemplates.paper')}><Select value={f.paper} onChange={set('paper')}>{papersFor(doc).map((p) => <option key={p.value} value={p.value}>{paperLabel(t, p.value)}</option>)}</Select></FormField>
            <FormField label={t('admin.printTemplates.orientation')}><Select value={card ? 'portrait' : f.orientation} onChange={set('orientation')} disabled={f.paper === 'THERMAL_80' || card}><option value="portrait">{t('admin.printTemplates.portrait')}</option><option value="landscape">{t('admin.printTemplates.landscape')}</option></Select></FormField>
          </div>
          {card && <Note tone="info">{t('admin.printTemplates.cardNote')}</Note>}
          {!card && <>
            <FormField label={t('admin.printTemplates.tabs.letterhead')} hint={LETTERHEAD_MODES.some((m) => m.value === f.letterhead) ? t(`admin.printTemplates.modes.${f.letterhead}.hint`, { defaultValue: LETTERHEAD_MODES.find((m) => m.value === f.letterhead).hint }) : undefined}>
              <SegmentedControl options={LETTERHEAD_MODES.map((m) => ({ value: m.value, label: t(`admin.printTemplates.shortModes.${m.value}`, { defaultValue: m.label }) }))} value={f.letterhead} onChange={(v) => setF((x) => ({ ...x, letterhead: v }))} />
            </FormField>
            {f.letterhead === 'PREPRINTED' && (
              <div className="grid grid-cols-2 gap-3">
                <FormField label={t('admin.printTemplates.headerSpace')}><Input inputMode="decimal" value={f.headerSpaceMm} onChange={set('headerSpaceMm')} /></FormField>
                <FormField label={t('admin.printTemplates.footerSpace')}><Input inputMode="decimal" value={f.footerSpaceMm} onChange={set('footerSpaceMm')} /></FormField>
              </div>
            )}
            <FormField label={t('admin.printTemplates.marginsMm')} error={errors.margins}>
              <div className="grid grid-cols-4 gap-2">
                {['top', 'right', 'bottom', 'left'].map((k) => <div key={k}><Input inputMode="decimal" aria-label={t(`admin.printTemplates.marginAria.${k}`)} value={f.margins[k] ?? ''} onChange={setMargin(k)} className="font-mono-num text-center" /><p className="text-[11px] text-ink-faint text-center mt-0.5">{t(`admin.printTemplates.margins.${k}`)}</p></div>)}
              </div>
            </FormField>
            <FormField label={t('admin.printTemplates.textSize')} hint={t('admin.printTemplates.textSizeHint')}><Select value={f.fontScale} onChange={set('fontScale')}>{[90, 100, 110, 120].map((v) => <option key={v} value={v}>{v}%</option>)}</Select></FormField>
            <FormField label={t('admin.printTemplates.footerText')} hint={t('admin.printTemplates.footerTextHint')}><Textarea rows={2} value={f.footerText} onChange={set('footerText')} maxLength={300} /></FormField>
          </>}
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-ink">
            {!card && <div className="flex items-center gap-2"><Switch size="sm" checked={f.showQr} onChange={(v) => setF((x) => ({ ...x, showQr: v }))} label={t('admin.printTemplates.qrCode')} />{t('admin.printTemplates.qrToVerify')}</div>}
            {!card && <div className="flex items-center gap-2"><Switch size="sm" checked={f.showPrintedOn} onChange={(v) => setF((x) => ({ ...x, showPrintedOn: v }))} label={t('admin.printTemplates.printedOnDate')} />{t('admin.printTemplates.printedOnQuoted')}</div>}
            <div className="flex items-center gap-2"><Switch size="sm" checked={f.isDefault} disabled={template?.isDefault} onChange={(v) => setF((x) => ({ ...x, isDefault: v, active: v ? true : x.active }))} label={t('admin.printTemplates.default')} />{t('admin.printTemplates.defaultFor', { doc: docName.toLowerCase() })}</div>
            {!f.isDefault && <div className="flex items-center gap-2"><Switch size="sm" checked={f.active} onChange={(v) => setF((x) => ({ ...x, active: v }))} label={t('admin.printTemplates.inUse')} />{t('admin.printTemplates.inUse')}</div>}
          </div>
          {doc.server && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Code2 className="w-4 h-4 text-ink-muted" />
                <p className="text-sm font-medium text-ink flex-1">{t('admin.printTemplates.docBody')}</p>
                {docBody === null
                  ? <Button size="sm" variant="secondary" icon={Code2} disabled={!help} onClick={() => setDocBody(help?.source ?? '')}>{t('admin.printTemplates.customise')}</Button>
                  : <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setDocBody(null)}>{t('admin.printTemplates.useStandard')}</Button>}
              </div>
              {docBody === null ? (
                <p className="text-xs text-ink-muted">{t('admin.printTemplates.standardBodyNote', { doc: docName.toLowerCase() })}</p>
              ) : (
                <>
                  <FormField error={errors.body}>
                    <Textarea aria-label={t('admin.printTemplates.templateBody')} rows={20} spellCheck={false} value={docBody} onChange={(e) => setDocBody(e.target.value)}
                      className="font-mono-num text-[12px] leading-5 whitespace-pre" />
                  </FormField>
                  <button type="button" onClick={() => setShowVars((v) => !v)} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1"><Braces className="w-3.5 h-3.5" />{showVars ? t('admin.printTemplates.hideVars') : t('admin.printTemplates.showVars')}</button>
                  {showVars && help && (
                    <div className="rounded-md bg-black/[0.03] p-2.5 text-[11px] leading-5 text-ink-muted space-y-1.5">
                      {help.variables.map((v) => <p key={v} className="font-mono-num break-words">{v}</p>)}
                      <p className="pt-1 border-t border-border">{t('admin.printTemplates.helpers')} {help.helpers.map((h) => <code key={h} className="me-1.5 text-ink">{h}</code>)}</p>
                      <p>{t('admin.printTemplates.examples')} <code className="text-ink">{'{{money totals.net}}'}</code> · <code className="text-ink">{'{{dateTime admittedAt}}'}</code> · <code className="text-ink">{'{{#each lines}}…{{/each}}'}</code> · <code className="text-ink">{'{{qr verifyUrl 20}}'}</code></p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            {template && hasPermission('core.print-templates.delete') && <Button variant="ghost" icon={Trash2} loading={remove.isPending} onClick={askDelete}>{t('actions.delete')}</Button>}
            <span className="flex-1" />
            <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>{t('admin.printTemplates.saveTemplate')}</Button>
          </div>
        </div>
        <div className="space-y-2 xl:sticky xl:top-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('admin.printTemplates.previewPaper', { paper: paperLabel(t, f.paper) })}{doc.server ? ` · ${t('admin.printTemplates.latestRecord')}` : ''}</p>
          {doc.server
            ? <DocPreview key={f.paper} docType={doc.value} body={docBody ?? help?.source} layout={layout} templateId={template?.id} />
            : <PrintPreview template={preview} letterhead={letterhead} docType={doc.value} />}
        </div>
      </div>
    </Panel>
  )
}
