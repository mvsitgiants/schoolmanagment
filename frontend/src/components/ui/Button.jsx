import clsx from 'clsx'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import useCrudPerms from '../../hooks/useCrudPerms'

const VARIANTS = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300',
  secondary: 'bg-white text-ink border border-border hover:bg-bg active:bg-border/40',
  ghost: 'bg-transparent text-ink-muted hover:bg-black/5 hover:text-ink',
  danger: 'bg-danger-500 text-white hover:bg-danger-600',
  link: 'bg-transparent text-brand-600 hover:text-brand-700 underline-offset-4 hover:underline p-0 h-auto'
}

// forward/back arrows point the other way in right-to-left languages (Urdu)
const DIRECTIONAL = new Set([ArrowLeft, ArrowRight, ChevronLeft, ChevronRight])
const iconCls = (I) => clsx('w-4 h-4 shrink-0', DIRECTIONAL.has(I) && 'rtl:rotate-180')

// touch screens get finger-sized buttons (40 / 44px — in px: the phone root font is smaller, so rem would shrink them); a mouse keeps the compact desktop sizes
const SIZES = {
  sm: 'h-8 [@media(pointer:coarse)]:h-[40px] px-3 text-sm gap-1.5',
  md: 'h-9 [@media(pointer:coarse)]:h-[44px] px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2'
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled = false,
  className,
  type = 'button',
  requires,
  to, // a link that looks like a button — one element, not a <button> inside an <a> (invalid, two tab stops)
  ...props
}) {
  // `requires` — 'create' | 'edit' | 'delete' (the route module's matching
  // "<module>.<action>", or "<module>.edit"), an exact permission string, or
  // an array of them (any-of). Hides the button when not allowed. Omit for
  // unguarded actions.
  const { allows } = useCrudPerms()
  if (!allows(requires)) return null

  const cls = clsx(
    'inline-flex items-center justify-center font-medium rounded-md transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-60',
    VARIANTS[variant],
    variant !== 'link' && SIZES[size],
    to && (disabled || loading) && 'pointer-events-none opacity-60',
    className
  )
  const inner = (
    <>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        Icon && <Icon className={iconCls(Icon)} />
      )}
      {children}
      {!loading && IconRight && <IconRight className={iconCls(IconRight)} />}
    </>
  )
  if (to) return <Link to={to} className={cls} aria-disabled={disabled || loading || undefined} {...props}>{inner}</Link>

  return (
    <button type={type} disabled={disabled || loading} className={cls} data-variant={variant} {...props}>
      {inner}
    </button>
  )
}
