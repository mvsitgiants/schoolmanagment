import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { FileText, Image as ImageIcon, LogOut, PinOff, ShieldCheck, UserMinus, UserPlus } from 'lucide-react'
import { CHAT_GROUP_NAME_MAX, CHAT_NOTIFY_LEVELS } from '@schoolgiant/shared'
import { Avatar, Drawer, FormField, Input, Select, StatusPill, Tabs, Textarea, openDocumentViewer, useConfirm } from '../../system'
import Button from '../../ui/Button'
import {
  addChatMembers, fetchChatFiles, fetchChatMembers, removeChatMember, setChatMemberRole, updateChatChannel, updateChatPrefs,
} from '../../../api/comms'
import { downloadFile } from '../../../api/files'
import { hasPermission } from '../../../api/auth'
import { downloadBlob } from '../../../utils/download'
import { useFormat } from '../../../context/SettingsContext'
import { useRealtime } from '../../../context/RealtimeContext'
import { useSnackbar } from '../../../context/SnackbarContext'
import PeopleModal from './PeopleModal'
import { CHANNELS_KEY, channelKey, errText, fileSize } from './chatStore'

const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-3 py-1.5 cursor-pointer">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500" />
    <span>
      <span className="block text-sm text-ink">{label}</span>
      {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
    </span>
  </label>
)

