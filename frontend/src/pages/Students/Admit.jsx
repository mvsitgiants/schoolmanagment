import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { UserPlus } from 'lucide-react'
import { PageContainer, PageHeader } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentForm, { studentBody, studentFormValues } from '../../components/students/StudentForm'
import { admitStudent } from '../../api/students'
import { useSnackbar } from '../../context/SnackbarContext'

/** New admission: one form, the admission number comes from the number series unless typed. */
export default function Admit() {
  const { t } = useTranslation('students')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(() => studentFormValues(null))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => admitStudent(studentBody(form)),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['academic-classes'] })
      showSuccess(t('students.admit.done', { name: s.name, no: s.admissionNo }))
      navigate(`/students/profile/${s.id}`)
    },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const ready = form.firstName.trim() && form.sectionId && form.guardians.some((g) => g.name.trim())
  return (
    <PageContainer>
      <PageHeader icon={UserPlus} title={t('students.admit.title')} subtitle={t('students.admit.subtitle')}
        actions={<Button loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>{t('students.admit.save')}</Button>} />
      <StudentForm value={form} onChange={setForm} errors={errors} />
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={() => navigate('/students/directory')}>{t('actions.cancel')}</Button>
        <Button loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>{t('students.admit.save')}</Button>
      </div>
    </PageContainer>
  )
}
