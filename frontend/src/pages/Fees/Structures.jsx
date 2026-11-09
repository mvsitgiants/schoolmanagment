import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleCheckBig, FilePlus2, FileText, Hourglass, Layers, Pencil, Plus, Tags, Trash2, X } from 'lucide-react'
import { formatINR, formatINRCompact, splitEqually, toPaise, toRupees } from '@schoolgiant/shared'
import { CodeBadge, ColorChip, ControlChip, DataTable, DateCell, FormField, Fraction, HeaderButton, Input, LevelBar, Modal, Money, Note, PageContainer, PageHeader, Select, StackCell, StatCardRow, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAcademicLookup } from '../../api/academics'
import { createFeeHead, createStructure, deleteStructure, fetchFeeHeads, fetchStructures, generateInvoices, updateFeeHead, updateStructure } from '../../api/fees'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const addMonths = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + n, Math.min(d, 28)))
  return dt.toISOString().slice(0, 10)
}

/** Add or edit a structure: the classes it covers, the fees in it, and how they are split into installments. */
function StructureEditor({ structure, year, classes, heads, onClose, onSaved }) {
  const { t } = useTranslation('fees')
  const { showError } = useSnackbar()
  const locked = (structure?.invoices ?? 0) > 0
  const [form, setForm] = useState(() => ({
    name: structure?.name ?? '',
    classIds: structure?.classIds ?? [],
    appliesTo: structure?.appliesTo ?? 'ALL',
    lines: (structure?.lines ?? []).map((l) => ({ feeHeadId: l.feeHeadId, amount: String(toRupees(l.amount)) })),
    installments: (structure?.installments ?? []).map((i) => ({ name: i.name, dueDate: i.dueDate, amount: String(toRupees(i.amount)) })),
  }))
  const [count, setCount] = useState(String(structure?.installments?.length || 1))
  const [errors, setErrors] = useState({})
  const total = form.lines.reduce((n, l) => n + toPaise(l.amount), 0)
  const split = form.installments.reduce((n, i) => n + toPaise(i.amount), 0)
  const setLine = (i, k, v) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }))
  const setInst = (i, k, v) => setForm((f) => ({ ...f, installments: f.installments.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }))
  const toggleClass = (id) => setForm((f) => ({ ...f, classIds: f.classIds.includes(id) ? f.classIds.filter((x) => x !== id) : [...f.classIds, id] }))
  const splitNow = () => {
    const n = Math.min(24, Math.max(1, Number(count) || 1))
    const amounts = splitEqually(total, n)
    const gap = Math.max(1, Math.floor(12 / n))
    setForm((f) => ({ ...f, installments: amounts.map((a, i) => ({ name: n === 1 ? t('fees.structures.annual') : t('fees.structures.installmentN', { n: i + 1 }), dueDate: addMonths(year.startDate, i * gap), amount: String(toRupees(a)) })) }))
  }
  const body = () => ({
    name: form.name, academicYearId: year.id, classIds: form.classIds, appliesTo: form.appliesTo,
    lines: form.lines.filter((l) => l.feeHeadId).map((l) => ({ feeHeadId: l.feeHeadId, amount: toPaise(l.amount) })),
    installments: form.installments.map((i) => ({ name: i.name, dueDate: i.dueDate, amount: toPaise(i.amount) })),
  })
  const save = useMutation({
    mutationFn: () => (structure ? updateStructure(structure.id, body()) : createStructure(body())),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const activeHeads = heads.filter((h) => h.active || form.lines.some((l) => l.feeHeadId === h.id))

  return (
    <Modal open onClose={onClose} size="lg" title={structure ? t('fees.structures.editTitle') : t('fees.structures.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={locked || !form.name.trim() || !form.classIds.length || !total} onClick={() => save.mutate()}>{t('fees.structures.save')}</Button>
    </>}>
      <div className="space-y-5">
        {locked && <Note tone="warning">{t('fees.structures.lockedHint', { count: structure.invoices })}</Note>}
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('fees.structures.name')} required error={errors.name}><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('fees.structures.namePlaceholder')} /></FormField>
          <FormField label={t('fees.structures.appliesTo')} hint={t('fees.structures.appliesToHint')}>
            <Select value={form.appliesTo} onChange={(e) => setForm((f) => ({ ...f, appliesTo: e.target.value }))}>
              <option value="ALL">{t('fees.structures.applies.ALL')}</option>
              <option value="NEW">{t('fees.structures.applies.NEW')}</option>
            </Select>
          </FormField>
        </div>

        <div>
          <p className="text-xs font-medium text-ink-muted mb-2">{t('fees.structures.classes')} <span className="text-danger-500">*</span></p>
          <div className="flex flex-wrap gap-2">
            {classes.map((c) => (
              <label key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg">
                <input type="checkbox" checked={form.classIds.includes(c.id)} onChange={() => toggleClass(c.id)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                {c.name}
              </label>
            ))}
          </div>
          {errors.classIds && <p className="text-xs text-danger-600 mt-1">{errors.classIds}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-ink-muted">{t('fees.structures.fees')}</p>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { feeHeadId: '', amount: '' }] }))}>{t('fees.structures.addFee')}</Button>
          </div>
          <div className="space-y-2">
            {form.lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1"><Select value={l.feeHeadId} onChange={(e) => setLine(i, 'feeHeadId', e.target.value)}>
                  <option value="">{t('fees.structures.pickHead')}</option>
                  {activeHeads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </Select></div>
                <Input className="w-36 text-right" type="number" min="0" step="1" value={l.amount} onChange={(e) => setLine(i, 'amount', e.target.value)} placeholder={t('fees.structures.amountPlaceholder')} />
                <Button size="sm" variant="ghost" icon={X} aria-label={t('fees.structures.remove')} onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))} />
              </div>
            ))}
            {!form.lines.length && <p className="text-sm text-ink-faint">{t('fees.structures.noFees')}</p>}
          </div>
          {errors.lines && <p className="text-xs text-danger-600 mt-1">{errors.lines}</p>}
          <p className="text-sm text-ink mt-2 text-right">{t('fees.structures.totalForYear')} <b className="font-mono-num">{formatINR(total)}</b></p>
        </div>

        <div>
          <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-ink-muted">{t('fees.structures.installments')}</p>
            <div className="flex items-center gap-2">
              <Input className="w-20" type="number" min="1" max="24" value={count} onChange={(e) => setCount(e.target.value)} aria-label={t('fees.structures.howMany')} />
              <Button size="sm" variant="secondary" disabled={!total} onClick={splitNow}>{t('fees.structures.splitEqually')}</Button>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, installments: [...f.installments, { name: '', dueDate: year.startDate, amount: '' }] }))}>{t('fees.structures.addInstallment')}</Button>
            </div>
          </div>
          <div className="space-y-2">
            {form.installments.map((ins, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input className="flex-1" value={ins.name} onChange={(e) => setInst(i, 'name', e.target.value)} placeholder={t('fees.structures.installmentName')} />
                <Input className="w-40" type="date" value={ins.dueDate} min={year.startDate} max={year.endDate} onChange={(e) => setInst(i, 'dueDate', e.target.value)} aria-label={t('fees.structures.dueDate')} />
                <Input className="w-36 text-right" type="number" min="0" step="1" value={ins.amount} onChange={(e) => setInst(i, 'amount', e.target.value)} placeholder={t('fees.structures.amountPlaceholder')} />
                <Button size="sm" variant="ghost" icon={X} aria-label={t('fees.structures.remove')} onClick={() => setForm((f) => ({ ...f, installments: f.installments.filter((_, j) => j !== i) }))} />
              </div>
            ))}
          </div>
          {errors.installments && <p className="text-xs text-danger-600 mt-1">{errors.installments}</p>}
          {form.installments.length > 0 && split !== total && <Note tone="warning" className="mt-2">{t('fees.structures.splitMismatch', { split: formatINR(split), total: formatINR(total) })}</Note>}
        </div>
      </div>
    </Modal>
  )
}