function Members({ channel, me }) {
  const { t } = useTranslation(['comms', 'common'])
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const { isOnline } = useRealtime()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['chat', 'members', channel.id, ''], queryFn: () => fetchChatMembers(channel.id) })
  const group = channel.type === 'GROUP'
  const owner = channel.me?.role === 'OWNER' || hasPermission('comms.chat.moderate')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['chat', 'members', channel.id] }); qc.invalidateQueries({ queryKey: channelKey(channel.id) }) }

  const add = async (ids) => {
    setBusy(true)
    try { await addChatMembers(channel.id, ids); setAdding(false); refresh(); showSuccess(t('chatChannelInfoAdded')) } catch (e) { showError(errText(e)) } finally { setBusy(false) }
  }
  const remove = async (p) => {
    if (!(await confirm({ title: t('chatChannelInfoRemoveTitle', { name: p.name }), message: t('chatChannelInfoRemoveMessage', { channel: channel.name }), tone: 'danger', confirmLabel: t('common:actions.remove') }))) return
    try { await removeChatMember(channel.id, p.id); refresh() } catch (e) { showError(errText(e)) }
  }
  const role = async (p, next) => {
    try { await setChatMemberRole(channel.id, p.id, next); refresh() } catch (e) { showError(errText(e)) }
  }

  return (
    <div className="space-y-2">
      {group && channel.canModerate && <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setAdding(true)}>{t('chatChannelInfoAddPeople')}</Button>}
      {isLoading && <p className="text-sm text-ink-muted py-4">{t('chatLoading')}</p>}
      {rows.length >= 500 && <p className="text-xs text-ink-muted">{t('chatChannelInfoFirst500')}</p>}
      <ul className="divide-y divide-border">
        {rows.map((p) => {
          const online = isOnline(p.id) || p.online
          return (
            <li key={p.id} className="py-1.5 flex items-center gap-2.5">
              <span className="relative shrink-0">
                <Avatar name={p.name} size={32} />
                {online && <span className="absolute bottom-0 end-0 w-2.5 h-2.5 rounded-full bg-success-500 ring-2 ring-surface" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink truncate">{p.name}{p.id === me ? ` ${t('you')}` : ''}</span>
                <span className="block text-xs text-ink-muted truncate">{p.designation || (online ? t('online') : '—')}</span>
              </span>
              {(p.role === 'OWNER' || p.role === 'ADMIN') && <StatusPill tone={p.role === 'OWNER' ? 'info' : 'neutral'}>{t(`memberRoles.${p.role}`)}</StatusPill>}
              {group && channel.canModerate && p.id !== me && p.role !== 'OWNER' && (
                <span className="flex gap-1 shrink-0">
                  {owner && <button type="button" title={p.role === 'ADMIN' ? t('chatChannelInfoRemoveAdmin') : t('chatChannelInfoMakeAdmin')} aria-label={p.role === 'ADMIN' ? t('chatChannelInfoRemoveAdmin') : t('chatChannelInfoMakeAdmin')} onClick={() => role(p, p.role === 'ADMIN' ? 'MEMBER' : 'ADMIN')} className="w-7 h-7 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink"><ShieldCheck className="w-4 h-4" /></button>}
                  {(p.role !== 'ADMIN' || owner) && <button type="button" title={t('chatChannelInfoRemoveFromGroup')} aria-label={t('chatChannelInfoRemoveFromGroup')} onClick={() => remove(p)} className="w-7 h-7 rounded-md flex items-center justify-center text-danger-500 hover:bg-danger-50"><UserMinus className="w-4 h-4" /></button>}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <PeopleModal open={adding} mode="add" exclude={rows.map((r) => r.id)} busy={busy} onClose={() => setAdding(false)} onAdd={add} />
    </div>
  )
}

function Files({ channel }) {
  const { t } = useTranslation(['comms', 'common'])
  const { dateTime } = useFormat()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['chat', 'files', channel.id], queryFn: () => fetchChatFiles(channel.id) })
  const open = (a) => openDocumentViewer({ name: a.fileName, contentType: a.contentType, load: () => downloadFile(a.id), download: async () => downloadBlob(await downloadFile(a.id), a.fileName) })
  if (isLoading) return <p className="text-sm text-ink-muted py-4">{t('chatLoading')}</p>
  if (!rows.length) return <p className="text-sm text-ink-muted py-4">{t('chatChannelInfoNoFiles')}</p>
  return (
    <ul className="divide-y divide-border">
      {rows.map((a) => (
        <li key={`${a.messageId}-${a.id}`}>
          <button type="button" onClick={() => open(a)} className="w-full py-2 flex items-center gap-2.5 text-start hover:bg-bg rounded-md px-1">
            <span className={clsx('w-8 h-8 rounded-md flex items-center justify-center shrink-0', a.image ? 'bg-sky-50 text-sky-600' : 'bg-brand-50 text-brand-600')}>
              {a.image ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink truncate">{a.fileName}</span>
              <span className="block text-xs text-ink-muted truncate">{a.senderName} · {dateTime(a.at)} · {fileSize(a.size)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Pinned({ channel, onJump, onUnpin }) {
  const { t } = useTranslation(['comms', 'common'])
  const { dateTime } = useFormat()
  const list = channel.pinnedMessages ?? []
  const canPin = ['DIRECT', 'GROUP'].includes(channel.type) || channel.canModerate
  if (!list.length) return <p className="text-sm text-ink-muted py-4">{t('chatChannelInfoNothingPinned')}</p>
  return (
    <ul className="space-y-2">
      {list.map((m) => (
        <li key={m.id} className="rounded-lg border border-border p-2.5 flex gap-2">
          <Avatar name={m.senderName} size={28} soft />
          <button type="button" onClick={() => onJump(m.id)} className="min-w-0 flex-1 text-start">
            <span className="block text-xs text-ink-muted">{m.senderName} · {dateTime(m.createdAt)}</span>
            <span className="block text-sm text-ink line-clamp-3 whitespace-pre-wrap">{m.text || (m.attachments?.length ? t('chatAttachmentsCount', { count: m.attachments.length }) : m.student?.display)}</span>
          </button>
          {canPin && <button type="button" title={t('chatChannelInfoUnpin')} aria-label={t('chatChannelInfoUnpin')} onClick={() => onUnpin(m)} className="w-7 h-7 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg shrink-0"><PinOff className="w-4 h-4" /></button>}
        </li>
      ))}
    </ul>
  )
}

function Settings({ channel, me, onLeft }) {
  const { t } = useTranslation(['comms', 'common'])
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const [name, setName] = useState(channel.name ?? '')
  const [description, setDescription] = useState(channel.description ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setName(channel.name ?? ''); setDescription(channel.description ?? '') }, [channel.id, channel.name, channel.description])

  const apply = (out) => {
    qc.setQueryData(channelKey(channel.id), out)
    qc.invalidateQueries({ queryKey: CHANNELS_KEY })
  }
  const prefs = async (body) => { try { apply(await updateChatPrefs(channel.id, body)) } catch (e) { showError(errText(e)) } }
  const save = async () => {
    setSaving(true)
    try {
      apply(await updateChatChannel(channel.id, { ...(channel.type === 'GROUP' && { name: name.trim() }), description: description.trim() }))
      showSuccess(t('saved'))
    } catch (e) { showError(errText(e)) } finally { setSaving(false) }
  }
  const leave = async () => {
    if (!(await confirm({ title: t('chatChannelInfoLeaveTitle', { name: channel.name }), message: t('chatChannelInfoLeaveMessage'), tone: 'danger', confirmLabel: t('leaveGroup') }))) return
    try { await removeChatMember(channel.id, me); qc.invalidateQueries({ queryKey: CHANNELS_KEY }); onLeft() } catch (e) { showError(errText(e)) }
  }
  const editable = channel.canModerate && channel.type !== 'DIRECT'

  return (
    <div className="space-y-4">
      {channel.description && !editable && <p className="text-sm text-ink whitespace-pre-wrap">{channel.description}</p>}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-1">{t('chatChannelInfoForMe')}</h3>
        <Toggle checked={!!channel.me?.muted} onChange={(v) => prefs({ muted: v })} label={t('chatChannelInfoMute')} hint={t('chatChannelInfoMuteHint')} />
        <Toggle checked={!!channel.me?.pinned} onChange={(v) => prefs({ pinned: v })} label={t('chatChannelInfoPinTop')} />
        <FormField label={t('chatChannelInfoRingBellFor')}>
          <Select value={channel.me?.notify ?? 'ALL'} onChange={(e) => prefs({ notify: e.target.value })}>
            {CHAT_NOTIFY_LEVELS.map((n) => <option key={n.value} value={n.value}>{t(`notifyLevels.${n.value}`)}</option>)}
          </Select>
        </FormField>
      </div>
      {editable && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('chatChannelInfoAbout')}</h3>
          {channel.type === 'GROUP' && (
            <FormField label={t('name')} required><Input value={name} maxLength={CHAT_GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} /></FormField>
          )}
          <FormField label={t('description')}><Textarea rows={3} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
          <Button size="sm" loading={saving} disabled={channel.type === 'GROUP' && name.trim().length < 2} onClick={save}>{t('common:actions.save')}</Button>
        </div>
      )}
      {channel.type === 'GROUP' && (
        <div className="pt-2 border-t border-border">
          <Button variant="secondary" icon={LogOut} onClick={leave} className="text-danger-600">{t('leaveGroup')}</Button>
        </div>
      )}
    </div>
  )
}

export default function ChannelInfo({ open, onClose, channel, me, tab, onTab, onJump, onUnpin, onLeft }) {
  const { t } = useTranslation(['comms', 'common'])
  if (!channel) return null
  const tabs = [
    { value: 'settings', label: t('chatTitle') },
    ...(channel.type !== 'DIRECT' ? [{ value: 'members', label: t('chatChannelInfoMembersTab', { n: channel.memberCount ?? 0 }) }] : []),
    { value: 'files', label: t('chatChannelInfoFilesTab') },
    { value: 'pinned', label: channel.pinnedMessages?.length ? t('chatChannelInfoPinnedTabCount', { n: channel.pinnedMessages.length }) : t('chatChannelInfoPinnedTab') },
  ]
  const current = tabs.some((x) => x.value === tab) ? tab : 'settings'
  const typeLabel = channel.type ? t(`channelTypes.${channel.type}`) : channel.typeLabel
  return (
    <Drawer open={open} onClose={onClose} subtitle={typeLabel} title={channel.name} size="md">
      <Tabs tabs={tabs} value={current} onChange={onTab} className="-mx-4 sm:-mx-5 -mt-4 mb-4 px-2" />
      <div className={clsx(current !== 'settings' && 'hidden')}><Settings channel={channel} me={me} onLeft={onLeft} /></div>
      {current === 'members' && <Members channel={channel} me={me} />}
      {current === 'files' && <Files channel={channel} />}
      {current === 'pinned' && <Pinned channel={channel} onJump={(id) => { onClose(); onJump(id) }} onUnpin={onUnpin} />}
    </Drawer>
  )
}
