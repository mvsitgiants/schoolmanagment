import clsx from 'clsx'

/**
 * A page's list with a short summary rail beside it — two or three small cards (a breakdown ring,
 * a "top" list) that say what the list adds up to. The list keeps the width it needs: the rail sits
 * beside it on wide screens and drops below it on narrower ones (two cards side by side on a tablet).
 *
 * `wide`: the main area is a board that needs every pixel (ER bays, the theatre timeline) — the rail
 * then sits beside it only on very wide screens.
 *
 *   <ListWithRail rail={<BillingRail />}><DataTable … /></ListWithRail>
 */
export default function ListWithRail({ rail, wide = false, children, className }) {
  return (
    <div className={clsx('flex flex-col gap-6 items-start', wide ? '2xl:flex-row' : 'xl:flex-row', className)}>
      <div className="flex-1 min-w-0 w-full flex flex-col gap-4">{children}</div>
      {rail && <aside className={clsx('w-full grid gap-4 md:grid-cols-2', wide ? '2xl:w-[300px] 2xl:shrink-0 2xl:grid-cols-1' : 'xl:w-[300px] xl:shrink-0 xl:grid-cols-1')}>{rail}</aside>}
    </div>
  )
}
