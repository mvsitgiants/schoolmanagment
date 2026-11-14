import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookCopy, BookPlus, Library, RotateCcw } from 'lucide-react'
import { hasCopies } from '@schoolgiant/shared'
import { FormPage, LevelBar, Note, Panel, SectionCard } from '../../components/system'
import Button from '../../components/ui/Button'
import TitleForm, { titleBody, titleFormValues } from '../../components/library/TitleForm'
import { useLibraryLabels } from '../../components/library/LibraryKit'
import { fetchTitles, saveTitle } from '../../api/library'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'

/** What to look up while typing: an ISBN (10+ digits) beats the title (3+ letters). */
function probeOf(form) {
  const isbn = form.isbn.replace(/[^\dXx]/g, '')
  if (isbn.length >= 10) return { search: isbn, by: 'isbn' }
  const title = form.title.trim()
  return title.length >= 3 ? { search: title, by: 'title' } : null
}

/** Right-hand panel: titles already in the catalogue that look like this one — add copies to them instead. */
function AlreadyHere({ form }) {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const probe = probeOf(form)
  const key = useDebouncedValue(probe ? JSON.stringify(probe) : '', 450)
  const p = key ? JSON.parse(key) : null
  const { data, isFetching } = useQuery({
    queryKey: ['library', 'titles', 'add-check', key],
    queryFn: () => fetchTitles({ search: p.search, pageSize: 5 }),
    enabled: !!p,
    placeholderData: keepPreviousData,
  })
  const rows = p ? (data?.data ?? []).slice(0, 5) : []

  if (!rows.length) {
    return (
      <Panel title={t('library.titles.check.title')}>
        <p className="text-sm text-ink-muted">{p && isFetching ? t('library.titles.check.checking') : t('library.titles.check.empty')}</p>
      </Panel>
    )
  }
  return (
    <SectionCard icon={BookCopy} tone="warning" title={t('library.titles.check.found')} count={rows.length} flush>
      <p className="px-4 pt-3 text-xs text-ink-muted">{p.by === 'isbn' ? t('library.titles.check.byIsbn') : t('library.titles.check.byTitle')}</p>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id}>
            <Link to="/library/catalogue" state={{ open: r.id }} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-bg">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                <span className="block truncate text-xs text-ink-faint">{[r.authors.join(', '), L.type(r.type), r.isbn].filter(Boolean).join(' · ')}</span>
              </span>
              {hasCopies(r.type) && (r.copies.total
                ? <LevelBar value={r.copies.available} max={r.copies.total} dangerAt={0} width="w-16" />
                : <span className="text-xs text-ink-faint shrink-0">{t('library.titles.check.noCopies')}</span>)}
            </Link>
          </li>
        ))}
      </ul>
      <p className="px-4 py-2.5 border-t border-border text-xs text-ink-muted">{t('library.titles.check.addCopiesHint')}</p>
    </SectionCard>
  )
}

/** Library › Catalogue › Add title: one form; an ISBN fills in the rest; copies get the next accession numbers. */
export default function NewTitle() {
  const { t } = useTranslation('library')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(() => titleFormValues(null))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => saveTitle(null, titleBody(form)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['library'] })
      showSuccess(r.added ? t('library.titles.savedWithCopies', { count: r.added }) : t('library.titles.saved'))
      navigate('/library/catalogue', { state: r.id ? { open: r.id } : undefined })
    },
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const clear = () => { setForm(titleFormValues(null)); setErrors({}) }

  return (
    <FormPage
      icon={BookPlus} title={t('library.titles.newTitle')} subtitle={t('library.titles.form.subtitle')}
      headerActions={<Button to="/library/catalogue" variant="secondary" icon={Library}>{t('library.titles.form.toCatalogue')}</Button>}
      errors={errors}
      submitLabel={t('library.titles.new')} submitIcon={BookPlus} requires="create"
      onSubmit={() => save.mutate()} saving={save.isPending} canSubmit={!!form.title.trim()}
      cancelLabel={t('library.titles.form.clear')} cancelIcon={RotateCcw} onCancel={clear}
      aside={<>
        <AlreadyHere form={form} />
        <Note icon={BookCopy}>{t('library.titles.form.requiredNote')}</Note>
      </>}
    >
      <TitleForm value={form} onChange={setForm} errors={errors} onErrors={setErrors} />
    </FormPage>
  )
}
