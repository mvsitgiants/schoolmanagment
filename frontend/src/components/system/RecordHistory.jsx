import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Plus, Minus } from 'lucide-react'
import { useFormat } from '../../context/SettingsContext'
import { fetchRecordAuditLog } from '../../api/core'
import { describePermission } from '@schoolgiant/shared'

const ACTION_TONE = { CREATE: 'bg-success-500', UPDATE: 'bg-brand-500', DELETE: 'bg-danger-500', PLAN_CHANGE: 'bg-amber-400', LOGIN: 'bg-ink-faint', LOGIN_FAILED: 'bg-amber-400', LOGOUT: 'bg-ink-faint', SECURITY: 'bg-danger-500' }

const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const label = (k) => (k.includes('.') ? describePermission(k).text ?? k : k)

/**
 * A record's own change history from the audit log — who changed what, with
 * field-level changes and added/removed items (permissions, roles, modules).
 *
 *   <RecordHistory entityId={row.id} />
 */
export default function RecordHistory({ entityId, label: titleProp, limitItems = 8 }) {
  const { t } = useTranslation('ui')
  const title = titleProp ?? t('ui.common.history')
  const { dateTime: fmt } = useFormat()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!entityId) { setRows([]); setLoading(false); return }
    setLoading(true)
    fetchRecordAuditLog(entityId)
      .then((d) => setRows(d ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [entityId])

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-ink-muted flex items-center gap-1.5">
          <History size={13} /> {title}{rows.length ? ` (${rows.length})` : ''}
        </span>
      </div>
      <div className="px-3 py-3">
        {loading ? (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="h-3.5 rounded bg-black/5 animate-pulse" style={{ width: `${70 - i * 14}%` }} />)}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-ink-faint">{t('ui.history.empty')}</p>
        ) : (
          <ol className="relative border-s border-border ms-1 space-y-4">
            {rows.map((r) => (
              <li key={r.id} className="ms-4">
                <span className={`absolute -start-[5px] mt-1 w-2.5 h-2.5 rounded-full border-2 border-surface ${ACTION_TONE[r.action] || 'bg-brand-400'}`} />
                <p className="text-sm text-ink">{r.summary || r.action}</p>
                <p className="text-[11px] text-ink-faint mt-0.5">{r.userName || t('ui.history.system')} · {fmt(r.at)}</p>
                {r.changes?.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {r.changes.map((c, i) => (
                      <li key={i} className="text-xs text-ink-muted">
                        <span className="font-medium text-ink">{c.field}</span>: <span className="line-through text-ink-faint">{show(c.from)}</span> <span className="inline-block rtl:rotate-180">→</span> {show(c.to)}
                      </li>
                    ))}
                  </ul>
                )}
                {(r.added?.length > 0 || r.removed?.length > 0) && (
                  <ul className="mt-1.5 space-y-0.5">
                    {r.added?.slice(0, limitItems).map((k) => (
                      <li key={`a${k}`} className="text-xs text-success-600 flex items-start gap-1"><Plus className="w-3 h-3 mt-0.5 shrink-0" />{label(k)}</li>
                    ))}
                    {r.added?.length > limitItems && <li className="text-xs text-ink-faint ps-4">{t('ui.history.moreAdded', { n: r.added.length - limitItems })}</li>}
                    {r.removed?.slice(0, limitItems).map((k) => (
                      <li key={`r${k}`} className="text-xs text-danger-600 flex items-start gap-1"><Minus className="w-3 h-3 mt-0.5 shrink-0" />{label(k)}</li>
                    ))}
                    {r.removed?.length > limitItems && <li className="text-xs text-ink-faint ps-4">{t('ui.history.moreRemoved', { n: r.removed.length - limitItems })}</li>}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
