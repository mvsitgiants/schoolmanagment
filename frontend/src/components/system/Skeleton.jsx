import clsx from 'clsx'

/** A shimmering placeholder bar. Size it with className (h-*, w-*). */
export default function Skeleton({ className, style }) {
  return <span className={clsx('block rounded bg-black/[0.06] animate-pulse', className ?? 'h-3.5 w-full')} style={style} aria-hidden />
}

/** A few text lines of decreasing width — for a loading panel or drawer body. */
export function SkeletonLines({ lines = 3, className }) {
  return (
    <div className={clsx('flex flex-col gap-2.5', className)} aria-busy="true">
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className="h-3.5" style={{ width: `${88 - ((i * 17) % 45)}%` }} />)}
    </div>
  )
}

/** Rows shaped like <ListRow>s (icon + two lines) — for loading lists and worklists. */
export function SkeletonRows({ rows = 4, className }) {
  return (
    <div className={clsx('flex flex-col gap-4 px-3 py-2', className)} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
          <div className="flex-1 flex flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width: `${62 - (i % 3) * 12}%` }} />
            <Skeleton className="h-3" style={{ width: `${40 - (i % 2) * 10}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
