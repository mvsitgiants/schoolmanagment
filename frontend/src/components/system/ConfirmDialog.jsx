import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from './Modal'
import Button from '../ui/Button'
import { FormField, Textarea } from './Form'

const ConfirmContext = createContext(null)

/**
 * Styled replacements for window.confirm / window.prompt.
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title: 'Delete file?', message: '…', tone: 'danger', confirmLabel: 'Delete' })) { … }
 *
 *   const prompt = usePrompt()
 *   const reason = await prompt({ title: 'Why?', label: 'Reason', required: true })  // string | null
 *
 * Wrap the app once in <ConfirmProvider>.
 */
export function ConfirmProvider({ children }) {
  const { t } = useTranslation('ui')
  const [state, setState] = useState(null)
  const [value, setValue] = useState('')
  const resolver = useRef(null)

  const open = useCallback((opts, kind) => {
    setValue(opts.defaultValue || '')
    setState({
      kind,
      // Default labels are resolved at render (below), so they follow the current language.
      title: opts.title,
      message: opts.message || '',
      label: opts.label,
      placeholder: opts.placeholder,
      required: !!opts.required,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      tone: opts.tone || 'default',
    })
    return new Promise((resolve) => { resolver.current = resolve })
  }, [])

  const confirm = useCallback((opts = {}) => open(opts, 'confirm'), [open])
  const prompt = useCallback((opts = {}) => open(opts, 'prompt'), [open])

  const close = (result) => {
    setState(null)
    resolver.current?.(result)
    resolver.current = null
  }
  const submit = () => close(state.kind === 'prompt' ? value : true)
  const cancel = () => close(state?.kind === 'prompt' ? null : false)
  const disabled = state?.kind === 'prompt' && state.required && !value.trim()

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      <Modal
        open={!!state}
        onClose={cancel}
        title={state && (state.title || (state.kind === 'prompt' ? t('ui.confirm.enterValue') : t('ui.confirm.areYouSure')))}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={cancel}>{state?.cancelLabel || t('ui.common.cancel')}</Button>
            <Button
              variant={state?.tone === 'danger' ? 'danger' : 'primary'}
              onClick={submit}
              disabled={disabled}
            >
              {state?.confirmLabel || (state?.kind === 'prompt' ? t('ui.common.save') : t('ui.confirm.confirm'))}
            </Button>
          </>
        }
      >
        {state?.message && <p className="text-sm text-ink-muted mb-3">{state.message}</p>}
        {state?.kind === 'prompt' && (
          <FormField label={state.label} required={state.required}>
            <Textarea
              autoFocus
              rows={3}
              value={value}
              placeholder={state.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!disabled) submit() } }}
            />
          </FormField>
        )}
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  const { t } = useTranslation('ui')
  return ctx?.confirm || ((opts) => Promise.resolve(window.confirm(opts?.message || opts?.title || t('ui.confirm.areYouSure'))))
}

export function usePrompt() {
  const ctx = useContext(ConfirmContext)
  return ctx?.prompt || ((opts) => Promise.resolve(window.prompt(opts?.label || opts?.title || '')))
}
