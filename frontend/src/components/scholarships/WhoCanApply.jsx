import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Play, UsersRound } from 'lucide-react'
import { ColorChip, DataTable, FormField, Modal, Note, PersonCell, SegmentedControl, Select, Toolbar } from '../system'
import Button from '../ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { createApplications, fetchEligibleStudents } from '../../api/scholarships'
import { useSnackbar } from '../../context/SnackbarContext'

/**
 * Students who match a scheme and haven't applied this year. The office (or a class teacher, for their class)
 * starts all their applications at once and the families get the checklist — nobody has to come and ask.
 */
export default function WhoCanApply({ schemes = [], classes = [], schemeId: presetScheme, onClose, onDone }) {
  const { t } = useTranslation('scholarships')
  const { showError } = useSnackbar()
  const [schemeId, setSchemeId] = useState(presetScheme ?? schemes[0]?.id ?? '')
  const [classId, setClassId] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [picked, setPicked] = useState([])
  const [tellFamily, setTellFamily] = useState(true)
  const [result, setResult] = useState(null)
  const [renewal, setRenewal] = useState(false)
  const params = { classId: renewal ? undefined : classId || undefined, search: q || undefined, renewal: renewal ? '1' : undefined }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['scholarship-eligible', schemeId, params], queryFn: () => fetchEligibleStudents(schemeId, params), enabled: !!schemeId })
  const rows = data?.rows ?? []
  const start = useMutation({
    mutationFn: () => createApplications({ schemeId, studentIds: picked, tellFamily, renewal }),
    onSuccess: (r) => { setResult(r); setPicked([]); refetch(); onDone?.(r) },
    onError: (e) => showError(e.message),
  })
  const scheme = schemes.find((s) => s.id === schemeId)
  return (
    <Modal open onClose={onClose} size="xl" title={t('scholarships.who.title')} footer={<>
      <label className="me-auto inline-flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={tellFamily} onChange={(e) => setTellFamily(e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
        {t('scholarships.who.tellFamilies')}
      </label>
      <Button variant="secondary" onClick={onClose}>{t('scholarships.common.close')}</Button>
      <Button icon={Play} loading={start.isPending} disabled={!picked.length} onClick={() => start.mutate()}>{t('scholarships.who.start', { count: picked.length })}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('scholarships.new.scheme')}>
            <Select value={schemeId} onChange={(e) => { setSchemeId(e.target.value); setPicked([]); setResult(null) }}>
              {schemes.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.valueText}</option>)}
            </Select>
          </FormField>
          {!renewal && <FormField label={t('scholarships.who.class')}>
            <Select value={classId} onChange={(e) => { setClassId(e.target.value); setPicked([]) }}>
              <option value="">{t('scholarships.who.allClasses')}</option>
              {classes.filter((c) => !scheme?.eligibility?.classIds?.length || scheme.eligibility.classIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>}
        </div>
        <SegmentedControl value={renewal ? 'renew' : 'new'} onChange={(v) => { setRenewal(v === 'renew'); setPicked([]); setResult(null) }}
          options={[{ value: 'new', label: t('scholarships.who.modeNew') }, { value: 'renew', label: t('scholarships.who.modeRenew') }]} />
        <Note>{renewal ? t('scholarships.who.renewHint') : t('scholarships.who.hint')}</Note>
        {result && <Note tone={result.skipped.length ? 'warning' : 'success'}>
          {t('scholarships.who.result', { count: result.created })}
          {result.skipped.length > 0 && <ul className="mt-1 list-disc ps-4">{result.skipped.slice(0, 8).map((s) => <li key={s.studentId}>{s.name}: {s.message}</li>)}</ul>}
        </Note>}
        <DataTable
          rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="studentId" maxHeight="50vh"
          selectable selectedIds={picked} onSelectionChange={(ids) => setPicked(ids.filter((id) => rows.find((r) => r.studentId === id)?.ok !== false))}
          rowTone={(r) => (r.ok === false ? 'danger' : undefined)}
          title={t('scholarships.who.list', { count: rows.length })}
          toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('scholarships.who.search')} />}
          columns={[
            { key: 'student', header: t('scholarships.list.student'), mobilePrimary: true, render: (v) => <span className="flex items-center gap-2 min-w-0"><PersonCell name={v?.name ?? '—'} sub={v?.admissionNo} size={28} />{v?.classShort && <ColorChip label={v.classShort} seed={v.classId ?? v.classShort} />}</span> },
            ...(renewal ? [{ key: 'lastYear', header: t('scholarships.who.lastYear'), render: (v, r) => <span className="text-sm text-ink-muted">{[v, r.lastNo].filter(Boolean).join(' · ')}</span> }] : []),
            { key: 'marksPct', header: t('scholarships.app.marks'), align: 'right', render: (v) => (v != null ? `${v}%` : <span className="text-ink-faint">—</span>) },
            { key: 'attendancePct', header: t('scholarships.app.attendance'), align: 'right', render: (v) => (v != null ? `${v}%` : <span className="text-ink-faint">—</span>) },
            { key: 'checks', header: t('scholarships.who.toCheck'), render: (v, r) => {
              if (r.ok === false) return <span className="text-xs text-danger-600">{t('scholarships.who.noRenew', { what: v.filter((c) => c.ok === false).map((c) => t(`scholarships.check.${c.key}`)).join(', ') })}</span>
              const n = v.filter((c) => c.ok == null).length
              return n ? <span className="text-xs text-ink-muted">{t('scholarships.who.onPaper', { count: n })}</span> : <span className="text-xs text-success-600">{t('scholarships.who.allMatch')}</span>
            } },
          ]}
          emptyIcon={UsersRound} emptyTitle={t('scholarships.who.empty')} emptyHint={t('scholarships.who.emptyHint')}
        />
        {data?.capped && <p className="text-xs text-ink-faint">{t('scholarships.who.capped')}</p>}
      </div>
    </Modal>
  )
}
