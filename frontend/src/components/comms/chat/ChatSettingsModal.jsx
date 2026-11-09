import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FormField, Input, Modal, Select } from '../../system'
import Button from '../../ui/Button'
import { createAutoChatChannel, fetchChatSettings, fetchChatSources, saveChatSettings } from '../../../api/comms'
import { useSnackbar } from '../../../context/SnackbarContext'
import { CHANNELS_KEY, errText } from './chatStore'

/**
 * Chat settings for those who moderate chat: the whole-staff chat as announcements only, how
 * long messages are kept, and setting up a department / campus chat ahead of time (they
 * otherwise appear on their own with their first member).
 */
export default function ChatSettingsModal({ open, onClose }) {
  const { t } = useTranslation(['comms', 'common'])
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [form, setForm] = useState({ announcementsOnly: false, retentionDays: 0 })
  const [saving, setSaving] = useState(false)
  const [setup, setSetup] = useState({ type: 'DEPARTMENT', sourceId: '' })
  const [creating, setCreating] = useState(false)
  const { data: settings } = useQuery({ queryKey: ['chat', 'settings'], queryFn: fetchChatSettings, enabled: open })
  const { data: sources, refetch } = useQuery({ queryKey: ['chat', 'sources'], queryFn: fetchChatSources, enabled: open })
  useEffect(() => { if (settings) setForm({ announcementsOnly: !!settings.announcementsOnly, retentionDays: settings.retentionDays ?? 0 }) }, [settings])

  const save = async () => {
    setSaving(true)
    try {
      await saveChatSettings({ announcementsOnly: form.announcementsOnly, retentionDays: Number(form.retentionDays) || 0 })
      qc.invalidateQueries({ queryKey: ['chat'] })
      showSuccess(t('chatSettingsSaved'))
      onClose()
    } catch (e) { showError(errText(e)) } finally { setSaving(false) }
  }

  const list = setup.type === 'INSTITUTION' ? sources?.branches ?? [] : sources?.departments ?? []
  const chosen = list.find((x) => x.id === setup.sourceId)
  const create = async () => {
    setCreating(true)
    try {
      await createAutoChatChannel(setup.type, setup.sourceId)
      qc.invalidateQueries({ queryKey: CHANNELS_KEY })
      refetch()
      showSuccess(t('chatSettingsSetUpDone'))
    } catch (e) { showError(errText(e)) } finally { setCreating(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('chatSettings')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button><Button loading={saving} onClick={save}>{t('common:actions.save')}</Button></>}>
      <div className="space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.announcementsOnly} onChange={(e) => setForm({ ...form, announcementsOnly: e.target.checked })} className="mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500" />
          <span>
            <span className="block text-sm text-ink">{t('chatSettingsAnnouncementsOnly')}</span>
            <span className="block text-xs text-ink-muted">{t('chatSettingsAnnouncementsOnlyHint')}</span>
          </span>
        </label>
        <FormField label={t('chatSettingsRetention')} hint={t('chatSettingsRetentionHint')}>
          <Input type="number" min={0} max={3650} value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: e.target.value })} />
        </FormField>

        <div className="pt-3 border-t border-border space-y-2.5">
          <div>
            <h3 className="text-sm font-medium text-ink">{t('chatSettingsSetUpTitle')}</h3>
            <p className="text-xs text-ink-muted">{t('chatSettingsSetUpHint')}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] gap-2">
            <Select value={setup.type} onChange={(e) => setSetup({ type: e.target.value, sourceId: '' })} aria-label={t('chatSettingsChatType')}>
              <option value="DEPARTMENT">{t('channelTypes.DEPARTMENT')}</option>
              <option value="INSTITUTION">{t('chatSettingsWholeStaffCampus')}</option>
            </Select>
            <Select value={setup.sourceId} onChange={(e) => setSetup({ ...setup, sourceId: e.target.value })} aria-label={t('chatSettingsPick')}>
              <option value="">{t('chatSettingsPick')}</option>
              {list.map((x) => <option key={x.id} value={x.id}>{x.channelId ? t('chatSettingsInChatOption', { name: x.name, n: x.members ?? 0 }) : x.name}</option>)}
            </Select>
          </div>
          <Button size="sm" variant="secondary" loading={creating} disabled={!setup.sourceId} onClick={create}>
            {chosen?.channelId ? t('chatSettingsBringUpToDate') : t('chatSettingsSetUpChat')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
