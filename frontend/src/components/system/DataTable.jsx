import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { AlertTriangle, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown, Inbox, Download, RefreshCw } from 'lucide-react'
import { PANEL } from './tokens'
import { useIsMobile } from '../../hooks/useMediaQuery'

/**
 * The operations data table — a bordered card with a tinted header row,
 * hover + selectable rows, optional client-side sorting, a sticky header,
 * an optional toolbar, and a pagination footer.
 *
 *   columns: [{ key, header, render?(value, row), align?, width, className,
 *               nowrap?: boolean,          // keep this column on one line (codes, dates)
 *               clamp?: false,             // let this column run to full height (default: 3 lines)
 *               sortable?: boolean, sortAccessor?(row),
 *               // mobile (below md): each row collapses to a compact line with
 *               // a chevron that expands the rest as label/value pairs.
 *               mobileTitle?: boolean,     // the phone card's title (default: the first column)
 *               mobileTrail?: boolean,     // the phone card's right-hand figure (default: first visible right-aligned column)
 *               mobilePrimary?: boolean,   // also show on the collapsed line
 *               mobileHidden?: boolean,    // never show on mobile
 *               mobileLabel?: string }]    // label used in the expanded panel
 *   rows:    data objects
 *   rowKey:  string key or fn(row) -> stable id (default 'id')
 *   selectedId + onSelect(row): clickable + highlighted rows
 *   title / toolbar: header strip above the table (search, filters, actions)
 *   emptyAction: node (e.g. a <Button>) shown under the empty message
 *   maxHeight: e.g. '60vh' -> scrolls with a sticky header
 *   exportable / exportName: adds a CSV download to the toolbar strip
 *   exportAll: async () => rows — a paged table exports the whole filtered list instead of the visible page
 *   pagination: { page, size, totalElements, totalPages, onPageChange }
 *   totals: { [columnKey]: node } or fn(rows) -> that — renders a totals strip under the
 *           table. Only meaningful for a full (client-side) row set; on a server-paged
 *           list the caller should pass page-independent totals from its summary endpoint.
 *   totalsLabel: what to print in the first column of that strip (default 'Total')
 *   rowTone(row): 'danger' | 'warning' | 'success' | 'info' — tints an exception row
 *   selectable + selectedIds + onSelectionChange(ids): a checkbox per row (and a header box
 *           that selects every row on the page) for bulk actions; ids are rowKey values
 *
 * Right-aligned columns are treated as numeric: they get tabular figures automatically,
 * so digits line up down the column without every screen remembering `font-mono-num`.
 */
const ROW_TONE = {
  danger: 'bg-danger-50/60',
  warning: 'bg-amber-50/60',
  success: 'bg-success-50/50',
  info: 'bg-info-50/50',
}

