// Prepares dist/ for hosting as a claude.ai Artifact (the repo is private, so
// it is not published to GitHub Pages).
//
// The Artifact host wraps the page in its own <!doctype>/<html>/<head>/<body>
// and does not run service workers, so this writes dist-artifact/ with:
//   - emberwatch.html: dist/index.html's head and body contents, without the
//     document wrapper or the web-app manifest link;
//   - assets/, icons/ and favicon.svg copied as they are (sw.js, the Workbox
//     runtime and the manifest are left out).
// Run after `npm run build`; `npm run build:artifact` does both.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = `${root}dist`
const out = `${root}dist-artifact`

if (!existsSync(`${dist}/index.html`)) {
  console.error('dist/index.html is missing: run `npm run build` first.')
  process.exit(1)
}

const html = readFileSync(`${dist}/index.html`, 'utf8')
const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1]
const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1]
if (head == null || body == null) {
  console.error('dist/index.html has no <head> or <body> to unwrap.')
  process.exit(1)
}

const page = [
  head
    // The host supplies the charset and viewport meta.
    .replace(/<meta\s+charset[^>]*>\s*/i, '')
    .replace(/<meta\s+name="viewport"[\s\S]*?\/>\s*/i, '')
    // No installable PWA on the Artifact host.
    .replace(/<link rel="manifest"[^>]*>\s*/i, ''),
  // The host paints its own ground behind a transparent body.
  '<style>html, body { background: #0d1216; color-scheme: dark; }</style>',
  body,
]
  .map((part) => part.trim())
  .join('\n')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
writeFileSync(`${out}/emberwatch.html`, `${page}\n`)
for (const entry of ['assets', 'icons', 'favicon.svg']) {
  cpSync(`${dist}/${entry}`, `${out}/${entry}`, { recursive: true })
}
console.log(`Wrote ${out}/emberwatch.html and its assets.`)
