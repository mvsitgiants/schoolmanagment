import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Hash } from 'lucide-react'
import { MODULE_BY_ID, RESETS, formatDocNumber, validatePattern } from '@schoolgiant/shared'
import { DataTable, Input, Note, PageContainer, PageHeader, Select } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchNumberSeries, saveNumberSeries } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

// validatePattern (shared) answers in English; show its problem through our own keys.
const PATTERN_PROBLEMS = {
  'Enter a pattern': 'empty',
  'Keep it under 40 characters': 'tooLong',
  'Include a running number, e.g. {SEQ:5}': 'noSeq',
  'Use letters, digits, - and / only': 'badChars',
}

export default function NumberSeries() {
  const qc = useQueryClient()
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const { number } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data = [], isLoading } = useQuery({ queryKey: ['number-series'], queryFn: fetchNumberSeries })
  const [drafts, setDrafts] = useState({}) // code → { pattern, reset } while being edited
  const canEdit = hasPermission('core.numbering.edit')

  const docLabel = (s) => t(`admin.numberSeries.docs.${s.code}.label`, { defaultValue: s.label })
  const problemText = (pattern) => {
    const m = validatePattern(pattern)
    if (!m) return null
    if (m.startsWith('Unknown token ')) return t('admin.numberSeries.problems.unknownToken', { token: m.slice('Unknown token '.length) })
    return PATTERN_PROBLEMS[m] ? t(`admin.numberSeries.problems.${PATTERN_PROBLEMS[m]}`) : m
  }
  const draftOf = (s) => drafts[s.code] ?? { pattern: s.pattern, reset: s.reset }
  const edit = (s, patch) => setDrafts((d) => ({ ...d, [s.code]: { ...draftOf(s), ...patch } }))
  const previewOf = (s) => {
    const d = draftOf(s)
    return validatePattern(d.pattern) ? '—' : formatDocNumber(d.pattern, { seq: s.issued + 1, branchCode: 'MAIN' })
  }

  const save = useMutation({
    mutationFn: (s) => saveNumberSeries(s.code, draftOf(s)),
    onSuccess: (_, s) => {
      showSuccess(t('admin.numberSeries.saved', { doc: docLabel(s), example: previewOf(s) }))
      setDrafts((d) => { const n = { ...d }; delete n[s.code]; return n })
      qc.invalidateQueries({ queryKey: ['number-series'] })
    },
    onError: (e) => showError(e.message),
  })

  return (
    <PageContainer>
      <PageHeader icon={Hash} title={t('admin.numberSeries.title')} subtitle={t('admin.numberSeries.subtitle')} />
      <Note>
        {t('admin.numberSeries.tokens.label')} <code className="font-mono-num">{'{SEQ:6}'}</code> {t('admin.numberSeries.tokens.seq')} · <code className="font-mono-num">{'{YYYY}'}</code> <code className="font-mono-num">{'{YY}'}</code> {t('admin.numberSeries.tokens.year')} · <code className="font-mono-num">{'{MM}'}</code> {t('admin.numberSeries.tokens.month')} · <code className="font-mono-num">{'{DD}'}</code> {t('admin.numberSeries.tokens.day')} · <code className="font-mono-num">{'{BR}'}</code> {t('admin.numberSeries.tokens.branch')}. {t('admin.numberSeries.tokens.resetRule')}
      </Note>
      <DataTable
        rows={data}
        loading={isLoading}
        rowKey="code"
        rowTone={(s) => (!s.moduleEnabled ? undefined : drafts[s.code] ? 'info' : undefined)}
        columns={[
          { key: 'label', header: t('admin.numberSeries.cols.document'), mobilePrimary: true, render: (_, s) => (
            <div className={s.moduleEnabled ? '' : 'opacity-60'}>
              <p className="text-sm font-medium text-ink">{docLabel(s)}</p>
              <p className="text-xs text-ink-faint">{MODULE_BY_ID[s.module] ? cl.module(s.module) : ''}{!s.moduleEnabled && ` · ${t('admin.numberSeries.moduleOff')}`}{s.perBranch ? ` · ${t('admin.numberSeries.perBranch')}` : ''}</p>
              {s.hint && <p className="text-[11px] text-ink-faint mt-0.5">{t(`admin.numberSeries.docs.${s.code}.hint`, { defaultValue: s.hint })}</p>}
            </div>
          ) },
          { key: 'pattern', header: t('admin.numberSeries.cols.pattern'), width: 250, render: (_, s) => {
            const problem = problemText(draftOf(s).pattern)
            return (
              <div>
                <Input value={draftOf(s).pattern} disabled={!canEdit} onChange={(e) => edit(s, { pattern: e.target.value })} className="font-mono-num" error={!!problem} />
                {problem && <p className="text-[11px] text-danger-600 mt-1">{problem}</p>}
              </div>
            )
          } },
          { key: 'reset', header: t('admin.numberSeries.cols.reset'), width: 210, render: (_, s) => (
            <Select value={draftOf(s).reset} disabled={!canEdit} onChange={(e) => edit(s, { reset: e.target.value })}>
              {Object.entries(RESETS).map(([k, v]) => <option key={k} value={k}>{t(`admin.numberSeries.resets.${k}`, { defaultValue: v })}</option>)}
            </Select>
          ) },
          { key: 'issued', header: t('admin.numberSeries.cols.next'), render: (_, s) => (
            <div>
              <p className="font-mono-num text-sm text-brand-700 font-medium">{previewOf(s)}</p>
              <p className="text-[11px] text-ink-faint">{s.issued ? t('admin.numberSeries.issued', { issued: number(s.issued), last: s.lastNumber }) : t('admin.numberSeries.noneIssued')}</p>
            </div>
          ) },
          { key: 'code', header: '', align: 'right', width: 100, render: (_, s) => (
            canEdit && drafts[s.code]
              ? <Button size="sm" icon={Check} loading={save.isPending && save.variables?.code === s.code} disabled={!!validatePattern(draftOf(s).pattern)} onClick={() => save.mutate(s)}>{t('actions.save')}</Button>
              : s.customised ? <span className="text-[11px] text-ink-faint">{t('admin.numberSeries.customised')}</span> : null
          ) },
        ]}
      />
    </PageContainer>
  )
}
