# Page authoring guide

Every feature page follows the same shape so the app feels like one product.
Copy an existing page in the same module as a starting point — do not invent new
layout patterns.

## Imports

Everything visual comes from the design kit:

```js
import {
  PageContainer, PageHeader, StatCardRow, Panel, DataTable, Toolbar,
  StatusPill, Modal, Drawer, FormField, Input, Select, Textarea,
  Attachments, useConfirm,
} from '../../../components/system'
import Button from '../../../components/ui/Button'
import { useSnackbar } from '../../../context/SnackbarContext'
import { useFormat } from '../../../context/SettingsContext'
```

Do **not** in `src/pages`:

- hand-write `<table>`, `<select>`, or `<input>` with inline Tailwind — use
  `DataTable`, `Select`, `Input`
- use raw hex colours — use tokens (`text-ink`, `bg-bg`, `border-border`,
  `text-brand-600`, `bg-brand-500`, `text-danger-500`, …)
- call `window.confirm` / `window.alert` — use `useConfirm()`
- `console.log` / `console.error` — use `showError(...)`
- reference external image hosts (pravatar, unsplash, …)
- format dates with `toLocaleDateString` — use `useFormat().date` / `.dateTime`

## Skeleton

```jsx
export default function Thing() {
  const { showError, showSuccess } = useSnackbar()
  const { date: fmtDate } = useFormat()
  const confirm = useConfirm()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)   // Drawer target
  const [formOpen, setFormOpen] = useState(false)  // create/edit Modal

  const load = () => {
    setLoading(true)
    api.getThings().then(({ data }) => setRows(data ?? []))
      .catch(() => setRows([])).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const remove = async (row) => {
    if (!(await confirm({ title: 'Delete?', message: `"${row.name}"`, tone: 'danger', confirmLabel: 'Delete' }))) return
    try { await api.deleteThing(row.id); showSuccess('Deleted.'); load() }
    catch (err) { showError(err.response?.data?.message || err.message || 'Could not delete.') }
  }

  return (
    <PageContainer>
      <PageHeader
        icon={SomeIcon}
        title="Things"
        subtitle="One line on what this page is for."
        actions={<Button icon={Plus} onClick={() => setFormOpen(true)}>New Thing</Button>}
      />

      {/* optional */}
      <StatCardRow items={[ /* … */ ]} />

      <DataTable
        title="Things"
        exportable exportName="things"
        columns={[
          { key: 'name',   header: 'Name',   sortable: true, render: (v) => <span className="font-medium text-ink">{v}</span> },
          { key: 'status', header: 'Status', sortable: true, render: (v) => <StatusPill>{v}</StatusPill> },
          { key: 'createdAt', header: 'Added', sortable: true, render: (v) => fmtDate(v) },
          { key: 'actions', header: '', align: 'right', render: (_, row) => (
            <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(row)} />
            </div>
          ) },
        ]}
        rows={rows}
        loading={loading}
        rowKey="id"
        onSelect={setSelected}                 // row click -> Drawer
        emptyIcon={SomeIcon}
        emptyTitle="No things yet"
        emptyHint="Create the first one."
        emptyAction={<Button icon={Plus} onClick={() => setFormOpen(true)}>New Thing</Button>}
      />

      {/* view / edit one record */}
      <Drawer open={!!selected} onClose={() => setSelected(null)} subtitle="Thing" title={selected?.name}>
        {/* detail fields */}
      </Drawer>

      {/* create / edit */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="New Thing"
        footer={<>
          <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={save} disabled={!form.name.trim()}>Save</Button>
        </>}
      >
        <form className="space-y-4" onSubmit={save}>
          <FormField label="Name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </FormField>
        </form>
      </Modal>
    </PageContainer>
  )
}
```

## Component notes

| Component | Use for |
|---|---|
| `DataTable` | any list. `sortable` per column, `maxHeight` for sticky-scroll, `title`/`toolbar` strip, `exportable`, `emptyAction`, `onSelect` for row-click |
| `Drawer` | view/edit **one** record — right slide-over. Not a modal-in-a-modal, not a new route |
| `Modal` | short create/edit forms and confirmations |
| `useConfirm()` | `await confirm({ title, message, tone: 'danger'\|'default', confirmLabel })` → `boolean` |
| `Toolbar` / `ControlChip` / `ViewControls` | search + filter row above a table |
| `Attachments` | file/image uploads on any record: `<Attachments module="lms" entityType="course" entityId={id} />` |
| `useFormat()` | `.date` `.dateTime` `.time` `.number` `.currencyValue` — respects tenant settings |
| `useBrand()` | `companyName`, `logoUrl`, `primaryColor` with defaults |

## Make data visual

A table is never a wall of plain text. Use the cell renderers (`components/system/cells.jsx`):

| Value | Renderer |
|---|---|
| a person (student, staff, guardian) | `PersonCell` — avatar + name + muted sub-line |
| a class, section, category, mode, route | `ColorChip` — colour comes from the name (seed a class with `classId`) |
| gender | `GenderTag` |
| phone | `ContactCell` |
| money | `Money paise`; owed vs total → `PaidBar` |
| a date | `DateCell` (`tone="danger"` when overdue) |
| x of y (seats, copies, marks) | `LevelBar` / `Fraction` |

Above a list, a `StatCardRow` gives the picture at a glance: every tile gets an `icon` and a `tone`
(decorative: brand, violet, info, pink, orange, sky, teal; meaning: success, warning, danger), plus
`progress` or `segments` where there is a split. Counts per class → `ColumnBars` (click to filter).
Have the list API return a `summary` for the whole filtered set rather than counting the visible page.
Reference: `pages/Students/Directory.jsx`, `pages/Fees/Invoices.jsx`, `pages/Hrms/Employees.jsx`.

## Reference pages

- List + Drawer + sort + export: `Manufacturing/features/WorkOrders.jsx`
- List + create Modal + confirm: `DMS/features/RecycleBin.jsx`, `LMS/features/Instructors.jsx`
- Multi-section master page: `HRMS/features/Departments.jsx`
- Dashboard from real data: `DMS/features/Overview.jsx`, `LMS/features/Overview.jsx`
- Config form: `DMS/features/Settings.jsx`
