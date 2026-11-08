import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Printer, Trash2, X } from 'lucide-react'
import { EMPLOYEE_CATEGORIES, PAY_ADJUSTMENT_CODES, PAY_COMPONENTS, PAY_COMPONENT_BY, PAYROLL_RUN_STATUSES, PCT_BASES, structureProblem, toPaise, toRupees } from '@schoolgiant/shared'
import { Drawer, FormField, Input, Modal, Money, Note, Panel, Select, StatusPill, Textarea } from '../system'
import Button from '../ui/Button'
import { addPayslipLine, createStructure, editPayslipLop, fetchPayrollMeta, fetchPayslip, removePayslipLine, updateStructure } from '../../api/payroll'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { printDocument } from '../print/printDocument'

export const usePayrollMeta = () => useQuery({ queryKey: ['payroll-meta'], queryFn: fetchPayrollMeta, staleTime: 60_000 })

/** "October 2026" from 'YYYY-MM', in the interface language. */
export function useMonthLabel() {
  const { t } = useTranslation('payroll')
  return (ym) => (ym ? `${t(`payroll.months.${Number(ym.slice(5, 7))}`)} ${ym.slice(0, 4)}` : '—')
}

export function RunStatusPill({ status }) {
  const { t } = useTranslation('payroll')
  return <StatusPill tone={PAYROLL_RUN_STATUSES[status]?.tone}>{t(`payroll.runStatus.${status}`)}</StatusPill>
}

/** A rule as text: "40% of basic", "₹1,600", "Balance of the gross". */
export function useRuleText() {
  const { t } = useTranslation('payroll')
  return (rule) => {
    if (!rule) return '—'
    if (rule.type === 'FIXED') return <Money value={rule.amount ?? 0} paise />
    if (rule.type === 'PCT') return t('payroll.rule.pct', { pct: rule.pct, of: t(`payroll.pctBases.${rule.of}`) })
    return t(`payroll.ruleTypes.${rule.type}`)
  }
}

/** Edit the components of a structure (or one person's overrides). */
export function ComponentRows({ value, onChange, allowNone = false }) {
  const { t } = useTranslation('payroll')
  const used = new Set(value.map((c) => c.code))
  const setRow = (i, patch) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch, rule: { ...c.rule, ...patch.rule } } : c)))
  return (
    <div className="space-y-2">
      {value.map((c, i) => {
        const def = PAY_COMPONENT_BY[c.code]
        const types = [...(def?.rules ?? []), ...(allowNone ? ['NONE'] : [])]
        return (
          <div key={c.code} className="grid grid-cols-[1.4fr_1.2fr_1fr_auto] gap-2 items-center">
            <p className="text-sm text-ink truncate">{t(`payroll.components.${c.code}`)}<span className="text-[11px] text-ink-faint"> · {t(`payroll.kinds.${def?.kind}`)}</span></p>
            <Select value={c.rule.type} onChange={(e) => setRow(i, { rule: { type: e.target.value } })} aria-label={t('payroll.structures.rule')}>
              {types.map((r) => <option key={r} value={r}>{t(`payroll.ruleTypes.${r}`)}</option>)}
            </Select>
            {c.rule.type === 'PCT' ? (
              <div className="flex gap-1">
                <Input type="number" min="0" max="100" step="0.01" value={c.rule.pct ?? ''} onChange={(e) => setRow(i, { rule: { pct: Number(e.target.value) } })} aria-label="%" />
                <Select value={c.rule.of ?? 'BASIC'} onChange={(e) => setRow(i, { rule: { of: e.target.value } })} aria-label={t('payroll.structures.of')}>
                  {PCT_BASES.filter((b) => !(c.code === 'BASIC' && b.value === 'BASIC')).map((b) => <option key={b.value} value={b.value}>{t(`payroll.pctBases.${b.value}`)}</option>)}
                </Select>
              </div>
            ) : c.rule.type === 'FIXED' ? (
              <Input type="number" min="0" value={c.rule.amount != null ? toRupees(c.rule.amount) : ''} onChange={(e) => setRow(i, { rule: { amount: toPaise(e.target.value) } })} aria-label={t('payroll.structures.amount')} />
            ) : <span />}
            <Button size="sm" variant="ghost" icon={X} disabled={c.code === 'BASIC' && !allowNone} aria-label={t('payroll.remove')} onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </div>
        )
      })}
      <Select value="" onChange={(e) => { const d = PAY_COMPONENT_BY[e.target.value]; if (d) onChange([...value, { code: d.code, rule: { type: d.rules[0], ...(d.rules[0] === 'PCT' && { pct: 10, of: 'BASIC' }), ...(d.rules[0] === 'FIXED' && { amount: 0 }) } }]) }} aria-label={t('payroll.structures.add')}>
        <option value="">{t('payroll.structures.add')}</option>
        {PAY_COMPONENTS.filter((c) => !used.has(c.code)).map((c) => <option key={c.code} value={c.code}>{t(`payroll.components.${c.code}`)}</option>)}
      </Select>
    </div>
  )
}

