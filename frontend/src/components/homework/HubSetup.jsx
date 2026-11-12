import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, UserRound } from 'lucide-react'
import { FormField, Input, Modal, Note, Select } from '../system'
import Button from '../ui/Button'
import { createClass, createSection, createSubject, fetchClasses, fetchSubjects, fetchTeachers, saveAllocation, updateClass } from '../../api/academics'

// Setting up from the Teaching hub, without going to Academic setup: a new class (with its sections and subjects), a
// subject added to a class (one already in the list, or a new one), and who teaches a subject to a section.

const codeOf = (name) => name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12)
const fieldErrors = (e) => e.response?.data?.details?.fields ?? {}

function SubjectChecks({ subjects, picked, onToggle }) {
  if (!subjects.length) return null
  return (
    <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
      {subjects.map((s) => (
        <label key={s.id} className="flex min-h-[36px] items-center gap-2 rounded-md px-2 text-sm text-ink hover:bg-black/[0.03]">
          <input type="checkbox" checked={picked.includes(s.id)} onChange={() => onToggle(s.id)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
          <span className="min-w-0 truncate">{s.name}</span>
        </label>
      ))}
    </div>
  )
}

/** New class: name, short code, its sections this year (e.g. "A, B"), and the subjects taught in it. */
export function AddClassModal({ onClose, onSaved }) {
  const { t } = useTranslation('hub')
  const { data: subjects = [] } = useQuery({ queryKey: ['academics-subjects'], queryFn: fetchSubjects })
  const [f, setF] = useState({ name: '', code: '', codeTouched: false, sections: 'A', subjectIds: [] })
  const [errors, setErrors] = useState({})
  const toggle = (id) => setF((x) => ({ ...x, subjectIds: x.subjectIds.includes(id) ? x.subjectIds.filter((y) => y !== id) : [...x.subjectIds, id] }))
  const save = useMutation({
    mutationFn: async () => {
      const names = [...new Set(f.sections.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))]
      if (!names.length) throw Object.assign(new Error(t('hub.setup.sectionsNeeded')), { fields: { sections: t('hub.setup.sectionsNeeded') } })
      const cls = await createClass({ name: f.name.trim(), code: f.code.trim(), subjectIds: f.subjectIds })
      for (const name of names) await createSection({ classId: cls.id, name })
      return cls
    },
    onSuccess: (cls) => { onSaved(cls); onClose() },
    onError: (e) => setErrors(e.fields ?? fieldErrors(e)),
  })
  const active = subjects.filter((s) => s.active !== false)
  return (
    <Modal open onClose={onClose} size="lg" title={t('hub.setup.addClass')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('hub.cancel')}</Button><Button icon={Plus} loading={save.isPending} disabled={!f.name.trim() || !f.code.trim()} onClick={() => save.mutate()}>{t('hub.setup.addClass')}</Button></>}>
      <div className="space-y-4">
        {save.error && !Object.keys(errors).length && <Note tone="danger">{save.error.message}</Note>}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('hub.setup.className')} required error={errors.name}>
            <Input value={f.name} maxLength={60} placeholder={t('hub.setup.classNameExample')} autoFocus
              onChange={(e) => setF((x) => ({ ...x, name: e.target.value, code: x.codeTouched ? x.code : codeOf(e.target.value) }))} />
          </FormField>
          <FormField label={t('hub.setup.code')} hint={t('hub.setup.codeHint')} required error={errors.code}>
            <Input value={f.code} maxLength={12} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.toUpperCase(), codeTouched: true }))} />
          </FormField>
        </div>
        <FormField label={t('hub.setup.sections')} hint={t('hub.setup.sectionsHint')} required error={errors.sections}>
          <Input value={f.sections} maxLength={60} onChange={(e) => setF((x) => ({ ...x, sections: e.target.value }))} />
        </FormField>
        <FormField label={t('hub.setup.subjects')} hint={t('hub.setup.subjectsHint')}>
          <SubjectChecks subjects={active} picked={f.subjectIds} onToggle={toggle} />
        </FormField>
      </div>
    </Modal>
  )
}

