import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { UserCheck } from 'lucide-react'
import { ControlChip, DataTable, Note, PageContainer, PageHeader, Select } from '../../components/system'
import { fetchAcademicLookup, fetchAllocation, fetchTeachers, saveAllocation, updateSection } from '../../api/academics'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

/**
 * Who teaches what, one class at a time: the class's subjects down the side, its sections across,
 * a teacher in every cell, and the class teacher of each section on top. A change saves at once.
 */
export default function Allocation() {
  const { t } = useTranslation('academics')
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const canEdit = hasPermission('academics.allocation.edit')
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const { data: teachers = [] } = useQuery({ queryKey: ['academic-teachers'], queryFn: fetchTeachers })
  const [yearId, setYearId] = useState('')
  const [classId, setClassId] = useState('')
  const years = lookup?.years ?? []
  const classes = lookup?.classes ?? []
  useEffect(() => { if (!classId && classes.length) setClassId(classes[0].id) }, [classes, classId])

  const key = ['academic-allocation', classId, yearId]
  const { data: grid, isLoading } = useQuery({ queryKey: key, queryFn: () => fetchAllocation(classId, yearId), enabled: !!classId })
  const cell = useMemo(() => new Map((grid?.allocations ?? []).map((a) => [`${a.sectionId}:${a.subjectId}`, a.teacherId])), [grid])
  const teacherName = (id) => teachers.find((x) => x.id === id)?.name

  const save = useMutation({
    mutationFn: ({ kind, sectionId, subjectId, teacherId }) => (kind === 'classTeacher'
      ? updateSection(sectionId, { classTeacherId: teacherId || null })
      : saveAllocation({ sectionId, subjectId, teacherId: teacherId || null })),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ['academic-allocation'] })
      qc.invalidateQueries({ queryKey: ['academic-classes'] })
      qc.invalidateQueries({ queryKey: ['academic-lookup'] })
      showSuccess(v.teacherId ? t('academics.allocation.saved', { name: teacherName(v.teacherId) }) : t('academics.allocation.cleared'))
    },
    onError: (e) => showError(e.message),
  })

  const picker = (value, onChange, label) => (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={!canEdit || grid?.year.closed || save.isPending} aria-label={label}>
      <option value="">{t('academics.allocation.none')}</option>
      {teachers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </Select>
  )

  const sections = grid?.sections ?? []
  const rows = grid && sections.length ? [{ id: '__ct', kind: 'classTeacher' }, ...grid.subjects.map((s) => ({ ...s, kind: 'subject' }))] : []
  const columns = [
    { key: 'name', header: t('academics.allocation.subject'), mobilePrimary: true, width: 200, render: (v, r) => (r.kind === 'classTeacher'
      ? <span className="font-semibold text-ink">{t('academics.allocation.classTeacher')}</span>
      : <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.code}</p></div>) },
    ...sections.map((sec) => ({
      key: sec.id, header: sec.label, render: (_, r) => (r.kind === 'classTeacher'
        ? picker(sec.classTeacherId, (teacherId) => save.mutate({ kind: 'classTeacher', sectionId: sec.id, teacherId }), t('academics.allocation.classTeacherOf', { section: sec.label }))
        : picker(cell.get(`${sec.id}:${r.id}`), (teacherId) => save.mutate({ kind: 'subject', sectionId: sec.id, subjectId: r.id, teacherId }), t('academics.allocation.teacherOf', { subject: r.name, section: sec.label }))),
    })),
  ]
  const year = years.find((y) => y.id === yearId) ?? years.find((y) => y.isCurrent)

  return (
    <PageContainer>
      <PageHeader icon={UserCheck} title={t('academics.allocation.title')} subtitle={t('academics.allocation.subtitle')} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {year && <ControlChip label={t('academics.classes.year')} value={year.name} active={!year.isCurrent} options={years.map((y) => y.name)} onChange={(name) => setYearId(years.find((y) => y.name === name)?.id ?? '')} />}
        {classes.length > 0 && <ControlChip label={t('academics.classes.class')} value={classes.find((c) => c.id === classId)?.name ?? ''} active options={classes.map((c) => c.name)} onChange={(name) => setClassId(classes.find((c) => c.name === name)?.id ?? '')} />}
      </div>
      {grid?.year.closed && <Note tone="warning" className="mb-4">{t('academics.allocation.closedYear', { year: grid.year.name })}</Note>}
      {grid && !grid.subjects.length && <Note className="mb-4">{t('academics.allocation.noSubjects', { name: grid.class.name })}</Note>}
      <DataTable
        rows={rows}
        columns={columns}
        loading={isLoading && !!classId}
        emptyIcon={UserCheck}
        emptyTitle={!classes.length ? t('academics.allocation.noClasses') : !sections.length ? t('academics.allocation.noSections', { name: grid?.class.name ?? '' }) : t('academics.allocation.empty')}
        emptyHint={!classes.length ? t('academics.allocation.noClassesHint') : undefined}
      />
      <p className="mt-3 text-xs text-ink-muted">{t('academics.allocation.scopeNote')}</p>
    </PageContainer>
  )
}