export function StructureModal({ structure, onClose, onSaved }) {
  const { t } = useTranslation('payroll')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ code: structure?.code ?? '', name: structure?.name ?? '', description: structure?.description ?? '', categories: structure?.categories ?? [], active: structure?.active ?? true })
  const [components, setComponents] = useState(structure?.components ?? [{ code: 'BASIC', rule: { type: 'PCT', of: 'GROSS', pct: 50 } }, { code: 'SPECIAL', rule: { type: 'BALANCE' } }, { code: 'PF', rule: { type: 'STATUTORY' } }, { code: 'PT', rule: { type: 'STATUTORY' } }])
  const problem = structureProblem(components)
  const save = useMutation({
    mutationFn: () => (structure ? updateStructure(structure.id, { ...form, components }) : createStructure({ ...form, components })),
    onSuccess: onSaved, onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} size="xl" title={structure ? t('payroll.structures.editTitle') : t('payroll.structures.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!!problem || form.name.trim().length < 2 || (!structure && !/^[A-Z0-9_-]{2,12}$/.test(form.code))} onClick={() => save.mutate()}>{t('payroll.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label={t('payroll.structures.code')} required><Input value={form.code} disabled={!!structure} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} /></FormField>
          <div className="sm:col-span-2"><FormField label={t('payroll.structures.name')} required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></FormField></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {EMPLOYEE_CATEGORIES.map((c) => (
            <label key={c.value} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs">
              <input type="checkbox" checked={form.categories.includes(c.value)} onChange={() => setForm((f) => ({ ...f, categories: f.categories.includes(c.value) ? f.categories.filter((x) => x !== c.value) : [...f.categories, c.value] }))} className="rounded border-border text-brand-500" />
              {t(`payroll.categories.${c.value}`)}
            </label>
          ))}
        </div>
        <ComponentRows value={components} onChange={setComponents} />
        {problem && <Note tone="warning">{problem}</Note>}
        <p className="text-xs text-ink-faint">{t('payroll.structures.hint')}</p>
        {structure && (
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} className="rounded border-border text-brand-500" />{t('payroll.structures.active')}
          </label>
        )}
        <FormField label={t('payroll.structures.description')}><Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></FormField>
      </div>
    </Modal>
  )
}

function Lines({ title, lines, total, tone }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">{title}</p>
      {lines.map((l, i) => (
        <div key={`${l.code}${i}`} className="flex justify-between gap-3 py-1 border-b border-border/60 text-sm">
          <span className="min-w-0">{l.label}{l.basis && <span className="block text-[11px] text-ink-faint">{l.basis}</span>}</span>
          <Money value={l.amount} paise />
        </div>
      ))}
      <div className="flex justify-between gap-3 pt-1.5 text-sm font-semibold"><span>{total.label}</span><Money value={total.value} paise tone={tone} /></div>
    </div>
  )
}