/** Add subjects to a class: tick ones already in the institution's list, or name a new one. */
export function AddSubjectModal({ classId, className, onClose, onSaved }) {
  const { t } = useTranslation('hub')
  const { data: subjects = [] } = useQuery({ queryKey: ['academics-subjects'], queryFn: fetchSubjects })
  const { data: classes } = useQuery({ queryKey: ['academics-classes'], queryFn: () => fetchClasses() })
  const cls = useMemo(() => (Array.isArray(classes) ? classes : classes?.classes ?? []).find((c) => c.id === classId), [classes, classId])
  const has = new Set([...(cls?.subjectIds ?? []), ...(cls?.optionalSubjectIds ?? [])].map(String))
  const [picked, setPicked] = useState([])
  const [fresh, setFresh] = useState({ name: '', code: '' })
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: async () => {
      const ids = [...picked]
      if (fresh.name.trim()) ids.push((await createSubject({ name: fresh.name.trim(), code: (fresh.code || codeOf(fresh.name)).trim() })).id)
      await updateClass(classId, { subjectIds: [...(cls?.subjectIds ?? []).map(String), ...ids] })
      return ids
    },
    onSuccess: (ids) => { onSaved(ids); onClose() },
    onError: (e) => setErrors(fieldErrors(e)),
  })
  const others = subjects.filter((s) => s.active !== false && !has.has(s.id))
  return (
    <Modal open onClose={onClose} size="lg" title={t('hub.setup.addSubjectTo', { name: className })}
      footer={<><Button variant="secondary" onClick={onClose}>{t('hub.cancel')}</Button><Button icon={Plus} loading={save.isPending} disabled={!cls || (!picked.length && !fresh.name.trim())} onClick={() => save.mutate()}>{t('hub.setup.addSubject')}</Button></>}>
      <div className="space-y-4">
        {save.error && !Object.keys(errors).length && <Note tone="danger">{save.error.message}</Note>}
        {others.length > 0 && (
          <FormField label={t('hub.setup.pickSubjects')}>
            <SubjectChecks subjects={others} picked={picked} onToggle={(id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))} />
          </FormField>
        )}
        <div>
          <p className="mb-2 text-sm font-medium text-ink">{others.length ? t('hub.setup.orNew') : t('hub.setup.newSubject')}</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <FormField label={t('hub.setup.subjectName')} error={errors.name}><Input value={fresh.name} maxLength={80} placeholder={t('hub.setup.subjectExample')} onChange={(e) => setFresh((x) => ({ ...x, name: e.target.value }))} /></FormField>
            <FormField label={t('hub.setup.code')} error={errors.code}><Input value={fresh.code} maxLength={12} placeholder={codeOf(fresh.name)} onChange={(e) => setFresh((x) => ({ ...x, code: e.target.value.toUpperCase() }))} /></FormField>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Who teaches this subject to a section (teacher allocation); "nobody" clears it. */
export function TeacherModal({ section, subjectId, subject, onClose, onSaved }) {
  const { t } = useTranslation('hub')
  const { data: teachers = [] } = useQuery({ queryKey: ['academics-teachers'], queryFn: fetchTeachers })
  const [teacherId, setTeacherId] = useState(section.teachers?.[0]?.id ?? '')
  const save = useMutation({
    mutationFn: () => saveAllocation({ sectionId: section.id, subjectId, teacherId: teacherId || null }),
    onSuccess: () => { onSaved(); onClose() },
  })
  return (
    <Modal open onClose={onClose} size="md" title={t('hub.setup.teacherTitle', { section: section.label, subject })}
      footer={<><Button variant="secondary" onClick={onClose}>{t('hub.cancel')}</Button><Button icon={UserRound} loading={save.isPending} onClick={() => save.mutate()}>{t('hub.setup.saveTeacher')}</Button></>}>
      <div className="space-y-3">
        {save.error && <Note tone="danger">{save.error.message}</Note>}
        <FormField label={t('hub.setup.teacher')}>
          <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">{t('hub.setup.nobody')}</option>
            {teachers.map((x) => <option key={x.id} value={x.id}>{x.designation ? `${x.name} — ${x.designation}` : x.name}</option>)}
          </Select>
        </FormField>
      </div>
    </Modal>
  )
}
