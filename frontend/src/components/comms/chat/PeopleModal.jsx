import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, X } from 'lucide-react'
import { CHAT_GROUP_NAME_MAX } from '@schoolgiant/shared'
import { Avatar, FormField, Input, Modal, SearchInput, Textarea } from '../../system'
import Button from '../../ui/Button'
import { fetchChatPeople } from '../../../api/comms'
import useDebouncedValue from '../../../hooks/useDebouncedValue'
import { useRealtime } from '../../../context/RealtimeContext'

/**
 * Pick colleagues (online first). Three uses:
 *   mode "direct" — one click opens the chat with that person;
 *   mode "group"  — name the group and tick its members;
 *   mode "add"    — tick people to add to an existing group (`exclude` = already in it).
 */
export default function PeopleModal({ open, mode = 'direct', exclude = [], busy, onClose, onPick, onCreate, onAdd }) {
  const { t } = useTranslation(['comms', 'common'])
  const { isOnline } = useRealtime()
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState([]) // [{ id, name }]
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const search = useDebouncedValue(q.trim(), 250)
  useEffect(() => { if (open) { setQ(''); setChosen([]); setName(''); setDescription('') } }, [open, mode])
  const { data: rows = [], isFetching } = useQuery({ queryKey: ['chat', 'people', search], queryFn: () => fetchChatPeople(search), enabled: open, staleTime: 30_000 })
  const list = rows.filter((p) => !exclude.includes(p.id)).map((p) => ({ ...p, online: isOnline(p.id) || p.online })).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  const toggle = (p) => setChosen((xs) => (xs.some((x) => x.id === p.id) ? xs.filter((x) => x.id !== p.id) : [...xs, { id: p.id, name: p.name }]))
  const multi = mode !== 'direct'
  const title = mode === 'group' ? t('newGroup') : mode === 'add' ? t('chatChannelInfoAddPeople') : t('newChat')

  const footer = multi ? (
    <>
      <Button variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
      {mode === 'group'
        ? <Button loading={busy} disabled={name.trim().length < 2} onClick={() => onCreate({ name: name.trim(), description: description.trim() || undefined, memberIds: chosen.map((c) => c.id) })}>{t('chatPeopleCreateGroup')}</Button>
        : <Button loading={busy} disabled={!chosen.length} onClick={() => onAdd(chosen.map((c) => c.id))}>{chosen.length ? t('chatPeopleAddCount', { n: chosen.length }) : t('common:actions.add')}</Button>}
    </>
  ) : <Button variant="secondary" onClick={onClose}>{t('common:actions.close')}</Button>

  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer}>
      <div className="space-y-3">
        {mode === 'group' && (
          <>
            <FormField label={t('chatPeopleGroupName')} required>
              <Input value={name} maxLength={CHAT_GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder={t('chatPeopleGroupNamePlaceholder')} autoFocus />
            </FormField>
            <FormField label={t('chatPeopleGroupPurpose')}>
              <Textarea rows={2} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
            </FormField>
          </>
        )}
        {multi && chosen.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chosen.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-200 ps-0.5 pe-1 py-0.5 text-xs text-brand-700">
                <Avatar name={c.name} size={20} />
                {c.name}
                <button type="button" aria-label={t('callComposerRemovePerson', { name: c.name })} onClick={() => toggle(c)} className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-brand-100"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
        <SearchInput value={q} onChange={setQ} placeholder={t('chatPeopleSearchPlaceholder')} className="sm:w-full" />
        <div className="max-h-80 overflow-y-auto scroll-thin -mx-1">
          {isFetching && !rows.length && <p className="px-2 py-4 text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('looking')}</p>}
          {!isFetching && !list.length && <p className="px-2 py-4 text-sm text-ink-muted">{t('nobodyFound')}</p>}
          {list.map((p) => {
            const on = chosen.some((c) => c.id === p.id)
            return (
              <button key={p.id} type="button" onClick={() => (multi ? toggle(p) : onPick(p))}
                className={clsx('w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-start', on ? 'bg-brand-50' : 'hover:bg-bg')}>
                <span className="relative shrink-0">
                  <Avatar name={p.name} size={34} />
                  {p.online && <span className="absolute bottom-0 end-0 w-2.5 h-2.5 rounded-full bg-success-500 ring-2 ring-surface" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink truncate">{p.name}</span>
                  <span className="block text-xs text-ink-muted truncate">{[p.designation, ...(p.departments ?? [])].filter(Boolean).join(' · ') || '—'}</span>
                </span>
                {multi && <span className={clsx('w-5 h-5 rounded border flex items-center justify-center shrink-0', on ? 'bg-brand-500 border-brand-500 text-white' : 'border-border')}>{on && <Check className="w-3.5 h-3.5" />}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
