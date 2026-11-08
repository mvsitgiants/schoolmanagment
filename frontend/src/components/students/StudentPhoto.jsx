import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Camera, Trash2 } from 'lucide-react'
import Button from '../ui/Button'
import { fetchStudentPhoto, saveStudentPhoto } from '../../api/students'
import { IMAGE_TYPES, shrinkImage } from '../../utils/shrinkImage'
import { useSnackbar } from '../../context/SnackbarContext'

const initials = (name) => String(name ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

/**
 * A student's photo (ID cards, the profile): shows it or the initials; with `canEdit`, take or upload one.
 * The image is cropped square and shrunk in the browser (≤ 200 KB) before it is sent.
 */
export default function StudentPhoto({ studentId, name, canEdit = false, size = 'md', onChange }) {
  const { t } = useTranslation('students')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const input = useRef(null)
  const key = ['student-photo', studentId]
  const { data } = useQuery({ queryKey: key, queryFn: () => fetchStudentPhoto(studentId), staleTime: 300_000 })
  const save = useMutation({
    mutationFn: (photo) => saveStudentPhoto(studentId, photo),
    onSuccess: (d) => { qc.setQueryData(key, d); qc.invalidateQueries({ queryKey: ['id-card-list'] }); showSuccess(d.photo ? t('students.photo.saved') : t('students.photo.removed')); onChange?.(d.photo) },
    onError: (e) => showError(e.message),
  })
  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) { showError(t('students.photo.wrongType')); return }
    const url = await shrinkImage(file, { maxSide: 480, maxBytes: 200 * 1024, square: true, quality: 0.85 })
    if (!url) { showError(t('students.photo.tooBig')); return }
    save.mutate(url)
  }
  const box = size === 'sm' ? 'w-10 h-10 text-sm' : 'w-28 h-28 text-3xl'
  return (
    <div className={clsx('flex items-center gap-3', size === 'md' && 'flex-col')}>
      <div className={clsx('rounded-xl overflow-hidden bg-brand-50 text-brand-700 font-semibold flex items-center justify-center shrink-0 border border-border', box)}>
        {data?.photo ? <img src={data.photo} alt={name} className="w-full h-full object-cover" /> : <span>{initials(name)}</span>}
      </div>
      {canEdit && (
        <div className="flex gap-1">
          <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} capture="user" className="hidden" onChange={pick} />
          <Button size="sm" variant={size === 'sm' ? 'ghost' : 'secondary'} icon={Camera} loading={save.isPending} onClick={() => input.current?.click()}
            aria-label={data?.photo ? t('students.photo.change') : t('students.photo.add')}>{size === 'sm' ? null : data?.photo ? t('students.photo.change') : t('students.photo.add')}</Button>
          {data?.photo && size !== 'sm' && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('students.photo.remove')} onClick={() => save.mutate('')} />}
        </div>
      )}
    </div>
  )
}
