import { useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import clsx from 'clsx'

/**
 * A small product / part thumbnail. Shows the image when `src` is present and
 * loads; otherwise (no src, or a broken URL) falls back to a neutral image
 * icon so the row never shows a browser "broken image" glyph.
 *
 *   <Thumbnail src={job.image} alt={job.part} className="w-8 h-8" />
 *
 * `className` sizes the outer box; pass width/height utilities there.
 */
export default function Thumbnail({ src, alt = '', className, imgClassName, iconSize = 16 }) {
  const [failed, setFailed] = useState(false)
  const showImage = src && !failed

  return (
    <div
      className={clsx(
        'rounded border border-border overflow-hidden bg-surface flex items-center justify-center shrink-0 text-ink-faint',
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className={clsx('w-full h-full object-cover', imgClassName)}
        />
      ) : (
        <ImageIcon size={iconSize} strokeWidth={1.75} aria-hidden="true" />
      )}
    </div>
  )
}
