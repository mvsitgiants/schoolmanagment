import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BedDouble, BookMarked, Bus, Droplet, HeartPulse, MapPin, Phone, ShieldAlert, Stethoscope, Syringe, Utensils } from 'lucide-react'
import { ColorChip, ExpiryBadge, Money, SectionCard, StatusPill, Tag } from '../../system'
import Button from '../../ui/Button'
import { hasPermission } from '../../../api/auth'
import { useFormat } from '../../../context/SettingsContext'
import { Figure, Quiet, SectionError, broken, list, useLabels } from './kit'

/** Student 360 › Campus life: the bus, the hostel bed and outpasses, library books, the canteen wallet and health. */
export default function CampusTab({ o }) {
  const cards = [
    o.transport && <Transport key="tr" x={o.transport} />,
    o.hostel && <Hostel key="ho" x={o.hostel} />,
    o.library && <Library key="li" x={o.library} />,
    o.canteen && <Canteen key="ca" x={o.canteen} />,
    o.health && <Health key="he" x={o.health} />,
  ].filter(Boolean)
  return <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">{cards}</div>
}

/** A label / value line inside a card. */
function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-baseline gap-2.5 text-sm">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-ink-faint" aria-hidden />}
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="ms-auto min-w-0 break-words text-end font-medium text-ink">{children ?? <span className="font-normal text-ink-faint">—</span>}</span>
    </div>
  )
}

function Transport({ x }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  return (
    <SectionCard icon={Bus} title={t('students.profile.campus.transport')}
      actions={hasPermission('transport.assignments.view') && <Button size="sm" variant="ghost" className="-my-1" to="/transport/assignments">{t('students.profile.open')}</Button>}>
      {broken(x) ? <SectionError /> : !x.assigned ? <Quiet icon={Bus} title={t('students.profile.campus.noBus')} hint={t('students.profile.campus.noBusHint')} /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ColorChip label={x.route} seed={x.routeId ?? x.route} icon={Bus} />
            <Tag tone="info" size="xs">{L.rideMode(x.mode)}</Tag>
          </div>
          {x.stop && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <TimeBox label={t('students.profile.campus.pickup')} time={x.mode !== 'DROP' ? x.stop.pickupTime : null} />
              <TimeBox label={t('students.profile.campus.drop')} time={x.mode !== 'PICKUP' ? x.stop.dropTime : null} />
            </div>
          )}
          <div className="mt-4 flex flex-col gap-2">
            <Row icon={MapPin} label={t('students.profile.campus.stop')}>{x.stop ? [x.stop.name, x.stop.landmark].filter(Boolean).join(' · ') : null}</Row>
            <Row icon={Bus} label={t('students.profile.campus.vehicle')}>{x.vehicle?.regNo ? <span className="font-mono-num">{x.vehicle.regNo}</span> : null}</Row>
            <Row icon={Phone} label={t('students.profile.campus.driver')}>{x.vehicle?.driver ? <>{x.vehicle.driver}{x.vehicle.driverMobile && <a href={`tel:${x.vehicle.driverMobile}`} className="ms-2 font-mono-num text-brand-700 hover:underline">{x.vehicle.driverMobile}</a>}</> : null}</Row>
          </div>
        </>
      )}
    </SectionCard>
  )
}

function TimeBox({ label, time }) {
  return (
    <div className={clsx('rounded-lg border px-3 py-2', time ? 'border-sky-200 bg-sky-50' : 'border-border bg-bg/50')}>
      <p className="text-[11px] font-medium text-ink-muted">{label}</p>
      <p className={clsx('font-mono-num text-lg font-semibold tabular-nums', time ? 'text-sky-800' : 'text-ink-faint')}>{time ?? '—'}</p>
    </div>
  )
}

