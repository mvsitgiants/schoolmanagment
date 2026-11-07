import { Fragment } from 'react'
import clsx from 'clsx'
import { formatNumber } from '../../utils/format'

/**
 * A horizontal milestone journey — a row of icon nodes joined by arrows, each
 * with a label and an optional value, plus optional dashed sub-branches hanging
 * beneath a node for the off-happy-path states at that step.
 *
 * Two modes, both real-data only:
 *  - Aggregate: give each stage a `value` (a count). Nodes render in the brand
 *    colour. Good for a "how many orders are at each step" board.
 *  - Per-record: give each stage a `state` of 'done' | 'active' | 'pending'
 *    (and optionally a `value`, e.g. the date it was reached). Nodes colour by
 *    state and the joining line fills up to the current step.
 *
 *   <JourneyFlow
 *     title="ORD-1042 — Acme Corp"
 *     stages={[
 *       { key: 'confirmed', label: 'Confirmed', icon: Check, state: 'done', value: '12 Aug' },
 *       { key: 'transit', label: 'In Transit', icon: Truck, state: 'active',
 *         branches: [{ label: 'Exception', value: 'Address query', icon: AlertTriangle, tone: 'danger' }] },
 *       { key: 'delivered', label: 'Delivered', icon: PackageCheck, state: 'pending' },
 *     ]}
 *   />
 */
export default function JourneyFlow({
  title,
  subtitle,
  actions,
  stages = [],
  valueFormat,
  onStageClick,
  onBranchClick,
  className,
}) {
  const fmt = (v) => {
    if (v == null || v === '') return null
    return typeof v === 'number' ? (valueFormat ? valueFormat(v) : formatNumber(v)) : v
  }

  return (
    <div className={clsx('bg-surface border border-border rounded-xl shadow-card p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="font-display text-base font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      )}

      <div className="flex items-start overflow-x-auto pb-2">
        {stages.map((stage, i) => {
          const filled = stage.state ? stage.state === 'done' : true
          return (
            <Fragment key={stage.key ?? stage.label ?? i}>
              <Stage stage={stage} fmt={fmt} onStageClick={onStageClick} onBranchClick={onBranchClick} />
              {i < stages.length - 1 && <Connector filled={filled} />}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function Connector({ filled = true }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 px-1.5 pt-7" aria-hidden>
      <span className={clsx('h-2 w-2 rounded-full border-2 shrink-0', filled ? 'border-brand-300' : 'border-border')} />
      <span className={clsx('relative h-px w-7 sm:w-10', filled ? 'bg-brand-300' : 'bg-border')}>
        <span className={clsx('absolute end-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rotate-45 rtl:-rotate-45 border-e-2 border-t-2', filled ? 'border-brand-400' : 'border-border')} />
      </span>
    </div>
  )
}

const NODE_STATE = {
  done: 'bg-success-500 text-white',
  active: 'bg-brand-500 text-white ring-4 ring-brand-100',
  pending: 'bg-bg text-ink-faint border border-border',
}
const BRANCH_TONE = {
  danger: 'bg-danger-500 text-white',
  warning: 'bg-amber-500 text-white',
  success: 'bg-success-500 text-white',
  neutral: 'bg-ink text-surface',
}

function Stage({ stage, fmt, onStageClick, onBranchClick }) {
  const Icon = stage.icon
  const nodeCls = stage.state ? NODE_STATE[stage.state] : 'bg-brand-500 text-white'
  const stageClickable = !!onStageClick
  const NodeTag = stageClickable ? 'button' : 'div'
  const value = fmt(stage.value)

  return (
    <div className="flex w-[128px] shrink-0 flex-col items-center">
      <NodeTag
        type={stageClickable ? 'button' : undefined}
        onClick={stageClickable ? () => onStageClick(stage) : undefined}
        className={clsx('group flex flex-col items-center', stageClickable && 'cursor-pointer')}
      >
        <span className={clsx('flex h-14 w-14 items-center justify-center rounded-full transition-colors', nodeCls)}>
          {Icon ? <Icon className="h-5 w-5" strokeWidth={1.75} /> : null}
        </span>
        <span className="mt-2 text-center text-xs font-medium leading-tight text-ink-muted">{stage.label}</span>
        {value != null && <span className="mt-0.5 font-mono-num text-sm font-bold text-ink">{value}</span>}
      </NodeTag>

      {stage.branches?.length > 0 && (
        <div className="relative mt-3 w-full pb-1">
          <div className="absolute bottom-3 start-1/2 top-0 border-s border-dashed border-border" aria-hidden />
          <div className="relative flex justify-center">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-ink-faint bg-surface" />
          </div>
          <div className="mt-2 flex flex-col gap-2.5">
            {stage.branches.map((b, bi) => {
              const BIcon = b.icon
              const branchClickable = !!onBranchClick
              const Tag = branchClickable ? 'button' : 'div'
              return (
                <Tag
                  key={b.key ?? b.label ?? bi}
                  type={branchClickable ? 'button' : undefined}
                  onClick={branchClickable ? () => onBranchClick(b, stage) : undefined}
                  className={clsx('ms-[50%] flex -translate-x-3.5 rtl:translate-x-3.5 items-center gap-2 text-start', branchClickable && 'hover:opacity-80')}
                >
                  <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', BRANCH_TONE[b.tone] || BRANCH_TONE.neutral)}>
                    {BIcon ? <BIcon className="h-3.5 w-3.5" strokeWidth={1.75} /> : null}
                  </span>
                  <span className="min-w-0">
                    {b.value != null && <span className="block font-mono-num text-sm font-bold leading-none text-ink">{fmt(b.value)}</span>}
                    <span className="block whitespace-nowrap text-xs text-ink-muted">{b.label}</span>
                  </span>
                </Tag>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
