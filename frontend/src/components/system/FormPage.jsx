import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import PageContainer from './PageContainer'
import PageHeader from './PageHeader'
import Panel from './Panel'
import Note from './Note'
import Skeleton from './Skeleton'
import Button from '../ui/Button'
import { anyOverlayOpen } from './Modal'
import { SaveShortcutHint, isSaveShortcut, useInOverlay } from './SaveShortcut'

/**
 * The full-page layout for a big "new record" form — the same shape on every such screen:
 * section cards on the left (two thirds), helper panels on the right (one third),
 * and a save bar that stays at the bottom of the screen while the form scrolls.
 *
 *   <FormPage icon={UserPlus} title="Admit student" subtitle="…"
 *     aside={<Note>What happens next…</Note>}
 *     errors={errors}
 *     submitLabel="Admit student" submitIcon={UserPlus} onSubmit={save} saving={pending} canSubmit={ready}
 *     cancelLabel="Clear" cancelIcon={RotateCcw} onCancel={reset}>
 *     <FormSection title="Student" hint="As on the birth certificate.">
 *       <div className="grid sm:grid-cols-6 gap-4">…</div>
 *     </FormSection>
 *   </FormPage>
 *
 * Ctrl + Enter (⌘ + Enter on a Mac) saves from anywhere on the page.
 */
export default function FormPage({
  icon, title, subtitle, headerActions,
  aside, errors, loading = false,
  onSubmit, submitLabel, submitIcon, saving = false, canSubmit = true, requires,
  onCancel, cancelLabel, cancelIcon,
  extraActions,
  children,
}) {
  const { t } = useTranslation('ui')
  const errorCount = typeof errors === 'number' ? errors : Object.keys(errors ?? {}).length
  const ready = !!onSubmit && canSubmit && !saving
  useSaveShortcut(onSubmit, ready && !loading)

  // a failed save jumps back up to the "please fix" note
  const topRef = useRef(null)
  useEffect(() => { if (errorCount) topRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }, [errorCount])

  return (
    <PageContainer>
      <PageHeader icon={icon} title={title} subtitle={subtitle} actions={headerActions} />
      {loading ? <Skeleton className="h-96 rounded-xl" /> : (
        <div className={clsx('grid gap-5 xl:gap-6 items-start', aside && 'lg:grid-cols-3')}>
          <div ref={topRef} className={clsx('min-w-0 space-y-5', aside && 'lg:col-span-2')}>
            {errorCount > 0 && <Note tone="danger">{t('ui.form.fixFields', { count: errorCount })}</Note>}
            {children}
            {onSubmit && (
              <FormActionBar>
                <Button size="lg" icon={submitIcon} requires={requires} loading={saving} disabled={!canSubmit} onClick={onSubmit}>{submitLabel}</Button>
                {onCancel && <Button variant="ghost" icon={cancelIcon} onClick={onCancel}>{cancelLabel ?? t('ui.common.cancel')}</Button>}
                {extraActions}
              </FormActionBar>
            )}
          </div>
          {aside && <aside className="space-y-5 min-w-0 lg:sticky lg:top-0">{aside}</aside>}
        </div>
      )}
    </PageContainer>
  )
}

/**
 * The bar that stays at the bottom of the screen with the save button; shows the keyboard hint on the right.
 * Phones: sits just above the bottom tab bar.
 */
export function FormActionBar({ children, hint = true, className }) {
  return (
    <div className={clsx(
      'sticky z-10 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 -mx-1 px-1 py-3 bg-bg border-t border-border',
      'flex flex-wrap items-center gap-3',
      className,
    )}>
      {children}
      {hint && <SaveShortcutHint className="ms-auto" />}
    </div>
  )
}

/**
 * A form section: a card with a heading and an optional one-line hint.
 * Inside a pop-up or drawer it drops the card on its own (a heading and a rule instead), so one form
 * component works both as a full page and in an Edit pop-up. `plain` forces that look anywhere.
 */
export function FormSection({ title, hint, icon, actions, plain: plainProp, className, bodyClassName, children }) {
  const inOverlay = useInOverlay()
  if (plainProp ?? inOverlay) {
    return (
      <section className={clsx('space-y-3', className)}>
        {(title || actions) && (
          <div className="flex items-end justify-between gap-3 border-b border-border pb-2">
            <div className="min-w-0">
              {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
              {hint && <p className="text-xs text-ink-muted mt-0.5">{hint}</p>}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
          </div>
        )}
        <div className={clsx(bodyClassName, '!p-0')}>{children}</div>
      </section>
    )
  }
  return (
    <Panel title={title} subtitle={hint} icon={icon} actions={actions} className={className} bodyClassName={clsx('sm:p-5', bodyClassName)}>
      {children}
    </Panel>
  )
}

/** Ctrl / ⌘ + Enter runs `onSave` — on a full page; skipped while a pop-up is open on top (the pop-up handles it). */
export function useSaveShortcut(onSave, enabled = true) {
  const ref = useRef(onSave)
  ref.current = onSave
  useEffect(() => {
    if (!enabled) return undefined
    const onKey = (e) => {
      if (!isSaveShortcut(e) || e.defaultPrevented || anyOverlayOpen()) return
      e.preventDefault()
      setTimeout(() => ref.current?.(), 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