function Hostel({ x }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { date } = useFormat()
  const a = x.allotment
  return (
    <SectionCard icon={BedDouble} title={t('students.profile.campus.hostel')}
      actions={hasPermission('hostel.allotment.view') && <Button size="sm" variant="ghost" className="-my-1" to="/hostel/allotment">{t('students.profile.open')}</Button>}>
      {broken(x) ? <SectionError /> : (
        <>
          {!a ? <Quiet icon={BedDouble} title={t('students.profile.campus.noBed')} /> : (
            <>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <Figure value={a.bedCode || a.bed} label={t('students.profile.campus.bed')} />
                <Figure value={a.room} label={t('students.profile.campus.room')} />
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <Row label={t('students.profile.campus.block')}>{a.block}</Row>
                <Row label={t('students.profile.campus.since')}>{a.from ? date(a.from) : null}</Row>
                <Row icon={Phone} label={t('students.profile.campus.warden')}>{a.warden ? <>{a.warden}{a.wardenMobile && <a href={`tel:${a.wardenMobile}`} className="ms-2 font-mono-num text-brand-700 hover:underline">{a.wardenMobile}</a>}</> : null}</Row>
              </div>
            </>
          )}
          {list(x.outpasses).length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('students.profile.campus.outpasses')}</p>
              <ul className="flex flex-col gap-2">
                {x.outpasses.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ink">{date(p.leaveDate)} {p.leaveTime} → {date(p.returnDate)} {p.returnTime}<span className="text-ink-faint"> · {p.reason}</span></span>
                    {p.late && <Tag tone="danger" size="xs">{t('students.profile.campus.late')}</Tag>}
                    <StatusPill tone={L.outpassTone(p.status)}>{L.outpass(p.status)}</StatusPill>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </SectionCard>
  )
}

function Library({ x }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  return (
    <SectionCard icon={BookMarked} title={t('students.profile.campus.library')} hint={t('students.profile.campus.booksRead', { count: x.read ?? 0 })}
      actions={hasPermission('library.circulation.view') && <Button size="sm" variant="ghost" className="-my-1" to="/library/circulation">{t('students.profile.open')}</Button>}>
      {broken(x) ? <SectionError /> : (
        <>
          {x.out.length === 0 ? <Quiet icon={BookMarked} title={t('students.profile.campus.noBooks')} /> : (
            <ul className="flex flex-col gap-2.5">
              {x.out.map((b) => (
                <li key={b.id} className="flex items-center gap-3">
                  <span className={clsx('inline-flex h-9 w-7 shrink-0 items-center justify-center rounded-[3px] border-s-4', b.state === 'OVERDUE' ? 'border-rose-500 bg-rose-50' : 'border-brand-500 bg-brand-50')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{b.title}</span>
                    <span className="block font-mono-num text-[11px] text-ink-faint">{b.accessionNo}</span>
                  </span>
                  <ExpiryBadge value={b.dueOn} warnDays={3} dangerDays={0} />
                </li>
              ))}
            </ul>
          )}
          {x.owed > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
              <span className="text-ink-muted">{t('students.profile.campus.fines')} <span className="text-ink-faint">({x.fines.map((f) => L.fineReason(f.reason, f.reasonLabel)).join(', ')})</span></span>
              <Money value={x.owed} paise tone="danger" />
            </div>
          )}
        </>
      )}
    </SectionCard>
  )
}

function Canteen({ x }) {
  const { t } = useTranslation('students')
  return (
    <SectionCard icon={Utensils} title={t('students.profile.campus.canteen')}
      actions={hasPermission('canteen.wallet.view') && <Button size="sm" variant="ghost" className="-my-1" to="/canteen/wallet">{t('students.profile.open')}</Button>}>
      {broken(x) ? <SectionError /> : (
        <>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <Figure value={<Money value={x.balance} paise tone={x.low ? 'warning' : undefined} />} label={t('students.profile.campus.balance')} />
            <Figure value={<Money value={x.spentToday} paise />} label={t('students.profile.campus.spentToday')} />
            {x.dailyLimit != null && <Figure value={<Money value={x.dailyLimit} paise />} label={t('students.profile.campus.dailyLimit')} />}
          </div>
          {x.dailyLimit != null && x.dailyLimit > 0 && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
              <span className={clsx('block h-full rounded-full', x.spentToday >= x.dailyLimit ? 'bg-rose-500' : 'bg-orange-400')} style={{ width: `${Math.min(100, (x.spentToday / x.dailyLimit) * 100)}%` }} />
            </div>
          )}
          {x.low && <p className="mt-3 text-xs text-amber-700">{t('students.profile.campus.lowBalance')}</p>}
        </>
      )}
    </SectionCard>
  )
}

function Health({ x }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { date } = useFormat()
  return (
    <SectionCard icon={HeartPulse} title={t('students.profile.campus.health')}
      actions={hasPermission('health.records.view') && <Button size="sm" variant="ghost" className="-my-1" to="/health/records">{t('students.profile.open')}</Button>}>
      {broken(x) ? <SectionError /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {x.bloodGroup ? <Tag tone="danger" icon={Droplet}>{x.bloodGroup}</Tag> : <Tag tone="neutral" icon={Droplet}>{t('students.profile.campus.noBloodGroup')}</Tag>}
            <Tag tone="teal" icon={Syringe}>{t('students.profile.campus.vaccinations', { count: x.vaccinations })}</Tag>
            {x.latest?.heightCm && <Tag tone="sky">{t('students.profile.campus.growth', { h: x.latest.heightCm, w: x.latest.weightKg ?? '—' })}</Tag>}
          </div>
          <div className="mt-4">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint"><ShieldAlert className="h-3.5 w-3.5" aria-hidden />{t('students.profile.campus.allergies')}</p>
            {x.allergies.length ? <div className="flex flex-wrap gap-1.5">{x.allergies.map((a) => <Tag key={a} tone="danger" size="xs">{a}</Tag>)}</div> : <p className="text-sm text-ink-faint">{t('students.profile.campus.noAllergies')}</p>}
          </div>
          {x.sensitive && (x.conditions?.length > 0 || x.medications?.length > 0) && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('students.profile.campus.conditions')}</p>
              <div className="flex flex-wrap gap-1.5">{[...(x.conditions ?? []), ...(x.medications ?? [])].map((c) => <Tag key={c} tone="warning" size="xs">{c}</Tag>)}</div>
            </div>
          )}
          {!x.sensitive && x.hasSensitive && <p className="mt-3 text-xs text-ink-faint">{t('students.profile.campus.sensitiveHidden')}</p>}
          {list(x.visits).length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint"><Stethoscope className="h-3.5 w-3.5" aria-hidden />{t('students.profile.campus.visits')}</p>
              <ul className="flex flex-col gap-2">
                {x.visits.map((v) => (
                  <li key={v.id} className="flex items-center gap-2 text-sm">
                    <span className="w-20 shrink-0 text-xs tabular-nums text-ink-faint">{date(v.date)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{v.complaint}{v.tempC ? <span className="text-ink-faint"> · {v.tempC}°C</span> : null}</span>
                    {v.outcome && <ColorChip label={L.visitOutcome(v.outcome)} seed={`outcome-${v.outcome}`} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </SectionCard>
  )
}