export default function DataTable({
  columns, rows = [], loading = false,
  // `onRowClick` is the name ~30 call sites across the app actually pass — kept as an
  // alias of `onSelect` (which alone used to get wired up) rather than fixing every
  // call site, since silently ignoring it meant every one of those screens' row-click
  // had never opened anything.
  rowKey = 'id', selectedId, onSelect, onRowClick,
  emptyIcon: EmptyIcon = Inbox, emptyTitle, emptyHint, emptyAction,
  // the query's error and its refetch: a failed load must not read as "nothing here" (a teacher or
  // pharmacist would decide there is no work) — it shows what went wrong and a Retry instead
  error, onRetry,
  title, toolbar, exportable = false, exportName = 'export', exportAll,
  maxHeight, pagination, dense = false, className,
  totals, totalsLabel, rowTone,
  selectable = false, selectedIds = [], onSelectionChange,
  // a record opened in place: the row whose key is `expandedKey` shows `renderExpanded(row)` under it, full width
  expandedKey, renderExpanded,
}) {
  const { t } = useTranslation('ui')
  const isMobile = useIsMobile()
  const failed = !!error && !loading && rows.length === 0
  const Shown = failed ? AlertTriangle : EmptyIcon
  const emptyText = failed ? t('ui.table.loadFailed', 'Couldn’t load this list') : emptyTitle ?? t('ui.table.emptyTitle')
  const shownHint = failed ? error?.message : emptyHint
  const shownAction = failed
    ? onRetry && <button type="button" onClick={() => onRetry()} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium text-ink hover:bg-bg"><RefreshCw className="w-4 h-4" />{t('ui.table.retry', 'Retry')}</button>
    : emptyAction
  const totalsText = totalsLabel ?? t('ui.common.total')
  const select = onSelect || onRowClick
  const keyOf = (row, i) => (typeof rowKey === 'function' ? rowKey(row) : row?.[rowKey]) ?? i
  const cell = clsx('ui-cell', dense ? 'px-4 py-2.5' : 'px-4 py-3')

  const [sort, setSort] = useState(null) // { key, dir: 1 | -1 }
  const accessorOf = (c) => c.sortAccessor || ((row) => row?.[c.key])

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const acc = accessorOf(col)
    return [...rows].sort((a, b) => {
      const va = acc(a), vb = acc(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * sort.dir
    })
  }, [rows, sort, columns])

  const totalsRow = useMemo(
    () => (typeof totals === 'function' ? totals(rows) : totals) || null,
    [totals, rows],
  )

  // ---- multi-select for bulk actions
  const picked = useMemo(() => new Set(selectedIds), [selectedIds])
  const pageKeys = rows.map((r, i) => keyOf(r, i))
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => picked.has(k))
  const someOnPage = !allOnPage && pageKeys.some((k) => picked.has(k))
  const togglePick = (k) => {
    const n = new Set(picked)
    n.has(k) ? n.delete(k) : n.add(k)
    onSelectionChange?.([...n])
  }
  const togglePage = () => {
    const n = new Set(picked)
    if (allOnPage) pageKeys.forEach((k) => n.delete(k)); else pageKeys.forEach((k) => n.add(k))
    onSelectionChange?.([...n])
  }
  const checkbox = (checked, onChange, label, indeterminate = false) => (
    <input type="checkbox" aria-label={label} checked={checked} onChange={onChange}
      ref={(el) => { if (el) el.indeterminate = indeterminate }}
      className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-500 cursor-pointer align-middle" />
  )
  const selCol = {
    key: '__select', width: 44, clamp: false,
    header: checkbox(allOnPage, togglePage, t('ui.table.selectAllOnPage'), someOnPage),
    render: (_, row) => { const k = keyOf(row, rows.indexOf(row)); return checkbox(picked.has(k), () => togglePick(k), t('ui.table.selectRow')) },
  }
  const cols = selectable ? [selCol, ...columns] : columns

  const toggleSort = (c) => {
    if (!c.sortable) return
    setSort((s) => (s?.key !== c.key ? { key: c.key, dir: 1 } : s.dir === 1 ? { key: c.key, dir: -1 } : null))
  }

  const [exporting, setExporting] = useState(false)
  // a paged table exports the whole filtered list when the page gives `exportAll` (async → rows); else what is shown
  const exportCsv = async () => {
    let list = sortedRows
    if (exportAll) {
      setExporting(true)
      try { list = (await exportAll()) ?? [] } catch { setExporting(false); return } finally { setExporting(false) }
    }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const cols = columns.filter((c) => c.key !== 'actions') // row buttons have nothing to export
    const head = cols.map((c) => esc(typeof c.header === 'string' ? c.header : c.key)).join(',')
    const body = list.map((r) => cols.map((c) => esc(accessorOf(c)(r))).join(',')).join('\n')
    const blob = new Blob([head + '\n' + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${exportName}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  const header = (title || toolbar || exportable) && (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        {title && <span className="text-sm font-semibold text-ink truncate">{title}</span>}
        {toolbar}
      </div>
      {exportable && (
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50"
        >
          <Download size={13} className={exporting ? 'animate-pulse' : undefined} /> {t('ui.common.export')}
        </button>
      )}
    </div>
  )

  const emptyBlock = (
    <div className="flex flex-col items-center text-center gap-1 text-ink-muted px-4 py-14">
      <span className={clsx('mb-2 flex h-11 w-11 items-center justify-center rounded-full ring-8', failed ? 'bg-danger-50 text-danger-600 ring-danger-50/40' : 'bg-brand-50 text-brand-600 ring-brand-50/40')}><Shown className="w-5 h-5" aria-hidden /></span>
      <p className="text-sm font-semibold text-ink">{emptyText}</p>
      {shownHint && <p className="text-xs">{shownHint}</p>}
      {shownAction && <div className="mt-3">{shownAction}</div>}
    </div>
  )

  if (isMobile) {
    return (
      <div className={clsx(PANEL, 'flex flex-col min-w-0 overflow-hidden', className)}>
        {header}
        <div className="flex-1 overflow-auto scroll-thin" style={maxHeight ? { maxHeight } : undefined}>
          <MobileList
            columns={columns} rows={sortedRows} loading={loading} keyOf={keyOf}
            selectedId={selectedId} onSelect={select} emptyBlock={emptyBlock}
            selectable={selectable} picked={picked} onPick={togglePick}
            expandedKey={expandedKey} renderExpanded={renderExpanded}
          />
          {!loading && totalsRow && sortedRows.length > 0 && (
            <div className="border-t border-border bg-bg px-4 py-3 flex flex-wrap gap-x-5 gap-y-1">
              {columns.filter((c) => totalsRow[c.key] != null).map((c) => (
                <span key={c.key} className="text-xs text-ink-muted">
                  {labelFor(c)} <span className="font-mono-num tabular-nums font-semibold text-ink">{totalsRow[c.key]}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        {pagination && <Pagination {...pagination} />}
      </div>
    )
  }

  return (
    <div className={clsx(PANEL, 'flex flex-col min-w-0 overflow-hidden', className)}>
      {header}

      <div className="flex-1 overflow-auto scroll-thin" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full text-start text-[13px]">
          <thead className="bg-slate-50/95 backdrop-blur border-b border-border text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint sticky top-0 z-10">
            <tr>
              {cols.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    style={{ width: c.width }}
                    onClick={() => toggleSort(c)}
                    className={clsx(
                      'ui-cell px-4 py-3 font-semibold select-none whitespace-nowrap',
                      // a <th> is centred by the browser — line every header up with its column's data
                      (!c.align || c.align === 'left') && 'text-start',
                      c.align === 'right' && 'text-end',
                      c.align === 'center' && 'text-center',
                      c.sortable && 'cursor-pointer hover:text-ink',
                    )}
                  >
                    <span className={clsx('inline-flex items-center gap-1', c.align === 'right' && 'flex-row-reverse')}>
                      {c.header}
                      {c.sortable && (active
                        ? (sort.dir === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />)
                        : <ChevronsUpDown size={12} className="text-ink-faint" />)}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.key} className={cell}>
                      <div className="h-3.5 rounded bg-black/5 animate-pulse" style={{ width: '68%' }} />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && sortedRows.length === 0 && (
              <tr>
                <td colSpan={cols.length} className="px-4 py-14">
                  <div className="flex flex-col items-center text-center gap-1 text-ink-muted">
                    <span className={clsx('mb-2 flex h-11 w-11 items-center justify-center rounded-full ring-8', failed ? 'bg-danger-50 text-danger-600 ring-danger-50/40' : 'bg-brand-50 text-brand-600 ring-brand-50/40')}><Shown className="w-5 h-5" aria-hidden /></span>
                    <p className="text-sm font-semibold text-ink">{emptyText}</p>
                    {shownHint && <p className="text-xs">{shownHint}</p>}
                    {shownAction && <div className="mt-3">{shownAction}</div>}
                  </div>
                </td>
              </tr>
            )}

            {!loading &&
              sortedRows.map((row, i) => {
                const k = keyOf(row, i)
                const selected = (selectedId != null && k === selectedId) || picked.has(k)
                const expanded = renderExpanded && expandedKey != null && k === expandedKey
                return (
                  <Fragment key={k}>
                  <tr
                    aria-expanded={renderExpanded ? !!expanded : undefined}
                    onClick={select ? (e) => {
                      // a click on an action control in the row (button, link, form
                      // field) does its own thing — it must not also open the row.
                      if (e.target.closest('button, a, input, select, label, [role="button"]')) return
                      select(row)
                    } : undefined}
                    className={clsx(
                      'group/row transition-colors',
                      select && 'cursor-pointer',
                      selected
                        ? 'bg-brand-50/70 font-medium shadow-[inset_3px_0_0_rgb(var(--brand-500))]'
                        : ROW_TONE[rowTone?.(row)] || clsx('even:bg-slate-50/50', select ? 'hover:bg-brand-50/50 hover:shadow-[inset_3px_0_0_rgb(var(--brand-500))]' : 'hover:bg-slate-50'),
                    )}
                  >
                    {cols.map((c) => (
                      <td
                        key={c.key}
                        className={clsx(
                          cell, 'text-ink align-middle break-words',
                          // Numbers, dates and anything a column marks `nowrap` stay on one line;
                          // everything else wraps instead of being clipped or stretching the table.
                          (c.align === 'right' || c.align === 'center' || c.nowrap) && 'whitespace-nowrap',
                          c.align === 'right' && 'text-end font-mono-num tabular-nums',
                          c.align === 'center' && 'text-center',
                          c.className,
                        )}
                      >
                        {/* An auto-layout table ignores max-width on the cell itself, so the cap
                            lives on a wrapper: wide text columns wrap at a sensible width instead
                            of stretching the table into a horizontal scroll. */}
                        <div
                          title={typeof row?.[c.key] === 'string' && !c.render ? row[c.key] : undefined}
                          className={clsx(
                            !c.width && !c.nowrap && c.align !== 'right' && c.align !== 'center' && 'max-w-[320px]',
                            // A long note must not make its row four times taller than the others.
                            // Three lines, then the drawer (or the tooltip) has the rest.
                            c.clamp !== false && !c.nowrap && c.align !== 'right' && c.align !== 'center' && 'line-clamp-3',
                          )}
                        >
                          {c.render
                            ? c.render(row?.[c.key], row)
                            : <span title={typeof row?.[c.key] === 'string' ? row[c.key] : undefined}>{row?.[c.key]}</span>}
                        </div>
                      </td>
                    ))}
                  </tr>
                  {expanded && (
                    <tr className="bg-surface">
                      <td colSpan={cols.length} className="border-b border-border px-4 py-3">{renderExpanded(row)}</td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
          </tbody>
          {!loading && totalsRow && sortedRows.length > 0 && (
            <tfoot className="bg-bg border-t border-border text-[13px] font-semibold text-ink sticky bottom-0">
              <tr>
                {cols.map((c, i) => (
                  <td
                    key={c.key}
                    className={clsx(
                      cell, 'break-words',
                      (c.align === 'right' || c.align === 'center' || c.nowrap) && 'whitespace-nowrap',
                      c.align === 'right' && 'text-end font-mono-num tabular-nums',
                      c.align === 'center' && 'text-center',
                    )}
                  >
                    {totalsRow[c.key] ?? (i === (selectable ? 1 : 0) ? totalsText : null)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pagination && <Pagination {...pagination} />}
    </div>
  )
}

/* ------------------------------------------------------------ mobile row list */

function labelFor(c) {
  if (c.mobileLabel) return c.mobileLabel
  if (typeof c.header === 'string' && c.header) return c.header
  return ''
}

function MobileList({ columns, rows, loading, keyOf, selectedId, onSelect, emptyBlock, selectable, picked, onPick, expandedKey, renderExpanded }) {
  const { t } = useTranslation('ui')
  const [open, setOpen] = useState(() => new Set())

  if (loading) {
    return (
      <ul className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="px-4 py-3.5">
            <div className="h-3.5 w-2/5 rounded bg-black/5 animate-pulse" />
            <div className="h-3 w-3/5 rounded bg-black/5 animate-pulse mt-2" />
          </li>
        ))}
      </ul>
    )
  }
  if (rows.length === 0) return emptyBlock

  const titleCol = columns.find((c) => c.mobileTitle) ?? columns[0]
  // trailing chip = first right-aligned column with a real header (skip actions cols)
  const trailCol = columns.find((c) => c !== titleCol && c.mobileTrail) ?? columns.find((c) => c !== titleCol && c.align === 'right' && !c.mobileHidden && labelFor(c))
  const primaryCols = columns.filter((c) => c !== titleCol && c !== trailCol && c.mobilePrimary && !c.mobileHidden)
  const restCols = columns.filter((c) => c !== titleCol && c !== trailCol && !c.mobilePrimary && !c.mobileHidden)

  const renderCell = (c, row) => (c.render ? c.render(row?.[c.key], row) : row?.[c.key])

  return (
    <ul className="divide-y divide-border">
      {rows.map((row, i) => {
        const k = keyOf(row, i)
        const isOpen = open.has(k)
        const selected = selectedId != null && k === selectedId
        const toggle = () =>
          setOpen((s) => {
            const n = new Set(s)
            n.has(k) ? n.delete(k) : n.add(k)
            return n
          })
        return (
          <li key={k} className={clsx((selected || picked?.has(k)) && 'bg-brand-50/60', selectable && 'relative')}>
            {selectable && (
              <input type="checkbox" aria-label={t('ui.table.selectRow')} checked={picked.has(k)} onChange={() => onPick(k)}
                className="absolute start-4 top-3.5 h-4 w-4 rounded border-border text-brand-600 z-[1]" />
            )}
            {/* nothing left to expand → the card itself opens the record (else it could never be opened on a phone) */}
            <button
              type="button"
              onClick={restCols.length > 0 ? toggle : onSelect ? () => onSelect(row) : undefined}
              aria-expanded={restCols.length > 0 ? isOpen : undefined}
              className={clsx('w-full flex items-start gap-3 py-3 pe-4 text-start active:bg-bg', selectable ? 'ps-11' : 'ps-4')}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink truncate">{renderCell(titleCol, row)}</div>
                {primaryCols.map((c) => (
                  <div key={c.key} className="text-xs text-ink-muted truncate mt-0.5">
                    {labelFor(c) && <span className="text-ink-faint">{labelFor(c)}: </span>}
                    {renderCell(c, row)}
                  </div>
                ))}
              </div>
              {trailCol && <div className="shrink-0 text-[13px] text-ink">{renderCell(trailCol, row)}</div>}
              {restCols.length > 0 ? (
                <ChevronDown className={clsx('w-4 h-4 text-ink-faint shrink-0 mt-0.5 transition-transform', isOpen && 'rotate-180')} />
              ) : onSelect ? <ChevronRight className="w-4 h-4 text-ink-faint shrink-0 mt-0.5 rtl:rotate-180" /> : null}
            </button>

            {isOpen && restCols.length > 0 && (
              <div className="px-4 pb-3.5 pt-0.5 space-y-2 bg-bg">
                {restCols.map((c) => {
                  const lbl = labelFor(c)
                  return (
                    <div key={c.key} className={clsx('text-[13px]', lbl ? 'flex justify-between gap-4' : '')}>
                      {lbl && <span className="text-ink-muted shrink-0">{lbl}</span>}
                      <span className={clsx('text-ink min-w-0', lbl ? 'text-end' : 'block')}>{renderCell(c, row)}</span>
                    </div>
                  )
                })}
                {onSelect && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSelect(row) }}
                    className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-brand-600"
                  >
                    {t('ui.table.openDetails')} <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
                  </button>
                )}
              </div>
            )}
            {renderExpanded && expandedKey != null && k === expandedKey && <div className="border-t border-border px-4 py-3">{renderExpanded(row)}</div>}
          </li>
        )
      })}
    </ul>
  )
}

export function Pagination({ page = 0, size = 20, totalElements = 0, totalPages = 0, onPageChange }) {
  const from = totalElements === 0 ? 0 : page * size + 1
  const to = Math.min((page + 1) * size, totalElements)
  const { t } = useTranslation('ui')
  // `page` is 0-based. Show up to 5 page buttons around the current one (not always 1–5), plus the first and last.
  const start = Math.max(0, Math.min(page - 2, totalPages - 5))
  const span = Array.from({ length: Math.min(totalPages, 5) }, (_, i) => start + i)
  const nums = [
    ...(span[0] > 0 ? [0, ...(span[0] > 1 ? ['gap-start'] : [])] : []),
    ...span,
    ...(span.at(-1) < totalPages - 1 ? [...(span.at(-1) < totalPages - 2 ? ['gap-end'] : []), totalPages - 1] : []),
  ]
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border text-[11px] flex-wrap">
      <span className="text-ink-muted font-medium">
        {t('ui.pagination.showing', { from, to, total: totalElements })}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="w-10 h-10 sm:w-6 sm:h-6 flex items-center justify-center rounded border border-border text-ink-faint hover:bg-bg disabled:opacity-40"
        >
          <ChevronLeft size={14} className="rtl:rotate-180" />
        </button>
        {nums.map((p) => (typeof p === 'string' ? <span key={p} className="w-4 h-10 sm:h-6 flex items-end justify-center text-ink-faint">…</span> : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={clsx(
              'w-10 h-10 sm:w-6 sm:h-6 flex items-center justify-center rounded border font-semibold',
              p === page ? 'bg-brand-50 text-brand-700 border-brand-100' : 'text-ink-muted hover:bg-bg border-transparent font-medium',
            )}
          >
            {p + 1}
          </button>
        )))}
        <button
          type="button"
          onClick={() => onPageChange(page + 1 < totalPages ? page + 1 : page)}
          disabled={page + 1 >= totalPages}
          className="w-10 h-10 sm:w-6 sm:h-6 flex items-center justify-center rounded border border-border text-ink-muted hover:bg-bg disabled:opacity-40"
        >
          <ChevronRight size={14} className="rtl:rotate-180" />
        </button>
      </div>
    </div>
  )
}
