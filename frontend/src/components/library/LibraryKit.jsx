import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { IndianRupee } from 'lucide-react'
import { COPY_STATUS, FINE_STATUS, LOAN_STATUS, PAYMENT_MODES, formatINR } from '@schoolgiant/shared'
import { FormField, Input, Modal, Select, StatusPill } from '../system'
import Button from '../ui/Button'
import { useSnackbar } from '../../context/SnackbarContext'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { collectFines, fetchLibraryMeta, searchBorrowers } from '../../api/library'

/** Labels for the library lists (shared values → this namespace's text). */
export function useLibraryLabels() {
  const { t } = useTranslation('library')
  return {
    type: (v) => t(`library.types.${v}`),
    copy: (v) => t(`library.copyStatus.${v}`),
    source: (v) => t(`library.sources.${v}`),
    loan: (v) => t(`library.loanStatus.${v}`),
    reason: (v) => t(`library.fineReasons.${v}`),
    fine: (v) => t(`library.fineStatus.${v}`),
    kind: (v) => t(`library.kinds.${v}`),
    block: (v) => t(`library.blocks.${v}`),
  }
}

export const useLibraryMeta = () => useQuery({ queryKey: ['library', 'meta'], queryFn: fetchLibraryMeta, staleTime: 60_000 })

export function CopyPill({ status }) {
  const L = useLibraryLabels()
  return <StatusPill tone={COPY_STATUS[status]?.tone ?? 'neutral'}>{L.copy(status)}</StatusPill>
}
export function LoanPill({ state }) {
  const L = useLibraryLabels()
  return <StatusPill tone={LOAN_STATUS[state]?.tone ?? 'neutral'}>{L.loan(state)}</StatusPill>
}
export function FinePill({ status }) {
  const L = useLibraryLabels()
  return <StatusPill tone={FINE_STATUS[status]?.tone ?? 'neutral'}>{L.fine(status)}</StatusPill>
}

/** Find a student or staff member by name or number, then pick one. `onPick(borrower)` gets { kind, id, name, code, place }. */
export function BorrowerPicker({ value, onPick, error }) {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: found = [] } = useQuery({ queryKey: ['library', 'borrowers', q], queryFn: () => searchBorrowers(q), enabled: q.length >= 2 })
  const options = [...(value ? [value] : []), ...found.filter((b) => !(value && b.kind === value.kind && b.id === value.id))]
  const key = (b) => `${b.kind}:${b.id}`
  return (
    <>
      <FormField label={t('library.picker.find')}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('library.picker.findPlaceholder')} /></FormField>
      <FormField label={t('library.picker.borrower')} required error={error}>
        <Select value={value ? key(value) : ''} onChange={(e) => onPick(options.find((b) => key(b) === e.target.value) ?? null)}>
          <option value="">{q.length >= 2 || value ? t('library.picker.pick') : t('library.picker.typeFirst')}</option>
          {options.map((b) => <option key={key(b)} value={key(b)}>{[b.name, L.kind(b.kind), b.place, b.code].filter(Boolean).join(' · ')}</option>)}
        </Select>
      </FormField>
    </>
  )
}

/** Take payment for fines at the desk (one receipt). */
export function CollectModal({ fines, onClose, onDone }) {
  const { t } = useTranslation('library')
  const { showError } = useSnackbar()
  const [mode, setMode] = useState('CASH')
  const [reference, setReference] = useState('')
  const total = fines.reduce((n, f) => n + f.amount, 0)
  const pay = useMutation({ mutationFn: () => collectFines({ ids: fines.map((f) => f.id), mode, reference }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('library.fines.collectTitle', { amount: formatINR(total) })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button icon={IndianRupee} loading={pay.isPending} onClick={() => pay.mutate()}>{t('library.fines.collect')}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">{t('library.fines.collectFor', { name: fines[0]?.borrower?.name, count: fines.length })}</p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('library.fines.mode')}><Select value={mode} onChange={(e) => setMode(e.target.value)}>{PAYMENT_MODES.filter((m) => m.value !== 'ONLINE').map((m) => <option key={m.value} value={m.value}>{t(`library.modes.${m.value}`)}</option>)}</Select></FormField>
          {mode !== 'CASH' && <FormField label={t('library.fines.reference')}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></FormField>}
        </div>
      </div>
    </Modal>
  )
}
