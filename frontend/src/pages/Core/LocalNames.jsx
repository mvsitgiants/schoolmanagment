import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Languages, Plus, Sparkles, Upload } from 'lucide-react'
import { LOCAL_NAME_KINDS, LOCAL_SUGGEST_BATCH, localKey, localNameLanguages } from '@schoolgiant/shared'
import { DataTable, Input, Modal, Note, PageContainer, PageHeader, SegmentedControl, Select, StatusPill, Tabs, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { exportLocalNames, fetchBranches, fetchLocalNames, importLocalNames, saveLocalNames, suggestLocalNames } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { readSheet } from '../../utils/readSheet'

// Administration › Names in other languages: the institution's own texts (students, parents, staff, the school,
// classes, subjects, exams, fee heads, any phrase) beside their text in another language. The English stays as saved;
// templates printed in that language use these (Print templates › Print language · Names on the document).
const CAMPUS_KINDS = ['students', 'parents', 'staff', 'school', 'classes']
const AI_ROUNDS = 5 // at most this many batches per click (300 texts)

export default function LocalNames() {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const confirm = useConfirm()
  const langs = localNameLanguages()
  const [lang, setLang] = useState(langs[0]?.code ?? '')
  const [kind, setKind] = useState('students')
  const [branchId, setBranchId] = useState('')
  const [q, setQ] = useState('')
  const [show, setShow] = useState('all')
  const [drafts, setDrafts] = useState({}) // key → { english, value, suggested }
  const [adding, setAdding] = useState({ english: '', value: '' })
  const [sheet, setSheet] = useState(null) // rows read from a file, waiting for "Save"
  const fileRef = useRef(null)
  const canEdit = hasPermission('core.local-names.edit')
  const language = langs.find((l) => l.code === lang)

  const { data: campuses = [] } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches, staleTime: 5 * 60_000 })
  const params = { kind, q: q.trim() || undefined, missing: show === 'missing' ? 'true' : undefined, branchId: CAMPUS_KINDS.includes(kind) && branchId ? branchId : undefined }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['local-names', lang, params], queryFn: () => fetchLocalNames(lang, params), enabled: !!lang })
  const rows = data?.rows ?? []
  const changed = useMemo(() => Object.values(drafts), [drafts])
  const valueOf = (r) => drafts[r.key]?.value ?? r.value
  const edit = (r, value, suggested = false) => setDrafts((d) => {
    const next = { ...d }
    if (value === r.value && !suggested) delete next[r.key]
    else next[r.key] = { english: r.english, value, suggested }
    return next
  })
  // leaving the list with unsaved changes asks first
  const switchTo = (fn) => async (v) => {
    if (changed.length && !(await confirm({ title: t('admin.localNames.discardTitle'), message: t('admin.localNames.discardChanges'), confirmLabel: t('admin.localNames.discard') }))) return
    setDrafts({})
    fn(v)
  }

  const save = useMutation({
    mutationFn: () => saveLocalNames(lang, { kind, entries: changed }),
    onSuccess: (r) => { setDrafts({}); qc.invalidateQueries({ queryKey: ['local-names'] }); showSuccess(t('admin.localNames.saved', { count: r.saved + r.removed })) },
    onError: (e) => showError(e.message),
  })
  const add = useMutation({
    mutationFn: () => saveLocalNames(lang, { kind: 'phrases', entries: [adding] }),
    onSuccess: () => { setAdding({ english: '', value: '' }); qc.invalidateQueries({ queryKey: ['local-names'] }); showSuccess(t('admin.localNames.added')) },
    onError: (e) => showError(e.message),
  })
  const suggest = useMutation({
    mutationFn: async () => {
      const todo = rows.filter((r) => !valueOf(r)).map((r) => r.english)
      const out = []
      for (let i = 0; i < todo.length && i < LOCAL_SUGGEST_BATCH * AI_ROUNDS; i += LOCAL_SUGGEST_BATCH) {
        out.push(...(await suggestLocalNames(lang, { kind, texts: todo.slice(i, i + LOCAL_SUGGEST_BATCH) })).suggestions)
      }
      return out
    },
    onSuccess: (list) => {
      const byKey = new Map(list.map((s) => [localKey(s.english), s.value]))
      setDrafts((d) => {
        const next = { ...d }
        for (const r of rows) if (!valueOf(r) && byKey.get(r.key)) next[r.key] = { english: r.english, value: byKey.get(r.key), suggested: true }
        return next
      })
      showSuccess(t('admin.localNames.suggested', { count: list.length }))
    },
    onError: (e) => showError(e.response?.data?.code === 'AI_UNAVAILABLE' ? t('admin.localNames.aiOff') : e.message),
  })
  const importSheet = useMutation({
    mutationFn: () => importLocalNames(lang, { kind, rows: sheet.rows, dryRun: false }),
    onSuccess: (r) => { setSheet(null); qc.invalidateQueries({ queryKey: ['local-names'] }); showSuccess(t('admin.localNames.imported', { count: r.saved })) },
    onError: (e) => showError(e.message),
  })
  const readFile = async (file) => {
    try {
      const table = await readSheet(file)
      // the first column is the English, the second its translation (headers as exported, or any)
      const rowsIn = table.map((r) => { const [english = '', value = ''] = Object.values(r); return { english, value } }).filter((r) => r.english && r.value)
      const check = await importLocalNames(lang, { kind, rows: rowsIn, dryRun: true })
      setSheet({ name: file.name, rows: rowsIn, ...check })
    } catch (e) {
      showError(e.message)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!language) return <PageContainer><PageHeader icon={Languages} title={t('admin.localNames.title')} /><Note>{t('admin.localNames.noLanguage')}</Note></PageContainer>
  const done = (data?.total ?? 0) - (data?.missing ?? 0)

  return (
    <PageContainer>
      <PageHeader icon={Languages} title={t('admin.localNames.title')} subtitle={t('admin.localNames.subtitle', { language: language.nativeName })}
        actions={<>
          {hasPermission('core.local-names.export') && <Button size="sm" variant="secondary" icon={Download} onClick={() => exportLocalNames(lang, { kind, branchId: params.branchId }).catch((e) => showError(e.message))}>{t('admin.localNames.export')}</Button>}
          {hasPermission('core.local-names.import') && <Button size="sm" variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>{t('admin.localNames.import')}</Button>}
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
        </>} />
      <Note>{t('admin.localNames.how', { language: language.nativeName })}</Note>

      <div className="flex flex-wrap items-end gap-3">
        {langs.length > 1 && <Select aria-label={t('admin.localNames.language')} value={lang} onChange={(e) => switchTo(setLang)(e.target.value)} className="w-44">{langs.map((l) => <option key={l.code} value={l.code}>{l.nativeName} ({l.name})</option>)}</Select>}
        {campuses.length > 1 && CAMPUS_KINDS.includes(kind) && (
          <Select aria-label={t('admin.localNames.campus')} value={branchId} onChange={(e) => switchTo(setBranchId)(e.target.value)} className="w-64">
            <option value="">{t('admin.localNames.allCampuses')}</option>
            {campuses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <Input aria-label={t('admin.localNames.search')} placeholder={t('admin.localNames.search')} value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <SegmentedControl options={[{ value: 'all', label: t('admin.localNames.showAll') }, { value: 'missing', label: t('admin.localNames.showMissing') }]} value={show} onChange={setShow} />
      </div>

      <Tabs tabs={LOCAL_NAME_KINDS.map((k) => ({ value: k.value, label: t(`admin.localNames.kinds.${k.value}`, { defaultValue: k.label }) }))} value={kind} onChange={switchTo(setKind)} />

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-muted flex-1">{data ? t('admin.localNames.progress', { done, total: data.total, language: language.nativeName }) : ' '}</p>
        {canEdit && data?.aiReady && <Button size="sm" variant="secondary" icon={Sparkles} loading={suggest.isPending} disabled={!rows.some((r) => !valueOf(r))} onClick={() => suggest.mutate()}>{t('admin.localNames.fillAi')}</Button>}
        {canEdit && changed.length > 0 && <Button size="sm" variant="ghost" onClick={() => setDrafts({})}>{t('admin.localNames.discard')}</Button>}
        {canEdit && <Button size="sm" loading={save.isPending} disabled={!changed.length} onClick={() => save.mutate()}>{t('admin.localNames.save', { count: changed.length })}</Button>}
      </div>
      {changed.some((c) => c.suggested) && <Note tone="warning">{t('admin.localNames.checkSuggested')}</Note>}

      {kind === 'phrases' && canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-brand-50/30 p-3">
          <Input aria-label={t('admin.localNames.newEnglish')} placeholder={t('admin.localNames.newEnglish')} value={adding.english} onChange={(e) => setAdding((a) => ({ ...a, english: e.target.value }))} className="flex-1 min-w-[220px]" />
          <Input aria-label={t('admin.localNames.newLocal', { language: language.nativeName })} placeholder={t('admin.localNames.newLocal', { language: language.nativeName })} value={adding.value} onChange={(e) => setAdding((a) => ({ ...a, value: e.target.value }))} lang={lang} className="flex-1 min-w-[220px]" />
          <Button size="sm" icon={Plus} loading={add.isPending} disabled={!adding.english.trim() || !adding.value.trim()} onClick={() => add.mutate()}>{t('admin.localNames.add')}</Button>
        </div>
      )}

      <DataTable
        rows={rows}
        rowKey="key"
        loading={isLoading}
        error={error}
        onRetry={refetch}
        rowTone={(r) => (drafts[r.key] ? 'warning' : undefined)}
        columns={[
          { key: 'english', header: t('admin.localNames.english'), width: '34%', mobilePrimary: true, render: (v, r) => (
            <div className="min-w-0"><p className="font-medium text-ink">{v}</p>{r.where && <p className="text-xs text-ink-faint">{r.where}</p>}</div>
          ) },
          { key: 'value', header: language.nativeName, clamp: false, mobilePrimary: true, render: (_, r) => {
            const draft = drafts[r.key]
            return (
              <div className="flex items-center gap-2 min-w-[220px]">
                <Input aria-label={t('admin.localNames.localFor', { english: r.english, language: language.nativeName })} value={valueOf(r)} onChange={(e) => edit(r, e.target.value)} disabled={!canEdit} lang={lang} placeholder={t('admin.localNames.missing')} />
                {(draft?.suggested || (!draft && r.suggested)) && <StatusPill tone="warning">{t('admin.localNames.suggestedTag')}</StatusPill>}
              </div>
            )
          } },
        ]}
        emptyIcon={Languages}
        emptyTitle={show === 'missing' && data?.total ? t('admin.localNames.allDone') : t('admin.localNames.nothing')}
      />
      {data && data.shown < (show === 'missing' ? data.missing : data.total) && !q && <p className="text-xs text-ink-faint">{t('admin.localNames.showingFirst', { count: data.shown })}</p>}

      {sheet && (
        <Modal open onClose={() => setSheet(null)} title={t('admin.localNames.importTitle', { name: sheet.name })}
          footer={<><Button variant="secondary" onClick={() => setSheet(null)}>{t('actions.cancel')}</Button><Button loading={importSheet.isPending} disabled={!sheet.ready} onClick={() => importSheet.mutate()}>{t('admin.localNames.importSave', { count: sheet.ready })}</Button></>}>
          <p className="text-sm text-ink">{t('admin.localNames.importReady', { count: sheet.ready, language: language.nativeName })}</p>
          {sheet.skipped > 0 && <p className="text-sm text-ink-muted mt-2">{t('admin.localNames.importSkipped', { count: sheet.skipped })}</p>}
          <p className="text-xs text-ink-faint mt-3">{t('admin.localNames.importHow')}</p>
        </Modal>
      )}
    </PageContainer>
  )
}