/** The fee heads (Tuition, Transport …) every structure is built from. */
function HeadsModal({ heads, onClose }) {
  const { t } = useTranslation('fees')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const empty = { id: null, name: '', code: '', refundable: false }
  const [form, setForm] = useState(empty)
  const [errors, setErrors] = useState({})
  const canCreate = hasPermission('fees.structures.create')
  const canEdit = hasPermission('fees.structures.edit')
  const done = (msg) => { qc.invalidateQueries({ queryKey: ['fee-heads'] }); setForm(empty); setErrors({}); showSuccess(msg) }
  const save = useMutation({
    mutationFn: () => (form.id ? updateFeeHead(form.id, { name: form.name, code: form.code, refundable: form.refundable }) : createFeeHead({ name: form.name, code: form.code, refundable: form.refundable })),
    onSuccess: () => done(t('fees.heads.saved')),
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const toggle = useMutation({ mutationFn: (h) => updateFeeHead(h.id, { active: !h.active }), onSuccess: () => done(t('fees.heads.saved')), onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="lg" title={t('fees.heads.title')} footer={<Button variant="secondary" onClick={onClose}>{t('fees.heads.close')}</Button>}>
      <div className="space-y-4">
        {(canCreate || (form.id && canEdit)) && (
          <div className="grid sm:grid-cols-[1fr_9rem_auto_auto] gap-3 items-end">
            <FormField label={t('fees.heads.name')} required error={errors.name}><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></FormField>
            <FormField label={t('fees.heads.code')} required error={errors.code}><Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} /></FormField>
            <label className="inline-flex items-center gap-2 text-sm h-9">
              <input type="checkbox" checked={form.refundable} onChange={(e) => setForm((f) => ({ ...f, refundable: e.target.checked }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
              {t('fees.heads.refundable')}
            </label>
            <div className="flex gap-2">
              {form.id && <Button variant="ghost" onClick={() => setForm(empty)}>{t('actions.cancel')}</Button>}
              <Button loading={save.isPending} disabled={form.name.trim().length < 2 || !form.code.trim()} onClick={() => save.mutate()}>{form.id ? t('fees.heads.update') : t('fees.heads.add')}</Button>
            </div>
          </div>
        )}
        <DataTable
          rows={heads}
          dense
          columns={[
            { key: 'name', header: t('fees.heads.name'), mobilePrimary: true, render: (v, r) => (r.active ? <ColorChip label={v} seed={r.id} dot /> : <span className="text-ink-faint line-through">{v}</span>) },
            { key: 'code', header: t('fees.heads.code'), render: (v) => <CodeBadge>{v}</CodeBadge> },
            { key: 'refundable', header: t('fees.heads.refundable'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('fees.yes') : t('fees.no')}</StatusPill> },
            { key: 'id', header: '', align: 'right', width: 150, render: (_, r) => canEdit && (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('fees.heads.edit')} onClick={() => setForm({ id: r.id, name: r.name, code: r.code, refundable: !!r.refundable })} />
                <Button size="sm" variant="ghost" onClick={() => toggle.mutate(r)}>{r.active ? t('fees.heads.deactivate') : t('fees.heads.activate')}</Button>
              </div>
            ) },
          ]}
          emptyIcon={Tags} emptyTitle={t('fees.heads.empty')}
        />
      </div>
    </Modal>
  )
}

export default function Structures() {
  const { t } = useTranslation('fees')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [yearId, setYearId] = useState('')
  const [editing, setEditing] = useState(null) // 'new' | structure
  const [headsOpen, setHeadsOpen] = useState(false)
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['fee-structures', yearId], queryFn: () => fetchStructures(yearId) })
  const { data: heads = [] } = useQuery({ queryKey: ['fee-heads'], queryFn: fetchFeeHeads })
  const years = useMemo(() => lookup?.years ?? [], [lookup])
  const year = data?.year
  const refresh = () => qc.invalidateQueries({ queryKey: ['fee-structures'] })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (res, v) => { refresh(); showSuccess(v.done(res)) }, onError: (e) => showError(e.message) })
  const canCreate = hasPermission('fees.structures.create')
  const list = data?.structures ?? []
  const billed = list.reduce((n, s) => n + s.billed, 0)
  const collected = list.reduce((n, s) => n + s.collected, 0)
  const pending = list.filter((s) => !s.invoices).length

  return (
    <PageContainer>
      <PageHeader icon={Layers} title={t('fees.structures.title')} subtitle={t('fees.structures.subtitle')}
        actions={<>
          <HeaderButton icon={Tags} onClick={() => setHeadsOpen(true)}>{t('fees.heads.button')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="fees.structures.create" onClick={() => setEditing('new')}>{t('fees.structures.new')}</HeaderButton>
        </>} />
      {year?.closed && <Note tone="warning" className="mb-4">{t('fees.structures.yearClosed', { year: year.name })}</Note>}
      {list.length > 0 && (
        <StatCardRow className="mb-4" items={[
          { icon: Layers, tone: 'brand', label: t('fees.structures.summary.structures'), value: list.length, sub: t('fees.structures.summary.classes', { count: new Set(list.flatMap((s) => s.classIds)).size }) },
          { icon: FileText, tone: 'violet', label: t('fees.structures.summary.billed'), value: formatINRCompact(billed), sub: t('fees.structures.summary.students', { count: list.reduce((n, s) => n + s.students, 0) }) },
          { icon: CircleCheckBig, tone: 'success', label: t('fees.structures.summary.collected'), value: formatINRCompact(collected),
            sub: t('fees.structures.summary.ofBilled', { pct: billed > 0 ? Math.round((collected / billed) * 100) : 0 }), progress: billed > 0 ? (collected / billed) * 100 : 0 },
          { icon: Hourglass, tone: pending ? 'warning' : 'teal', label: t('fees.structures.notInvoiced'), value: pending },
        ]} />
      )}
      <DataTable
        rows={list}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        toolbar={<div className="flex justify-end">
          <ControlChip label={t('fees.structures.year')} value={year?.name ?? '—'} active={!!yearId}
            options={years.map((y) => y.name)} onChange={(v) => setYearId(years.find((y) => y.name === v)?.id ?? '')} />
        </div>}
        columns={[
          { key: 'name', header: t('fees.structures.name'), mobilePrimary: true, render: (v, r) => <div className="min-w-0"><p className="font-medium text-ink">{v}</p>
            <div className="mt-1 flex flex-wrap gap-1">{r.classes.length ? r.classes.map((c) => <ColorChip key={c.id} label={c.name} seed={c.id} />) : <span className="text-xs text-ink-faint">—</span>}</div></div> },
          { key: 'lines', header: t('fees.structures.fees'), mobileHidden: true, render: (v) => <div className="flex flex-wrap gap-1">{v.map((l) => <ColorChip key={l.feeHeadId} label={l.name} seed={l.feeHeadId} dot />)}</div> },
          { key: 'installments', header: t('fees.structures.installments'), render: (v) => (v.length === 1
            ? <DateCell value={v[0].dueDate} relative={false} />
            : <StackCell title={t('fees.structures.installmentCount', { count: v.length })} sub={v[0] ? date(v[0].dueDate) : undefined} />) },
          { key: 'total', header: t('fees.structures.perStudent'), align: 'right', render: (v) => <Money value={v} paise className="font-semibold" /> },
          { key: 'students', header: t('fees.structures.invoiced'), align: 'right', render: (v, r) => (r.invoices ? t('fees.structures.studentsCount', { count: v }) : <StatusPill tone="warning">{t('fees.structures.notInvoiced')}</StatusPill>) },
          { key: 'collected', header: t('fees.structures.collected'), align: 'right', mobileHidden: true, render: (v, r) => (r.billed
            ? <span className="inline-flex flex-col items-end gap-1"><Fraction value={v} max={r.billed} format={formatINRCompact} /><LevelBar value={v} max={r.billed} bare width="w-24" /></span>
            : <span className="text-ink-faint">—</span>) },
          { key: 'id', header: '', align: 'right', width: 140, render: (id, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {canCreate && !year?.closed && <Button size="sm" variant="ghost" icon={FilePlus2} title={t('fees.structures.generate')} aria-label={t('fees.structures.generate')}
                onClick={async () => { if (await confirm({ title: t('fees.structures.generateConfirm.title', { name: r.name }), message: t('fees.structures.generateConfirm.message'), confirmLabel: t('fees.structures.generate') })) act.mutate({ fn: () => generateInvoices(id), done: (res) => t('fees.structures.generated', { created: res.created, students: res.students }) }) }} />}
              {hasPermission('fees.structures.edit') && <Button size="sm" variant="ghost" icon={Pencil} title={t('fees.structures.edit')} aria-label={t('fees.structures.edit')} onClick={() => setEditing(r)} />}
              {hasPermission('fees.structures.delete') && !r.invoices && <Button size="sm" variant="ghost" icon={Trash2} title={t('fees.structures.delete')} aria-label={t('fees.structures.delete')}
                onClick={async () => { if (await confirm({ title: t('fees.structures.deleteConfirm', { name: r.name }), tone: 'danger', confirmLabel: t('fees.structures.delete') })) act.mutate({ fn: () => deleteStructure(id), done: () => t('fees.structures.deleted') }) }} />}
            </div>
          ) },
        ]}
        onRowClick={hasPermission('fees.structures.edit') ? (r) => setEditing(r) : undefined}
        emptyIcon={Layers} emptyTitle={t('fees.structures.empty')} emptyHint={t('fees.structures.emptyHint')}
      />
      {editing && year && <StructureEditor structure={editing === 'new' ? null : editing} year={year} classes={lookup?.classes ?? []} heads={heads}
        onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); showSuccess(t('fees.structures.saved')) }} />}
      {headsOpen && <HeadsModal heads={heads} onClose={() => setHeadsOpen(false)} />}
    </PageContainer>
  )
}
