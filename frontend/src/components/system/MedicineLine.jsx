import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Moon, Pill, Sun, Sunrise, Sunset } from 'lucide-react'
import { FREQUENCY_BY_CODE, MED_FREQUENCY_BY, rxPhrases } from '@schoolgiant/shared'
import Tag from './Tag'

const SLOT_ICON = { morning: Sunrise, afternoon: Sun, evening: Sunset, night: Moon }

/**
 * The day's schedule for a medicine, in one calm line:
 *   OPD codes "1-0-1" / "1-1-1-1" → ☀1 ☀0 ☾1 — the slots given are dark, the skipped ones faint;
 *   ward codes with set times (BD) → "BD · 08:00, 20:00";
 *   anything else (SOS, STAT, HS, weekly) → the localized words.
 * Slot names come from the shared prescription phrases, so this adds no locale keys.
 */
export function DosePattern({ frequency, label, className }) {
  const { i18n } = useTranslation()
  const words = rxPhrases(i18n.resolvedLanguage || i18n.language || 'en')
  const code = String(frequency ?? '')

  if (/^[0-9½.]+(-[0-9½.]+){2,3}$/.test(code)) {
    const parts = code.split('-')
    const slots = parts.length === 4 ? ['morning', 'afternoon', 'evening', 'night'] : ['morning', 'afternoon', 'night']
    return (
      <span className={clsx('inline-flex items-center gap-2', className)} role="img" aria-label={slots.map((s, i) => `${words[s]} ${parts[i]}`).join(', ')}>
        {slots.map((s, i) => {
          const Icon = SLOT_ICON[s]
          const on = parts[i] !== '0'
          return (
            <span key={s} title={words[s]} className={clsx('inline-flex items-center gap-0.5', on ? 'text-ink' : 'text-ink-faint opacity-60')}>
              <Icon className={clsx('w-3.5 h-3.5', on ? 'text-ink-muted' : '')} aria-hidden />
              <span className={clsx('tabular-nums', on && 'font-semibold')}>{parts[i]}</span>
            </span>
          )
        })}
      </span>
    )
  }

  const ward = MED_FREQUENCY_BY[code]
  if (ward?.times?.length) {
    return <span className={className} title={label || undefined}><span className="font-semibold text-ink">{code}</span> · <span className="tabular-nums">{ward.times.join(', ')}</span></span>
  }

  const opd = FREQUENCY_BY_CODE[code]
  const text = label || (opd ? opd.slots.map((s) => words[s]).join(' – ') : code)
  if (!text) return null
  return <span className={clsx(code === 'STAT' && 'font-semibold text-danger-600', className)}>{text}</span>
}

/**
 * One medicine, calm and easy to read: the name + strength in bold with the form beside it,
 * the generic underneath, then one line of facts — dose · schedule · duration · food timing —
 * and any instructions below. Neutral throughout; colour only where it means something
 * (a STAT dose, a status pill, a part-dispensed count).
 *
 *   <MedicineLine card index={1} name="Augmentin" strength="625 mg" generic="amoxicillin + clavulanate"
 *     form="Tablet" dose="1 tab" frequency="1-0-1" duration="5 days" timing="after food"
 *     instructions="Complete the course" aside={<Fraction value={10} max={10} />} />
 *
 * `card` draws it as a bordered card (stack them in <MedicineList cards>); otherwise it is a
 * plain row for <MedicineList>. `compact` tightens it for tables and dense histories.
 * `muted` greys out a stopped / cancelled line. `aside` sits at the far end, centred.
 */
export default function MedicineLine({
  name, strength, generic, form, route, dose, frequency, frequencyLabel, duration, timing, instructions,
  index, badges, status, actions, aside, footer, compact = false, card = false, muted = false, className,
}) {
  const facts = [
    dose && <span key="dose" className="font-semibold text-ink">{dose}</span>,
    (frequency || frequencyLabel) && <DosePattern key="freq" frequency={frequency} label={frequencyLabel} />,
    duration && <span key="dur">{duration}</span>,
    timing && <span key="food">{timing}</span>,
  ].filter(Boolean)
  return (
    <div className={clsx('flex items-start gap-3 min-w-0', muted && 'opacity-60',
      card && 'rounded-lg border border-border bg-surface px-3.5 py-3', className)}>
      {index != null && !compact && (
        <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[11px] font-semibold text-ink-muted tabular-nums">{index}</span>
      )}
      {index == null && !compact && (
        <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center text-ink-faint"><Pill className="w-4 h-4" aria-hidden /></span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <p className={clsx('text-ink leading-snug break-words font-semibold', compact ? 'text-[13px]' : 'text-sm', muted && 'line-through decoration-ink-faint')}>
              {compact && index != null && <span className="me-1.5 text-ink-faint font-normal tabular-nums">{index}.</span>}
              {name}
              {strength && <span className="ms-1.5 font-medium text-ink-muted">{strength}</span>}
              {form && <span className="ms-2 align-middle"><Tag size="xs">{form}</Tag></span>}
              {route && <span className="ms-1 align-middle"><Tag size="xs">{route}</Tag></span>}
            </p>
            {generic && <p className="text-xs text-ink-faint leading-snug break-words">{generic}</p>}
          </div>
          {(status || actions) && <div className="flex shrink-0 items-center gap-2">{status}{actions}</div>}
        </div>

        {(facts.length > 0 || badges) && (
          <div className={clsx('flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-muted', compact ? 'mt-0.5' : 'mt-1.5')}>
            {facts.map((f, i) => <span key={i} className="inline-flex items-center gap-2">{i > 0 && <span className="text-ink-faint" aria-hidden>·</span>}{f}</span>)}
            {badges}
          </div>
        )}

        {instructions && <p className={clsx('text-xs text-ink-muted break-words', compact ? 'mt-0.5' : 'mt-1')}>{instructions}</p>}
        {footer && <div className="mt-1 text-[11px] text-ink-faint">{footer}</div>}
      </div>
      {aside && <div className="shrink-0 self-center">{aside}</div>}
    </div>
  )
}

/** A stack of medicine lines — hairline dividers, spaced bordered cards with `cards`, or tight rows with `dense`. */
export function MedicineList({ children, cards = false, dense = false, className }) {
  if (cards) return <div className={clsx('flex flex-col gap-2', className)}>{children}</div>
  return (
    <div className={clsx('divide-y divide-border [&>*:first-child]:pt-0 [&>*:last-child]:pb-0', dense ? '[&>*]:py-1.5' : '[&>*]:py-3', className)}>
      {children}
    </div>
  )
}

/**
 * Pulls the timing and duration words for an OPD prescription line out of the shared
 * phrases (so a line reads in the UI language), ready to pass to <MedicineLine>.
 */
export function rxLineParts(line, lang = 'en') {
  const words = rxPhrases(lang)
  const days = Number(line?.days)
  const duration = !days || line?.frequency === 'STAT' ? null : days % 7 === 0 && days >= 14 ? words.weeks(days / 7) : words.days(days)
  const timing = line?.timing && line.timing !== 'ANY' ? words[line.timing] : null
  return { duration, timing }
}
