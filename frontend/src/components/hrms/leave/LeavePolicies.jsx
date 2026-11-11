import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { EMPLOYEE_CATEGORIES, GENDERS, LEAVE_ACCRUALS, STARTER_LEAVE_TYPES } from '@schoolgiant/shared'
import { DataTable, FormField, Input, Modal, Select, StatusPill, Textarea, useConfirm } from '../../system'
import Button from '../../ui/Button'
import { Switch } from '../../app/Controls'
import { createLeaveType, deleteLeaveType, updateLeaveType } from '../../../api/hrms'
import { hasPermission } from '../../../api/auth'
import { useSnackbar } from '../../../context/SnackbarContext'
import { useHrLabels } from '../HrKit'
import { fieldErrors, halves, invalidateLeave, useDaysText } from './LeaveBits'

// Leave › Setup › Leave policies: one policy per kind of leave — how its days are given (at the start of the year,
// month by month, after probation, or not at all), a different number for some staff, the rules for asking, how days
// are counted, what happens at the year end, pay, and who it is for. Every setting says in a line what it does.

export function SwitchRow({ checked, onChange, label, hint, disabled }) {
  return (
    <div className="flex items-start gap-3">
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <div className="min-w-0 -mt-0.5"><p className="text-sm text-ink">{label}</p>{hint && <p className="text-[11px] text-ink-faint">{hint}</p>}</div>
    </div>
  )
}

export function Section({ title, hint, children }) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

export function Checks({ options, value, onChange }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map((o) => (
        <label key={o.value} className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
          {o.label}
        </label>
      ))}
    </div>
  )
}

const blank = {
  code: '', name: '', description: '', paid: true, accrual: 'ANNUAL_UPFRONT', perYear: '12', carryForwardMax: '0', keepAll: false, allowHalfDay: true, sandwich: false,
  allowNegative: false, maxPerRequest: '', noticeDays: '', genders: [], categories: [], categoryQuota: [], pauseInVacation: false, blackoutExempt: false, compOff: false, order: '', active: true,
}

/** "Someone here all year has 12; someone joining today gets 5." — what the credit setting means today. */
function CreditExample({ f, leaveYear }) {
  const { t } = useTranslation('hrmsLeave')
  const days = useDaysText()
  const quota = Number(f.perYear) || 0
  if (f.accrual === 'NONE' || !quota || !leaveYear) return null
  const m = Number(leaveYear.today.slice(5, 7))
  const done = ((m - leaveYear.startMonth + 12) % 12) + 1
  const toHalf = (n) => Math.round(n * 2) / 2
  const text = {
    ANNUAL_UPFRONT: t('hrmsLeave.policies.example.upfront', { quota: days(quota), rest: days(toHalf((quota * (13 - done)) / 12)) }),
    MONTHLY: t('hrmsLeave.policies.example.monthly', { perMonth: halves(Math.round((quota / 12) * 100) / 100), earned: days(Math.floor(((quota * done) / 12) * 2) / 2), months: done }),
    ON_CONFIRMATION: t('hrmsLeave.policies.example.confirmation', { quota: days(quota) }),
  }[f.accrual]
  return text ? <p className="text-xs rounded-md bg-brand-50/60 border border-brand-500/20 px-3 py-2 text-ink">{text}</p> : null
}

