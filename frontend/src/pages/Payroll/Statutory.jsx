import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, Plus, Scale, X } from 'lucide-react'
import { INDIAN_STATES, PAY_DAY_BASES, toPaise, toRupees } from '@schoolgiant/shared'
import { FormField, Input, Note, PageContainer, PageHeader, Panel, Select } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchStatutory, saveStatutory } from '../../api/payroll'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const rs = (p) => (p == null ? '' : String(toRupees(p)))

/** A number field bound to one value of a section (rupees shown, paise stored when `money`). */
function Num({ label, value, onChange, money = false, step = 'any', disabled, hint }) {
  return <FormField label={label} hint={hint}><Input type="number" step={step} min="0" disabled={disabled} value={money ? rs(value) : value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : money ? toPaise(e.target.value) : Number(e.target.value))} /></FormField>
}

/** Slabs: "from ₹X a month, ₹Y" rows (professional tax). */
function Slabs({ slabs, onChange, disabled }) {
  const { t } = useTranslation('payroll')
  return (
    <div className="space-y-1.5">
      {slabs.map((s, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
          <Input type="number" min="0" disabled={disabled} value={rs(s.from)} onChange={(e) => onChange(slabs.map((x, j) => (j === i ? { ...x, from: toPaise(e.target.value) } : x)))} aria-label={t('payroll.stat.slabFrom')} placeholder={t('payroll.stat.slabFrom')} />
          <Input type="number" min="0" disabled={disabled} value={rs(s.amount)} onChange={(e) => onChange(slabs.map((x, j) => (j === i ? { ...x, amount: toPaise(e.target.value) } : x)))} aria-label={t('payroll.stat.slabAmount')} placeholder={t('payroll.stat.slabAmount')} />
          <Input type="number" min="0" disabled={disabled} value={rs(s.febAmount)} onChange={(e) => onChange(slabs.map((x, j) => (j === i ? { ...x, febAmount: e.target.value === '' ? null : toPaise(e.target.value) } : x)))} aria-label={t('payroll.stat.slabFeb')} placeholder={t('payroll.stat.slabFeb')} />
          <Button size="sm" variant="ghost" icon={X} disabled={disabled} aria-label={t('payroll.remove')} onClick={() => onChange(slabs.filter((_, j) => j !== i))} />
        </div>
      ))}
      {!disabled && <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange([...slabs, { from: 0, amount: 0 }])}>{t('payroll.stat.addSlab')}</Button>}
    </div>
  )
}

