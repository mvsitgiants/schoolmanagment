import clsx from 'clsx'

const TONE_TEXT = {
  OCCUPIED: 'text-brand-600',
  AVAILABLE: 'text-success-600',
  RESERVED: 'text-info-500',
  CLEANING: 'text-amber-600',
  BLOCKED: 'text-ink-faint',
}

/**
 * A small drawing of a bed that shows its state at a glance:
 *   OCCUPIED  → filled: a patient's head on the pillow under a blanket;
 *   AVAILABLE → an empty outline;  RESERVED → a dashed mattress;
 *   CLEANING  → an outline with a light wash;  BLOCKED → greyed with a slash.
 * Colour follows the bed status, or pass `color` (any CSS colour) — e.g. the ER triage colour.
 *
 *   <BedGlyph status="OCCUPIED" />   <BedGlyph status="OCCUPIED" color="#D64545" size={56} />
 */
export default function BedGlyph({ status = 'AVAILABLE', color, size = 44, title, className }) {
  const filled = status === 'OCCUPIED'
  return (
    <svg viewBox="0 0 48 30" width={size} height={Math.round((size * 30) / 48)} role="img" aria-label={title} aria-hidden={title ? undefined : true}
      className={clsx('shrink-0', !color && (TONE_TEXT[status] ?? TONE_TEXT.AVAILABLE), className)} style={color ? { color } : undefined}>
      {title && <title>{title}</title>}
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* headboard, footboard, frame and legs */}
        <path d="M4.5 5v21M43.5 13v13M4.5 21.5h39M7.5 21.5v5M40.5 21.5v5" />
        {/* mattress */}
        <rect x="6.5" y="15.5" width="35" height="5" rx="1.6"
          fill={filled ? 'currentColor' : status === 'CLEANING' ? 'currentColor' : 'none'} fillOpacity={filled ? 0.25 : 0.12}
          strokeDasharray={status === 'RESERVED' ? '2.5 2' : undefined} />
        {/* pillow */}
        <rect x="8" y="11.5" width="7.5" height="4" rx="2" fill={filled ? 'currentColor' : 'none'} fillOpacity="0.35" />
      </g>
      {filled && (
        <g fill="currentColor">
          {/* the patient: head on the pillow, blanket over the body */}
          <circle cx="11.75" cy="8.6" r="3.1" />
          <path d="M16.5 15.5c0-3 2-5 5-5h16.2c2 0 3.3 1.4 3.3 3.2v1.8z" />
        </g>
      )}
      {status === 'BLOCKED' && <path d="M8 27L40 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  )
}
