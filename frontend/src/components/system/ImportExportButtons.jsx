import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Upload, Download, CheckCircle2, AlertTriangle } from "lucide-react"
import Button from "../ui/Button"
import Modal from "./Modal"
import { useSnackbar } from "../../context/SnackbarContext"

/**
 * Drop-in Import + Export header-button pair for a master-data screen.
 *
 *   <ImportExportButtons
 *     resourceLabel="suppliers"
 *     onImport={(file, opts) => importSuppliers(file, opts)}
 *     onCommit={(rows) => importSuppliersCommit(rows)}
 *     onExport={() => exportSuppliers()}
 *     exportFilename="suppliers.csv"
 *     templateHeaders={["name", "email", "phone"]}
 *     templateSample={["Acme Steel", "buyer@acme.com", "9876543210"]}
 *     onDone={load}
 *   />
 *
 * Flow: pick a file → it's parsed and validated server-side WITHOUT saving
 * (`onImport(file, { dryRun: true })`, expects `{ rows: [{row, fields, errors}] }`)
 * → every row (valid or not) shows in an editable preview grid, bad cells
 * outlined with their message → "Import N rows" sends the current (possibly
 * edited) field values to `onCommit(rows)`, expects `{ imported, errors }` —
 * committed rows drop off the grid, still-bad rows stay for another round.
 */
export default function ImportExportButtons({
  resourceLabel,
  onImport,
  onCommit,
  onExport,
  exportFilename = "export.csv",
  templateHeaders,
  templateSample,
  onDone,
  requires = "edit",
  accept = ".csv,.xlsx",
}) {
  const { t } = useTranslation("ui")
  const { showError, showSuccess } = useSnackbar()
  const label = resourceLabel ?? t("ui.importExport.records")
  const inputRef = useRef(null)
  const [previewing, setPreviewing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [rows, setRows] = useState(null) // [{ row, fields: {col: value}, errors: [{field, message}] }]

  const columns = templateHeaders?.length
    ? templateHeaders
    : Array.from(new Set((rows || []).flatMap((r) => Object.keys(r.fields || {}))))

  const handleFile = async (file) => {
    if (!file || !onImport) return
    setPreviewing(true)
    try {
      const res = await onImport(file, { dryRun: true })
      const previewRows = (res?.rows || []).map((r) => ({ row: r.row, fields: { ...r.fields }, errors: r.errors || [] }))
      setRows(previewRows)
      if (previewRows.length === 0) showError(t("ui.importExport.noRows"))
    } catch (err) {
      showError(err.response?.data?.message || err.message || t("ui.importExport.readFailed"))
    } finally {
      setPreviewing(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const editCell = (rowIdx, col, value) => {
    setRows((prev) => prev.map((r, i) => i !== rowIdx ? r : {
      ...r,
      fields: { ...r.fields, [col]: value },
      errors: r.errors.filter((e) => e.field !== col), // clear that field's error the moment it's edited
    }))
  }

  const errorFor = (row, col) => row.errors.find((e) => e.field === col)

  const commit = async () => {
    if (!rows?.length || !onCommit) return
    setCommitting(true)
    try {
      const payload = rows.map((r) => r.fields)
      const res = await onCommit(payload)
      const errorsByRow = new Map((res?.errors || []).map((e) => [e.row, []]))
      for (const e of res?.errors || []) errorsByRow.get(e.row).push(e)
      const remaining = rows
        .map((r, i) => ({ ...r, errors: errorsByRow.get(i + 1) || [] }))
        .filter((r) => r.errors.length > 0)
      setRows(remaining)
      onDone?.()
      if (remaining.length === 0) {
        showSuccess(t("ui.importExport.imported", { n: res?.imported ?? rows.length, label }))
        setRows(null)
      } else {
        showError(t("ui.importExport.partial", { imported: res?.imported ?? 0, count: remaining.length }))
      }
    } catch (err) {
      showError(err.response?.data?.message || err.message || t("ui.importExport.importFailed", { label }))
    } finally {
      setCommitting(false)
    }
  }

  const handleExport = async () => {
    if (!onExport) return
    setExporting(true)
    try {
      const data = await onExport()
      const url = window.URL.createObjectURL(new Blob([data]))
      const a = document.createElement("a")
      a.href = url; a.download = exportFilename; a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      showError(err.response?.data?.message || err.message || t("ui.importExport.exportFailed", { label }))
    } finally {
      setExporting(false)
    }
  }

  const downloadTemplate = () => {
    if (!templateHeaders?.length) return
    const csvRows = [templateHeaders.join(","), (templateSample || templateHeaders.map(() => "")).join(",")]
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `${resourceLabel ?? "records"}-template.csv`; a.click()
    window.URL.revokeObjectURL(url)
  }

  const errorCount = (rows || []).reduce((n, r) => n + r.errors.length, 0)

  return (
    <>
      <input type="file" accept={accept} className="hidden" ref={inputRef} onChange={(e) => handleFile(e.target.files?.[0])} />
      {onImport && (
        <Button variant="secondary" icon={Upload} requires={requires} loading={previewing} onClick={() => inputRef.current?.click()}>
          {t("ui.importExport.import")}
        </Button>
      )}
      {onExport && (
        <Button variant="secondary" icon={Download} loading={exporting} onClick={handleExport}>
          {t("ui.common.export")}
        </Button>
      )}
      {onImport && templateHeaders?.length > 0 && (
        <Button variant="link" size="sm" onClick={downloadTemplate}>{t("ui.importExport.template")}</Button>
      )}

      <Modal open={!!rows} onClose={() => setRows(null)} title={t("ui.importExport.title", { label })} size="xl">
        {rows && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-ink-muted">
                {t("ui.importExport.rowsParsed", { count: rows.length })}
              </span>
              {errorCount > 0 && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                  <AlertTriangle size={14} /> {t("ui.importExport.fieldsNeedFixing", { count: errorCount })}
                </span>
              )}
            </div>

            <div className="max-h-[55vh] overflow-auto scroll-thin border border-border rounded-lg">
              <table className="w-full text-start text-[13px]">
                <thead className="bg-bg border-b border-border text-xs font-semibold text-ink-muted sticky top-0">
                  <tr>
                    {columns.map((c) => <th key={c} className="px-3 py-2 whitespace-nowrap">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r, ri) => (
                    <tr key={r.row ?? ri} className={r.errors.length > 0 ? "bg-danger-50/30" : undefined}>
                      {columns.map((col) => {
                        const err = errorFor(r, col)
                        return (
                          <td key={col} className="px-2 py-1.5 align-top">
                            <input
                              value={r.fields?.[col] ?? ""}
                              onChange={(e) => editCell(ri, col, e.target.value)}
                              className={`w-full min-w-[120px] px-2 py-1 text-[13px] rounded border bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${err ? "border-danger-400" : "border-border"}`}
                            />
                            {err && <div className="text-[11px] text-danger-600 mt-0.5">{err.message}</div>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setRows(null)}>{t("ui.common.cancel")}</Button>
              <Button icon={CheckCircle2} loading={committing} onClick={commit}>
                {t("ui.importExport.importRows", { count: rows.length })}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