export function LeaveTypeModal({ type, leaveYear, onClose, onDone, onDeleted }) {
  const { t } = useTranslation('hrmsLeave')
  const L = useHrLabels()
  const { showError } = useSnackbar()
  const confirm = useConfirm()
  // a standard kind of leave comes back on its own, so only one made here can be deleted (the server also checks it is unused)
  const canDelete = !!type && !!onDeleted && hasPermission('hrms.leave.delete') && !STARTER_LEAVE_TYPES.some((x) => x.code === type.code)
  const remove = useMutation({ mutationFn: () => deleteLeaveType(type.id), onSuccess: () => onDeleted(type), onError: (e) => showError(e.message) })
  const [f, setF] = useState(() => (type ? {
    ...blank, ...type, description: type.description ?? '',
    perYear: String(type.perYear ?? 0), keepAll: type.carryForwardMax === null, carryForwardMax: type.carryForwardMax == null ? '0' : String(type.carryForwardMax),
    maxPerRequest: type.maxPerRequest == null ? '' : String(type.maxPerRequest), noticeDays: type.noticeDays == null ? '' : String(type.noticeDays),
    order: type.order == null ? '' : String(type.order), genders: type.genders ?? [], categories: type.categories ?? [],
    categoryQuota: (type.categoryQuota ?? []).map((q) => ({ category: q.category, perYear: String(q.perYear) })),
  } : blank))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
  const flag = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const setQuota = (i, patch) => setF((x) => ({ ...x, categoryQuota: x.categoryQuota.map((q, j) => (j === i ? { ...q, ...patch } : q)) }))
  const credited = f.accrual !== 'NONE'
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(), description: f.description.trim() || undefined, paid: f.paid, accrual: f.accrual, perYear: credited ? Number(f.perYear || 0) : 0,
        categoryQuota: credited ? f.categoryQuota.filter((q) => q.category).map((q) => ({ category: q.category, perYear: Number(q.perYear || 0) })) : [],
        carryForwardMax: f.keepAll ? null : Number(f.carryForwardMax || 0), allowHalfDay: f.allowHalfDay, sandwich: f.sandwich, allowNegative: f.allowNegative,
        maxPerRequest: f.maxPerRequest === '' ? null : Number(f.maxPerRequest), noticeDays: f.noticeDays === '' ? null : Number(f.noticeDays),
        genders: f.genders, categories: f.categories, pauseInVacation: credited && f.accrual === 'MONTHLY' && f.pauseInVacation, blackoutExempt: f.blackoutExempt, compOff: f.compOff,
        order: f.order === '' ? 0 : Number(f.order), active: f.active, tone: type?.tone ?? 'neutral',
      }
      return type ? updateLeaveType(type.id, body) : createLeaveType({ ...body, code: f.code.trim().toUpperCase() })
    },
    onSuccess: onDone,
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  const ok = (type || /^[A-Za-z0-9]{1,8}$/.test(f.code.trim())) && f.name.trim().length >= 2
  const usedCats = new Set(f.categoryQuota.map((q) => q.category))
  return (
    <Modal open onClose={onClose} size="lg" title={type ? t('hrmsLeave.policies.editTitle', { name: type.name }) : t('hrmsLeave.policies.newTitle')}
      footer={<>
        {canDelete && <Button variant="ghost" icon={Trash2} className="me-auto text-danger-600" loading={remove.isPending}
          onClick={async () => { if (await confirm({ title: t('hrmsLeave.policies.deleteTitle', { name: type.name }), message: t('hrmsLeave.policies.deleteHint'), tone: 'danger', confirmLabel: t('actions.delete') })) remove.mutate() }}>{t('actions.delete')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>{t('actions.save')}</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_11rem] gap-3">
          <FormField label={t('hrmsLeave.policies.name')} required error={errors.name}><Input value={f.name} onChange={set('name')} maxLength={60} placeholder={t('hrmsLeave.policies.namePlaceholder')} autoFocus={!type} /></FormField>
          <FormField label={t('hrmsLeave.policies.code')} required={!type} hint={type ? t('hrmsLeave.policies.codeFixed') : t('hrmsLeave.policies.codeHint')} error={errors.code}>
            {type ? <div className="h-9 flex items-center text-sm font-mono-num text-ink-muted">{type.code}</div> : <Input value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.toUpperCase() }))} maxLength={8} className="font-mono-num uppercase" />}
          </FormField>
        </div>
        <FormField label={t('hrmsLeave.policies.description')} hint={t('hrmsLeave.policies.descriptionHint')} error={errors.description}><Textarea rows={2} value={f.description} onChange={set('description')} maxLength={200} /></FormField>

        <Section title={t('hrmsLeave.policies.credit.title')} hint={t('hrmsLeave.policies.credit.hint')}>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-3">
            <FormField label={t('hrmsLeave.policies.credit.how')} error={errors.accrual}>
              <Select value={f.accrual} onChange={set('accrual')}>{LEAVE_ACCRUALS.map((a) => <option key={a.value} value={a.value}>{t(`hrmsLeave.accruals.${a.value}`)}</option>)}</Select>
            </FormField>
            <FormField label={t('hrmsLeave.policies.credit.perYear')} error={errors.perYear}><Input type="number" min="0" max="365" step="0.5" value={f.perYear} onChange={set('perYear')} disabled={!credited} /></FormField>
          </div>
          <p className="text-[11px] text-ink-faint">{t(`hrmsLeave.accrualHints.${f.accrual}`)}</p>
          <CreditExample f={f} leaveYear={leaveYear} />
          {credited && (
            <div className="space-y-2">
              <p className="text-sm text-ink">{t('hrmsLeave.policies.credit.different')}</p>
              <p className="text-[11px] text-ink-faint -mt-1.5">{t('hrmsLeave.policies.credit.differentHint')}</p>
              {f.categoryQuota.map((q, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Select value={q.category} onChange={(e) => setQuota(i, { category: e.target.value })} aria-label={t('hrmsLeave.policies.credit.staff')}>
                      <option value="">{t('hrmsLeave.policies.credit.pickStaff')}</option>
                      {EMPLOYEE_CATEGORIES.filter((c) => c.value === q.category || !usedCats.has(c.value)).map((c) => <option key={c.value} value={c.value}>{L.category(c.value)}</option>)}
                    </Select>
                  </div>
                  <div className="w-24"><Input type="number" min="0" max="365" step="0.5" value={q.perYear} onChange={(e) => setQuota(i, { perYear: e.target.value })} aria-label={t('hrmsLeave.policies.credit.perYear')} /></div>
                  <span className="text-xs text-ink-muted">{t('hrmsLeave.policies.credit.aYear')}</span>
                  <button type="button" onClick={() => setF((x) => ({ ...x, categoryQuota: x.categoryQuota.filter((_, j) => j !== i) }))} className="p-1.5 text-ink-faint hover:text-danger-600" aria-label={t('actions.remove')}><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              {f.categoryQuota.length < EMPLOYEE_CATEGORIES.length && (
                <Button size="sm" variant="ghost" icon={Plus} onClick={() => setF((x) => ({ ...x, categoryQuota: [...x.categoryQuota, { category: '', perYear: '0' }] }))}>{t('hrmsLeave.policies.credit.addDifferent')}</Button>
              )}
            </div>
          )}
          {f.accrual === 'MONTHLY' && <SwitchRow checked={f.pauseInVacation} onChange={flag('pauseInVacation')} label={t('hrmsLeave.policies.credit.pause')} hint={t('hrmsLeave.policies.credit.pauseHint')} />}
        </Section>

        <Section title={t('hrmsLeave.policies.asking.title')} hint={t('hrmsLeave.policies.asking.hint')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label={t('hrmsLeave.policies.asking.max')} hint={t('hrmsLeave.policies.asking.maxHint')} error={errors.maxPerRequest}><Input type="number" min="1" max="365" value={f.maxPerRequest} onChange={set('maxPerRequest')} /></FormField>
            <FormField label={t('hrmsLeave.policies.asking.notice')} hint={t('hrmsLeave.policies.asking.noticeHint')} error={errors.noticeDays}><Input type="number" min="1" max="90" value={f.noticeDays} onChange={set('noticeDays')} /></FormField>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <SwitchRow checked={f.allowHalfDay} onChange={flag('allowHalfDay')} label={t('hrmsLeave.policies.asking.half')} hint={t('hrmsLeave.policies.asking.halfHint')} />
            <SwitchRow checked={f.allowNegative} onChange={flag('allowNegative')} label={t('hrmsLeave.policies.asking.noBalance')} hint={t('hrmsLeave.policies.asking.noBalanceHint')} />
            <SwitchRow checked={!f.blackoutExempt} onChange={(v) => setF((x) => ({ ...x, blackoutExempt: !v }))} label={t('hrmsLeave.policies.asking.noLeave')} hint={t('hrmsLeave.policies.asking.noLeaveHint')} />
          </div>
        </Section>

        <Section title={t('hrmsLeave.policies.counting.title')}>
          <SwitchRow checked={f.sandwich} onChange={flag('sandwich')} label={t('hrmsLeave.policies.counting.sandwich')} hint={t('hrmsLeave.policies.counting.sandwichHint')} />
        </Section>

        <Section title={t('hrmsLeave.policies.yearEnd.title')} hint={t('hrmsLeave.policies.yearEnd.hint')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <SwitchRow checked={f.keepAll} onChange={flag('keepAll')} label={t('hrmsLeave.policies.yearEnd.keepAll')} hint={t('hrmsLeave.policies.yearEnd.keepAllHint')} />
            {!f.keepAll && <FormField label={t('hrmsLeave.policies.yearEnd.carry')} hint={t('hrmsLeave.policies.yearEnd.carryHint')} error={errors.carryForwardMax}><Input type="number" min="0" max="365" value={f.carryForwardMax} onChange={set('carryForwardMax')} /></FormField>}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <SwitchRow checked={f.paid} onChange={flag('paid')} label={t('hrmsLeave.policies.yearEnd.paid')} hint={t('hrmsLeave.policies.yearEnd.paidHint')} />
            <SwitchRow checked={f.compOff} onChange={flag('compOff')} label={t('hrmsLeave.policies.yearEnd.compOff')} hint={t('hrmsLeave.policies.yearEnd.compOffHint')} />
          </div>
        </Section>

        <Section title={t('hrmsLeave.policies.who.title')} hint={t('hrmsLeave.policies.who.hint')}>
          <FormField label={t('hrmsLeave.policies.who.genders')}><Checks options={GENDERS.map((g) => ({ value: g.value, label: t(`hrmsLeave.genders.${g.value}`, { defaultValue: g.label }) }))} value={f.genders} onChange={flag('genders')} /></FormField>
          <FormField label={t('hrmsLeave.policies.who.staff')}><Checks options={EMPLOYEE_CATEGORIES.map((c) => ({ value: c.value, label: L.category(c.value) }))} value={f.categories} onChange={flag('categories')} /></FormField>
        </Section>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem] gap-3 items-start">
          <SwitchRow checked={f.active} onChange={flag('active')} label={t('hrmsLeave.policies.inUse')} hint={t('hrmsLeave.policies.inUseHint')} />
          <FormField label={t('hrmsLeave.policies.order')} hint={t('hrmsLeave.policies.orderHint')}><Input type="number" min="0" max="99" value={f.order} onChange={set('order')} /></FormField>
        </div>
      </div>
    </Modal>
  )
}

/** How a policy's days are given, in a phrase. */
export function useCreditText() {
  const { t } = useTranslation('hrmsLeave')
  const days = useDaysText()
  return (lt) => {
    if (lt.accrual === 'NONE') return lt.allowNegative ? t('hrmsLeave.policies.list.noBalance') : t('hrmsLeave.policies.list.givenByHr')
    const base = { ANNUAL_UPFRONT: 'upfront', MONTHLY: 'monthly', ON_CONFIRMATION: 'confirmation' }[lt.accrual]
    return t(`hrmsLeave.policies.list.${base}`, { days: days(lt.perYear) })
  }
}

export default function LeavePolicies({ types, loading, leaveYear }) {
  const { t } = useTranslation('hrmsLeave')
  const L = useHrLabels()
  const qc = useQueryClient()
  const days = useDaysText()
  const credit = useCreditText()
  const { showSuccess } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const canEdit = hasPermission('hrms.leave.edit')
  const who = (lt) => {
    const cats = lt.categories ?? []
    const missing = EMPLOYEE_CATEGORIES.filter((c) => !cats.includes(c.value))
    // "All staff except teaching" reads better than a list of five
    const staff = !cats.length ? null : cats.length > 2 && missing.length <= 2 ? t('hrmsLeave.policies.list.except', { staff: missing.map((c) => L.category(c.value)).join(', ') }) : cats.map(L.category).join(', ')
    const parts = [...(lt.genders ?? []).map((g) => t(`hrmsLeave.genders.${g}`, { defaultValue: g })), staff].filter(Boolean)
    return parts.length ? parts.join(' · ') : t('hrmsLeave.policies.list.everyone')
  }
  const sentence = (list) => { const x = list.filter(Boolean).join(' · '); return x ? x.charAt(0).toUpperCase() + x.slice(1) : '' }
  const columns = [
    { key: 'name', header: t('hrmsLeave.policies.col.leave'), mobilePrimary: true, render: (v, lt) => (
      <div className="min-w-0 max-w-[280px]">
        <p className={lt.active ? 'font-medium text-ink' : 'font-medium text-ink-faint'}>{v}{lt.paid === false && <span className="ms-1.5 text-[11px] font-normal text-ink-muted">{t('hrmsLeave.bits.unpaid')}</span>}{!lt.active && <StatusPill tone="neutral" className="ms-2">{t('hrmsLeave.policies.retired')}</StatusPill>}</p>
        {lt.description && <p className="text-[11px] text-ink-faint line-clamp-2">{lt.description}</p>}
      </div>
    ) },
    { key: 'accrual', header: t('hrmsLeave.policies.col.credit'), render: (_, lt) => (
      <div className="text-xs">
        <p className="text-ink">{credit(lt)}</p>
        {(lt.categoryQuota ?? []).map((q) => <p key={q.category} className="text-ink-muted">{t('hrmsLeave.policies.list.forCategory', { staff: L.category(q.category), days: days(q.perYear) })}</p>)}
        {lt.pauseInVacation && <p className="text-ink-muted">{t('hrmsLeave.policies.list.pauses')}</p>}
      </div>
    ) },
    { key: 'maxPerRequest', header: t('hrmsLeave.policies.col.rules'), mobileHidden: true, render: (v, lt) => (
      <span className="text-xs text-ink">{sentence([
        v ? t('hrmsLeave.policies.list.max', { days: days(v) }) : null,
        lt.noticeDays ? t('hrmsLeave.policies.list.notice', { days: days(lt.noticeDays) }) : null,
        lt.allowHalfDay ? t('hrmsLeave.policies.list.half') : t('hrmsLeave.policies.list.whole'),
        lt.sandwich ? t('hrmsLeave.policies.list.sandwich') : null,
        lt.blackoutExempt ? t('hrmsLeave.policies.list.anyDay') : null,
      ])}</span>
    ) },
    { key: 'carryForwardMax', header: t('hrmsLeave.policies.col.yearEnd'), mobileHidden: true, render: (v, lt) => (
      <span className="text-xs text-ink">{lt.accrual === 'NONE' ? '—' : v === null ? t('hrmsLeave.policies.list.keepAll') : v === 0 ? t('hrmsLeave.policies.list.lapses') : t('hrmsLeave.policies.list.carry', { days: days(v) })}</span>
    ) },
    { key: 'genders', header: t('hrmsLeave.policies.col.who'), mobileHidden: true, render: (_, lt) => <span className="text-xs text-ink-muted">{who(lt)}</span> },
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-ink-muted max-w-3xl">{t('hrmsLeave.policies.intro')}</p>
        {canEdit && <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>{t('hrmsLeave.policies.new')}</Button>}
      </div>
      <DataTable columns={columns} rows={types} loading={loading} onRowClick={canEdit ? setEditing : undefined}
        emptyIcon={ShieldCheck} emptyTitle={t('hrmsLeave.policies.empty')} />
      {editing && (
        <LeaveTypeModal type={editing === 'new' ? null : editing} leaveYear={leaveYear} onClose={() => setEditing(null)}
          onDone={(lt) => { setEditing(null); showSuccess(t('hrmsLeave.policies.saved', { name: lt?.name })); invalidateLeave(qc) }}
          onDeleted={(lt) => { setEditing(null); showSuccess(t('hrmsLeave.policies.deleted', { name: lt?.name })); invalidateLeave(qc) }} />
      )}
    </div>
  )
}
