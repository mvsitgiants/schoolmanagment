import { useMemo } from 'react'
import { School } from 'lucide-react'
import { PillRow, SideNav, pillClass } from '../system'

/**
 * Classes (with their sections) from the academic lookup, in the lookup's order: a class with no
 * section this year is left out (nothing to list or print for it).
 *   const classes = useClassSections(lookup)   // [{ id, name, code, sections: [{ id, name, label, short }] }]
 */
export function useClassSections(lookup) {
  return useMemo(() => {
    const sections = lookup?.sections ?? []
    return (lookup?.classes ?? [])
      .map((c) => ({ ...c, sections: sections.filter((s) => s.classId === c.id) }))
      .filter((c) => c.sections.length)
  }, [lookup])
}

/**
 * The page's class list as its sub-navigation (left on desktop, chip row on phones).
 *   all: { label, count? } adds an "everyone" item (id '') on top; omit it when a class must be picked.
 *   item(c): extra SideNav fields per class (count, hint, countTone, progress).
 */
export function ClassNav({ title, classes, value, onChange, all, item }) {
  return (
    <SideNav title={title} value={value} onChange={onChange} items={[
      ...(all ? [{ id: '', label: all.label, icon: School, count: all.count, hint: all.hint }] : []),
      ...classes.map((c) => ({ id: c.id, label: c.name, ...(item?.(c) ?? {}) })),
    ]} />
  )
}

/**
 * A class's sections as pills inside the content; nothing for a class with a single section.
 * `allLabel` adds an "all sections" pill (value ''). `label(s)` / `count(s)` shape each pill.
 */
export function SectionPills({ sections = [], value, onChange, allLabel, label, count }) {
  if (sections.length < 2) return null
  return (
    <PillRow>
      {allLabel && <button type="button" aria-pressed={!value} onClick={() => onChange('')} className={pillClass(!value)}>{allLabel}</button>}
      {sections.map((s) => (
        <button key={s.id} type="button" aria-pressed={value === s.id} onClick={() => onChange(s.id)} className={pillClass(value === s.id)}>
          {label ? label(s) : s.label}
          {count?.(s) != null && <span className="tabular-nums opacity-70">· {count(s)}</span>}
        </button>
      ))}
    </PillRow>
  )
}
