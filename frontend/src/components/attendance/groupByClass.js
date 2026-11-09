/**
 * The attendance board / report sections grouped into their classes, in order. A section's
 * `label` is "<class> – <section>" and `classOrder` is its class's order, so the class side list
 * can be built without another request. Returns [{ key, name, sections }].
 */
export const classNameOf = (s) => { const cut = s.label.lastIndexOf(' – '); return cut > 0 ? s.label.slice(0, cut) : s.label }
/** The class a section belongs to, as the key `groupByClass` gives it (two classes may share an order). */
export const classKeyOf = (s) => `${s.classOrder}:${classNameOf(s)}`

export default function groupByClass(sections = []) {
  const map = new Map()
  for (const s of sections) {
    const key = classKeyOf(s)
    if (!map.has(key)) map.set(key, { key, name: classNameOf(s), order: s.classOrder, sections: [] })
    map.get(key).sections.push(s)
  }
  return [...map.values()].sort((a, b) => a.order - b.order)
}
