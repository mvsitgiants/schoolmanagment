import { Fragment } from 'react'

// A help article's text: paragraphs, "1." and "-" lists, and **bold** — nothing else, and no HTML (React escapes it).

function inline(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>))
}

export default function ArticleBody({ text }) {
  const blocks = []
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    const num = line.match(/^\d+[.)]\s+(.*)$/)
    const dash = line.match(/^[-•]\s+(.*)$/)
    const last = blocks[blocks.length - 1]
    if (num || dash) {
      const kind = num ? 'ol' : 'ul'
      if (last?.kind === kind) last.items.push((num ?? dash)[1])
      else blocks.push({ kind, items: [(num ?? dash)[1]] })
    } else if (!line) blocks.push({ kind: 'gap' })
    else if (last?.kind === 'p') last.lines.push(line)
    else blocks.push({ kind: 'p', lines: [line] })
  }
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-ink">
      {blocks.map((b, i) => {
        if (b.kind === 'ol') return <ol key={i} className="list-decimal ps-5 space-y-1.5">{b.items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ol>
        if (b.kind === 'ul') return <ul key={i} className="list-disc ps-5 space-y-1.5">{b.items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>
        if (b.kind === 'p') return <p key={i}>{inline(b.lines.join(' '))}</p>
        return null
      })}
    </div>
  )
}