/** Payroll › Statutory rules: PF, ESI, professional tax, LWF, income tax, gratuity — the shipped defaults until checked. */
export default function Statutory() {
  const { t } = useTranslation('payroll')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data, isLoading } = useQuery({ queryKey: ['payroll-statutory'], queryFn: fetchStatutory })
  const [s, setS] = useState(null)
  useEffect(() => { if (data) setS(structuredClone(data)) }, [data])
  const canEdit = hasPermission('payroll.statutory.edit')
  const save = useMutation({
    mutationFn: (extra = {}) => saveStatutory({ pf: s.pf, esi: s.esi, pt: s.pt, lwf: s.lwf, tds: s.tds, gratuity: s.gratuity, encashment: s.encashment, notice: s.notice, payDayBasis: s.payDayBasis, separateDuties: s.separateDuties, ...extra }),
    onSuccess: (r, extra) => { qc.setQueryData(['payroll-statutory'], r); qc.invalidateQueries({ queryKey: ['payroll-meta'] }); showSuccess(extra?.markVerified ? t('payroll.stat.verifiedDone') : t('payroll.saved')) },
    onError: (e) => showError(e.message),
  })
  if (isLoading || !s) return <PageContainer><p className="text-sm text-ink-faint">{t('payroll.loading')}</p></PageContainer>
  const sec = (k) => (patch) => setS((x) => ({ ...x, [k]: { ...x[k], ...patch } }))
  const ptState = s.pt.states.find((x) => x.code === s.pt.defaultState)
  const setPtState = (code, patch) => setS((x) => ({ ...x, pt: { ...x.pt, states: x.pt.states.map((st) => (st.code === code ? { ...st, ...patch } : st)) } }))
  const lwfState = s.lwf.states.find((x) => x.code === s.pt.defaultState)
  const dis = !canEdit
  return (
    <PageContainer>
      <PageHeader icon={Scale} title={t('payroll.stat.title')} subtitle={t('payroll.stat.subtitle')}
        actions={canEdit && <Button loading={save.isPending} onClick={() => save.mutate({})}>{t('payroll.save')}</Button>} />
      {s.verified ? <Note tone="success" className="mb-4">{t('payroll.stat.verified', { by: s.verified.by, at: dateTime(s.verified.at) })}</Note>
        : <Note tone="warning" className="mb-4" actions={canEdit && <Button size="sm" icon={BadgeCheck} onClick={() => save.mutate({ markVerified: true })}>{t('payroll.stat.markVerified')}</Button>}>{t('payroll.stat.notVerified')}</Note>}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title={t('payroll.stat.pf')}>
          <div className="grid grid-cols-2 gap-3">
            <Num label={t('payroll.stat.employeePct')} value={s.pf.employeePct} onChange={(v) => sec('pf')({ employeePct: v })} disabled={dis} />
            <Num label={t('payroll.stat.employerPct')} value={s.pf.employerPct} onChange={(v) => sec('pf')({ employerPct: v })} disabled={dis} />
            <Num label={t('payroll.stat.epsPct')} value={s.pf.epsPct} onChange={(v) => sec('pf')({ epsPct: v })} disabled={dis} />
            <Num label={t('payroll.stat.edliPct')} value={s.pf.edliPct} onChange={(v) => sec('pf')({ edliPct: v })} disabled={dis} />
            <Num label={t('payroll.stat.adminPct')} value={s.pf.adminPct} onChange={(v) => sec('pf')({ adminPct: v })} disabled={dis} />
            <Num label={t('payroll.stat.wageCeiling')} value={s.pf.wageCeiling} money onChange={(v) => sec('pf')({ wageCeiling: v })} disabled={dis} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-ink mt-2"><input type="checkbox" disabled={dis} checked={s.pf.restrictToCeiling} onChange={(e) => sec('pf')({ restrictToCeiling: e.target.checked })} className="rounded border-border text-brand-500" />{t('payroll.stat.restrict')}</label>
        </Panel>
        <Panel title={t('payroll.stat.esi')}>
          <div className="grid grid-cols-2 gap-3">
            <Num label={t('payroll.stat.employeePct')} value={s.esi.employeePct} onChange={(v) => sec('esi')({ employeePct: v })} disabled={dis} />
            <Num label={t('payroll.stat.employerPct')} value={s.esi.employerPct} onChange={(v) => sec('esi')({ employerPct: v })} disabled={dis} />
            <Num label={t('payroll.stat.grossCeiling')} value={s.esi.grossCeiling} money onChange={(v) => sec('esi')({ grossCeiling: v })} disabled={dis} hint={t('payroll.stat.grossCeilingHint')} />
          </div>
        </Panel>
        <Panel title={t('payroll.stat.pt')} subtitle={t('payroll.stat.ptHint')}>
          <FormField label={t('payroll.stat.state')}>
            <Select value={s.pt.defaultState} disabled={dis} onChange={(e) => {
              const code = e.target.value
              setS((x) => ({ ...x, pt: { ...x.pt, defaultState: code, states: x.pt.states.some((st) => st.code === code) ? x.pt.states : [...x.pt.states, { code, name: INDIAN_STATES.find((st) => st.code === code)?.name ?? code, period: 'MONTH', slabs: [{ from: 0, amount: 0 }] }] } }))
            }}>
              {INDIAN_STATES.map((st) => <option key={st.code} value={st.code}>{st.name}</option>)}
            </Select>
          </FormField>
          {ptState && <div className="mt-3"><p className="text-xs text-ink-muted mb-1">{t('payroll.stat.slabsHint')}</p><Slabs slabs={ptState.slabs} disabled={dis} onChange={(slabs) => setPtState(ptState.code, { slabs })} /></div>}
          <p className="text-xs text-ink-faint mt-2">{t('payroll.stat.campusState')}</p>
        </Panel>
        <Panel title={t('payroll.stat.lwf')}>
          {lwfState ? (
            <div className="grid grid-cols-2 gap-3">
              <Num label={t('payroll.stat.lwfEmployee')} value={lwfState.employee} money disabled={dis} onChange={(v) => setS((x) => ({ ...x, lwf: { states: x.lwf.states.map((st) => (st.code === lwfState.code ? { ...st, employee: v } : st)) } }))} />
              <Num label={t('payroll.stat.lwfEmployer')} value={lwfState.employer} money disabled={dis} onChange={(v) => setS((x) => ({ ...x, lwf: { states: x.lwf.states.map((st) => (st.code === lwfState.code ? { ...st, employer: v } : st)) } }))} />
              <p className="col-span-2 text-xs text-ink-muted">{t('payroll.stat.lwfMonths', { months: lwfState.months.map((m) => t(`payroll.months.${m}`)).join(', ') })}</p>
            </div>
          ) : <p className="text-sm text-ink-muted">{t('payroll.stat.noLwf')}</p>}
        </Panel>
        <Panel title={t('payroll.stat.tds')} subtitle={t('payroll.stat.tdsHint', { fy: s.tds.financialYear })}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Num label={t('payroll.stat.standardDeduction')} value={s.tds.standardDeduction} money onChange={(v) => sec('tds')({ standardDeduction: v })} disabled={dis} />
            <Num label={t('payroll.stat.rebateUpTo')} value={s.tds.rebateUpTo} money onChange={(v) => sec('tds')({ rebateUpTo: v })} disabled={dis} />
            <Num label={t('payroll.stat.cess')} value={s.tds.cessPct} onChange={(v) => sec('tds')({ cessPct: v })} disabled={dis} />
            <FormField label={t('payroll.stat.fy')}><Input value={s.tds.financialYear} disabled={dis} onChange={(e) => sec('tds')({ financialYear: e.target.value })} /></FormField>
          </div>
          <p className="text-xs text-ink-muted mb-1">{t('payroll.stat.tdsSlabs')}</p>
          {s.tds.slabs.map((sl, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px] gap-2 mb-1.5">
              <Input type="number" min="0" disabled={dis || sl.upTo === null} value={sl.upTo === null ? '' : rs(sl.upTo)} placeholder={t('payroll.stat.andAbove')} onChange={(e) => sec('tds')({ slabs: s.tds.slabs.map((x, j) => (j === i ? { ...x, upTo: toPaise(e.target.value) } : x)) })} aria-label={t('payroll.stat.upTo')} />
              <Input type="number" min="0" max="100" disabled={dis} value={sl.pct} onChange={(e) => sec('tds')({ slabs: s.tds.slabs.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)) })} aria-label="%" />
            </div>
          ))}
        </Panel>
        <Panel title={t('payroll.stat.exit')}>
          <div className="grid grid-cols-2 gap-3">
            <Num label={t('payroll.stat.gratuityYears')} value={s.gratuity.minYears} onChange={(v) => sec('gratuity')({ minYears: v })} disabled={dis} />
            <Num label={t('payroll.stat.gratuityCap')} value={s.gratuity.cap} money onChange={(v) => sec('gratuity')({ cap: v })} disabled={dis} />
            <FormField label={t('payroll.stat.encashCodes')} hint={t('payroll.stat.encashHint')}><Input value={(s.encashment.leaveCodes ?? []).join(', ')} disabled={dis} onChange={(e) => sec('encashment')({ leaveCodes: e.target.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) })} /></FormField>
            <Num label={t('payroll.stat.noticeDays')} value={s.notice.days} step="1" onChange={(v) => sec('notice')({ days: v })} disabled={dis} />
          </div>
        </Panel>
        <Panel title={t('payroll.stat.general')}>
          <FormField label={t('payroll.stat.payDays')}>
            <Select value={s.payDayBasis} disabled={dis} onChange={(e) => setS((x) => ({ ...x, payDayBasis: e.target.value }))}>{PAY_DAY_BASES.map((b) => <option key={b.value} value={b.value}>{t(`payroll.payDayBases.${b.value}`)}</option>)}</Select>
          </FormField>
          <label className="inline-flex items-center gap-2 text-sm text-ink mt-3"><input type="checkbox" disabled={dis} checked={s.separateDuties} onChange={(e) => setS((x) => ({ ...x, separateDuties: e.target.checked }))} className="rounded border-border text-brand-500" />{t('payroll.stat.sod')}</label>
          <p className="text-xs text-ink-faint mt-1">{t('payroll.stat.sodHint')}</p>
        </Panel>
      </div>
    </PageContainer>
  )
}
