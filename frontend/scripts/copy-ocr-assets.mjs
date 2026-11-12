// Copies what "Get text from a photo or PDF" needs into public/ocr/, so it is served by our own server (no CDN):
//   worker.min.js                     the text-reading worker (tesseract.js)
//   core/tesseract-core-*-lstm.wasm.js the reading engine (SIMD build, and the plain one for older devices)
//   lang/eng.traineddata.gz, lang/hin.traineddata.gz   English and Hindi
//   pdf.worker.min.mjs                the PDF reader's worker (pdfjs-dist, legacy build for older phones)
// Run before `vite` and `vite build` (package.json predev / prebuild). public/ocr/ is not committed (.gitignore).
// The files are loaded only when a teacher uses the feature, and are kept out of the offline app cache (vite.config.js).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'public', 'ocr')
const pkg = (name) => dirname(require.resolve(`${name}/package.json`))

const files = [
  [join(pkg('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(pkg('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'), 'core/tesseract-core-simd-lstm.wasm.js'],
  [join(pkg('tesseract.js-core'), 'tesseract-core-lstm.wasm.js'), 'core/tesseract-core-lstm.wasm.js'],
  [join(pkg('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), 'lang/eng.traineddata.gz'],
  [join(pkg('@tesseract.js-data/hin'), '4.0.0_best_int', 'hin.traineddata.gz'), 'lang/hin.traineddata.gz'],
  [join(pkg('pdfjs-dist'), 'legacy', 'build', 'pdf.worker.min.mjs'), 'pdf.worker.min.mjs'],
]

let copied = 0
for (const [from, to] of files) {
  const dest = join(out, to)
  if (existsSync(dest) && statSync(dest).size === statSync(from).size) continue
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(from, dest)
  copied++
}
if (copied) console.log(`ocr: ${copied} file(s) copied to public/ocr`)
