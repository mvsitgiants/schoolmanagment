import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Drawer from './Drawer'
import DataTable from './DataTable'
import StatusPill from './StatusPill'
import Tabs from './Tabs'
import RecordHistory from './RecordHistory'
import { statusTone } from './tokens'

/**
 * Read-only "open this row" slide-over for a document / transaction record:
 * a status header, a key/value summary, one or more line-item tables, an
 * optional timeline, and the row's actions in the footer. Built on <Drawer>.
 *
 * Pass `related` / `history` and the drawer becomes tabbed
 * (Overview · Files · Discussion · Related) — the canonical detail surface.
 * Omit all three and it stays the flat property list it always was.
 *
 *   <RecordDrawer
 *     open={!!row} onClose={() => setRow(null)}
 *     subtitle="Purchase Order" title={row?.poNumber} status={row?.status}
 *     fields={[{ label: 'Vendor', value: row?.vendorName }]}
 *     sections={[{ title: 'Lines', columns, rows: row?.items ?? [] }]}
 *     timeline={[{ label: 'Created', value: fmt(row?.createdAt) }]}
 *     related={[{ label: 'GRN', value: 'GRN-0001', onClick: () => openGrn(row.grnId) }]}
 *     footer={<Button onClick={approve}>Approve</Button>}
 *   />
 */
export default function RecordDrawer({
  open, onClose, subtitle, title, status, statusTone: tone,
  fields = [], sections = [], timeline = [], footer, size = 'xl', children,
  related, history, defaultTab = 'overview',
}) {
  const { t } = useTranslation('ui')
  const hasRelated = Array.isArray(related) && related.length > 0
  const hasHistory = !!(history && history.entityId)
  const tabbed = hasRelated || hasHistory

  const tabDefs = [
    { value: 'overview', label: t('ui.record.overview') },
    hasRelated && { value: 'related', label: t('ui.record.relatedCount', { n: related.length }) },
    hasHistory && { value: 'history', label: t('ui.common.history') },
  ].filter(Boolean)

  const [tab, setTab] = useState(defaultTab)
  // Every fresh open starts on the default tab (the wrapper stays mounted
  // between records, so state would otherwise stick).
  useEffect(() => { if (open) setTab(defaultTab) }, [open, defaultTab])
  const activeTab = tabDefs.some((d) => d.value === tab) ? tab : 'overview'

  const overviewBody = (
    <>
      {status != null && status !== '' && (
        <div className="mb-4">
          <StatusPill tone={tone || statusTone(status)}>{String(status).replace(/_/g, ' ')}</StatusPill>
        </div>
      )}

      {fields.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mb-5">
          {fields.filter((f) => f && f.value != null && f.value !== '').map((f, i) => (
            <div key={i} className={f.full ? 'col-span-2' : ''}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{f.label}</dt>
              <dd className={`mt-0.5 text-sm text-ink ${f.mono ? 'font-mono-num' : ''}`}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {sections.filter((s) => s && (s.rows?.length || s.empty)).map((s, i) => (
        <div key={i} className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">
            {s.title}{s.rows?.length ? ` · ${s.rows.length}` : ''}
          </p>
          <DataTable
            dense
            columns={s.columns}
            rows={s.rows || []}
            rowKey={s.rowKey || 'id'}
            maxHeight="40vh"
            emptyTitle={s.empty || t('ui.common.nothingHere')}
          />
        </div>
      ))}

      {timeline.filter((ev) => ev && ev.value).length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">{t('ui.record.timeline')}</p>
          <ol className="space-y-2">
            {timeline.filter((ev) => ev && ev.value).map((ev, i) => (
              <li key={i} className="flex items-baseline gap-3 text-sm">
                <span className="w-32 shrink-0 text-ink-faint">{ev.label}</span>
                <span className="text-ink">{ev.value}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {children}
    </>
  )

  return (
    <Drawer open={open} onClose={onClose} subtitle={subtitle} title={title} size={size} footer={footer}>
      {!tabbed ? overviewBody : (
        <>
          <div className="sticky top-0 z-10 bg-surface -mx-4 sm:-mx-5 -mt-4 px-4 sm:px-5">
            <Tabs tabs={tabDefs} value={activeTab} onChange={setTab} />
          </div>
          <div className="pt-4">
            {activeTab === 'overview' && overviewBody}
            {activeTab === 'related' && (
              <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {related.map((r, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={!r.onClick}
                      onClick={r.onClick}
                      className="w-full text-start px-3 py-2.5 flex items-center justify-between gap-3 disabled:cursor-default enabled:hover:bg-bg"
                    >
                      <span className="min-w-0">
                        <span className="block text-[11px] uppercase tracking-wide text-ink-faint">{r.label}</span>
                        <span className="block text-sm text-ink break-words">{r.value ?? '—'}</span>
                      </span>
                      {r.hint && <span className="text-xs text-ink-faint shrink-0">{r.hint}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {activeTab === 'history' && <RecordHistory entityId={history.entityId} />}
          </div>
        </>
      )}
    </Drawer>
  )
}
