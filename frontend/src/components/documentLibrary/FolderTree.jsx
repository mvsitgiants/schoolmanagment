import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Library } from 'lucide-react'
import { browseLibrary } from '../../api/documentLibrary'
import { useFileLabels } from './LibraryKit'

/** Kinds of place that hold folders inside them (the rest hold only files). */
const HAS_KIDS = new Set(['students', 'scholarships', 'admissions', 'staff', 'candidates', 'school', 'class', 'group'])
const AUTO = ['students', 'scholarships', 'admissions', 'staff', 'candidates', 'school']

/** A folder's name in the reader's language: built-in folders translated, people, classes and the school's own as named. */
export function useFolderName() {
  const { t } = useTranslation('documentLibrary')
  const L = useFileLabels()
  return (f) => {
    if (f.kind === 'source') return L.source(f.source)
    if (f.kind === 'group') return t(`documentLibrary.auto.${f.path.split('/')[1]}`, f.name)
    if (AUTO.includes(f.kind)) return t(`documentLibrary.auto.${f.kind}`, f.name)
    if (f.kind === 'class' && f.path.endsWith('/none')) return t('documentLibrary.auto.noClass')
    return f.name
  }
}

function Nodes({ path, depth, current, expanded, onToggle, onSelect, own }) {
  const name = useFolderName()
  const { data } = useQuery({ queryKey: ['doc-library', 'browse', path], queryFn: () => browseLibrary(path) })
  const nodes = (data?.folders ?? []).filter((f) => (depth === 0 ? (own ? f.kind === 'own' : f.kind !== 'own') : true))
  if (!data) return depth ? <div className="ms-6 my-1 h-4 w-24 animate-pulse rounded bg-black/[0.05]" /> : null
  if (!nodes.length) return null
  return (
    <div className={depth ? 'ms-3 border-s border-border/60 ps-1' : ''}>
      {nodes.map((f) => {
        const kids = HAS_KIDS.has(f.kind)
        const open = expanded.has(f.path)
        const on = current === f.path
        return (
          <div key={f.path}>
            <div className={clsx('flex items-center gap-1 rounded-md px-1 py-1', on ? 'bg-brand-50' : 'hover:bg-bg')}>
              <button type="button" onClick={() => kids && onToggle(f.path)} tabIndex={kids ? 0 : -1} aria-hidden={!kids}
                aria-label={kids ? name(f) : undefined} aria-expanded={kids ? open : undefined}
                className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint">
                {kids && (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />)}
              </button>
              <button type="button" onClick={() => { onSelect(f.path); if (kids && !open) onToggle(f.path) }}
                className={clsx('flex min-w-0 flex-1 items-center gap-1.5 text-start text-sm', on ? 'font-medium text-brand-700' : 'text-ink-muted hover:text-ink')}>
                {open || on ? <FolderOpen className="h-4 w-4 shrink-0" aria-hidden /> : <Folder className="h-4 w-4 shrink-0" aria-hidden />}
                <span className="truncate">{name(f)}</span>
                <span className="ms-auto ps-1 text-xs tabular-nums text-ink-faint">{f.files}</span>
              </button>
            </div>
            {kids && open && <Nodes path={f.path} depth={depth + 1} current={current} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The library's folder rail: All documents, the folders that fill themselves (Students › class › student,
 * Scholarships …, opened one level at a time) and the school's own folders.
 */
export default function FolderTree({ current, expanded, onToggle, onSelect, total }) {
  const { t } = useTranslation('documentLibrary')
  const { data: root } = useQuery({ queryKey: ['doc-library', 'browse', ''], queryFn: () => browseLibrary('') })
  const hasOwn = (root?.folders ?? []).some((f) => f.kind === 'own')
  return (
    <nav aria-label={t('documentLibrary.folders.where')} className="h-max rounded-xl border border-border bg-surface p-2 shadow-card max-lg:max-h-80 max-lg:overflow-y-auto">
      <button type="button" onClick={() => onSelect('')}
        className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm', !current ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-muted hover:bg-bg hover:text-ink')}>
        <Library className="h-4 w-4" aria-hidden />{t('documentLibrary.auto.all')}
        {total != null && <span className="ms-auto text-xs tabular-nums text-ink-faint">{total}</span>}
      </button>
      <div className="my-1 border-t border-border/60" />
      <Nodes path="" depth={0} current={current} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />
      <p className="mt-2 border-t border-border/60 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('documentLibrary.folders.mine')}</p>
      {hasOwn ? <Nodes path="" depth={0} own current={current} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />
        : <p className="px-2 py-1 text-xs text-ink-faint">{t('documentLibrary.folders.noneYet')}</p>}
    </nav>
  )
}
