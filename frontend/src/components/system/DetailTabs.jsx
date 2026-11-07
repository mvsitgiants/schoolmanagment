import { useState } from 'react'
import Tabs from './Tabs'

/**
 * Tabbed body for a <Modal>-based detail view — the <Modal> counterpart of the
 * tabs <RecordDrawer> gets from its attachments/comments props. Pass the
 * sections as tabs; only the active one is mounted, and the tab bar sticks to
 * the top of the modal's scroll area.
 *
 *   <DetailTabs tabs={[
 *     { key: 'overview',  label: 'Overview',   content: <>…</> },
 *     { key: 'checklist', label: 'Checklist',  content: <ChecklistSection … /> },
 *     { key: 'files',     label: 'Files',      content: <Attachments … /> },
 *     { key: 'comments',  label: 'Discussion', content: <RecordComments … /> },
 *   ]} />
 *
 * Assumes the host <Modal>/<Drawer> body padding of `px-4 sm:px-5 py-4`.
 */
export default function DetailTabs({ tabs = [], defaultTab, className = '' }) {
  const avail = tabs.filter(Boolean)
  const [key, setKey] = useState(defaultTab || avail[0]?.key)
  const active = avail.some((t) => t.key === key) ? key : avail[0]?.key
  const current = avail.find((t) => t.key === active)

  return (
    <div className={className}>
      <div className="sticky top-0 z-10 bg-surface -mx-4 sm:-mx-5 -mt-4 px-4 sm:px-5">
        <Tabs
          tabs={avail.map((t) => ({ value: t.key, label: t.badge != null ? `${t.label} ${t.badge}` : t.label }))}
          value={active}
          onChange={setKey}
        />
      </div>
      <div className="pt-4">{current?.content}</div>
    </div>
  )
}