/** One payslip: lines, attendance, LOP correction and manual lines (before approval), print. */
export function PayslipDrawer({ id, onClose, onChanged }) {
  const { t } = useTranslation('payroll')
  const qc = useQueryClient()
  const monthLabel = useMonthLabel()
  const { showSuccess, showError } = useSnackbar()
  const { data: p } = useQuery({ queryKey: ['payslip', id], queryFn: () => fetchPayslip(id) })
  const [lop, setLop] = useState({ days: '', reason: '' })
  const [line, setLine] = useState({ code: 'OTHER_EARNING', label: '', amount: '', note: '' })
  const done = (msg) => () => { qc.invalidateQueries({ queryKey: ['payslip', id] }); onChanged?.(); showSuccess(msg) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => done(v.done)(), onError: (e) => showError(e.message) })
  if (!p) return <Drawer open onClose={onClose} title={t('payroll.loading')}><span /></Drawer>
  const editable = ['DRAFT', 'CALCULATED'].includes(p.status)
  const a = p.attendance ?? {}
  return (
    <Drawer open onClose={onClose} size="lg" title={p.employee?.name} subtitle={`${monthLabel(p.month)} · ${p.payslipNo}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusPill status={p.status} />
          <span className="text-xs text-ink-muted">{[p.employee?.designation, p.structureName].filter(Boolean).join(' · ')}</span>
          <Button size="sm" variant="ghost" icon={Printer} className="ml-auto" onClick={() => printDocument('PAYSLIP', p.id)}>{t('payroll.printSlip')}</Button>
        </div>
        {p.warnings?.length > 0 && <Note tone="warning">{p.warnings.map((w) => <p key={w} className="text-sm">{w}</p>)}</Note>}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
          {[['payDays', `${a.payDays}/${a.baseDays}`], ['lop', a.lop], ['present', a.present], ['leave', a.leave], ['absent', a.absent], ['unmarked', a.unmarked]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-bg p-2"><p className="text-[11px] text-ink-muted">{t(`payroll.att.${k}`)}</p><p className="text-sm font-semibold font-mono-num">{v ?? 0}</p></div>
          ))}
        </div>
        {p.lopOverride?.days != null && <p className="text-xs text-ink-muted">{t('payroll.slip.lopEdited', { days: p.lopOverride.days, auto: a.lopAuto, reason: p.lopOverride.reason, by: p.lopOverride.by })}</p>}
        <div className="grid sm:grid-cols-2 gap-5">
          <Lines title={t('payroll.slip.earnings')} lines={p.earnings ?? []} total={{ label: t('payroll.slip.gross'), value: p.gross }} />
          <Lines title={t('payroll.slip.deductions')} lines={p.deductions ?? []} total={{ label: t('payroll.slip.totalDeductions'), value: p.totalDeductions }} />
        </div>
        <div className="flex justify-between items-baseline rounded-xl bg-brand-50/50 px-4 py-3"><span className="font-medium text-ink">{t('payroll.slip.net')}</span><span className="text-xl font-semibold"><Money value={p.net} paise /></span></div>
        {(p.employer ?? []).length > 0 && <Lines title={t('payroll.slip.employer')} lines={p.employer} total={{ label: t('payroll.slip.employerCost'), value: p.employerCost }} />}
        {p.fnf && <Note>{t('payroll.slip.fnf', { date: p.fnf.lastWorkingDate, years: p.fnf.serviceYears, leave: p.fnf.leaveDays })}{p.fnf.note ? ` ${p.fnf.note}` : ''}</Note>}

        {editable && hasPermission('payroll.payslips.edit_lop') && (
          <Panel title={t('payroll.slip.lopTitle')} subtitle={t('payroll.slip.lopHint', { auto: a.lopAuto ?? 0 })}>
            <div className="grid sm:grid-cols-[100px_1fr_auto] gap-2 items-end">
              <FormField label={t('payroll.att.lop')}><Input type="number" min="0" step="0.5" value={lop.days} onChange={(e) => setLop((x) => ({ ...x, days: e.target.value }))} /></FormField>
              <FormField label={t('payroll.slip.why')}><Input value={lop.reason} onChange={(e) => setLop((x) => ({ ...x, reason: e.target.value }))} /></FormField>
              <div className="flex gap-1">
                <Button size="sm" disabled={lop.days === '' || lop.reason.trim().length < 3} onClick={() => act.mutate({ fn: () => editPayslipLop(p.id, { days: Number(lop.days), reason: lop.reason }), done: t('payroll.slip.lopSaved') })}>{t('payroll.save')}</Button>
                {p.lopOverride?.days != null && <Button size="sm" variant="ghost" disabled={lop.reason.trim().length < 3} onClick={() => act.mutate({ fn: () => editPayslipLop(p.id, { days: null, reason: lop.reason }), done: t('payroll.slip.lopReset') })}>{t('payroll.slip.lopBack')}</Button>}
              </div>
            </div>
          </Panel>
        )}

        {editable && hasPermission('payroll.runs.calculate') && (
          <Panel title={t('payroll.slip.linesTitle')} subtitle={t('payroll.slip.linesHint')}>
            {(p.adjustments ?? []).map((x, i) => (
              <div key={`${x.code}${i}`} className="flex items-center justify-between gap-2 py-1 text-sm border-b border-border/60">
                <span>{x.label || t(`payroll.adjustments.${x.code}`)} <span className="text-xs text-ink-faint">· {x.note}</span></span>
                <span className="flex items-center gap-1"><Money value={x.amount} paise /><Button size="sm" variant="ghost" icon={Trash2} aria-label={t('payroll.remove')} onClick={() => act.mutate({ fn: () => removePayslipLine(p.id, i), done: t('payroll.slip.lineRemoved') })} /></span>
              </div>
            ))}
            <div className="grid sm:grid-cols-2 gap-2 mt-2">
              <Select value={line.code} onChange={(e) => setLine((x) => ({ ...x, code: e.target.value }))} aria-label={t('payroll.slip.lineKind')}>
                {PAY_ADJUSTMENT_CODES.map((c) => <option key={c.value} value={c.value}>{t(`payroll.adjustments.${c.value}`)}</option>)}
              </Select>
              <Input value={line.label} onChange={(e) => setLine((x) => ({ ...x, label: e.target.value }))} placeholder={t('payroll.slip.lineLabel')} />
              <Input type="number" min="0" value={line.amount} onChange={(e) => setLine((x) => ({ ...x, amount: e.target.value }))} placeholder={t('payroll.slip.lineAmount')} />
              <Input value={line.note} onChange={(e) => setLine((x) => ({ ...x, note: e.target.value }))} placeholder={t('payroll.slip.lineNote')} />
            </div>
            <Button size="sm" icon={Plus} className="mt-2" disabled={!(Number(line.amount) > 0) || line.note.trim().length < 3}
              onClick={() => act.mutate({ fn: () => addPayslipLine(p.id, { ...line, amount: toPaise(line.amount) }), done: t('payroll.slip.lineAdded') })}>{t('payroll.slip.addLine')}</Button>
          </Panel>
        )}
      </div>
    </Drawer>
  )
}
