import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Stylesheets are merged by hand when branches collide, and a lost closing
 * brace is silent: the browser swallows every later rule into the broken one,
 * so whole features lose their styling with no error anywhere. This keeps the
 * nesting of every stylesheet in the app balanced.
 */

/**
 * Every stylesheet under src/, read from disk. (Vitest skips CSS processing,
 * so importing CSS, even with `?raw`, would hand back empty strings.) This
 * file is typechecked by tsconfig.node.json for the Node types.
 */
const SRC = join(import.meta.dirname, '.')

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return path.endsWith('.css') ? [path] : []
  })
}

const STYLESHEETS: [string, string][] = cssFiles(SRC).map((file) => [
  relative(SRC, file),
  readFileSync(file, 'utf8'),
])

/** Strips comments and quoted strings, which may legitimately contain braces. */
function codeOnly(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
}

/** Line of the first brace that closes nothing, or of the first unclosed block. */
function braceProblem(css: string): string | null {
  const code = codeOnly(css)
  const open: number[] = []
  let line = 1
  for (const ch of code) {
    if (ch === '\n') line++
    else if (ch === '{') open.push(line)
    else if (ch === '}') {
      if (open.length === 0) return `unexpected "}" on line ${line}`
      open.pop()
    }
  }
  return open.length > 0 ? `block opened on line ${open[0]} is never closed` : null
}

describe('stylesheets', () => {
  const files = STYLESHEETS

  it('reads the real app stylesheets', () => {
    expect(files.map(([name]) => name)).toContain('styles.css')
    // An empty read would make every check below pass vacuously.
    for (const [name, css] of files) expect(css.length, name).toBeGreaterThan(0)
    expect(files.find(([name]) => name === 'styles.css')![1]).toMatch(/\{/)
  })

  it.each(files)('%s has balanced braces', (_name, css) => {
    expect(braceProblem(css)).toBeNull()
  })

  it('reports an unclosed block, the failure it guards against', () => {
    expect(braceProblem('.a {\n  color: red;\n\n.b { color: blue; }\n')).toMatch(/line 1/)
    expect(braceProblem('.a { content: "}"; }')).toBeNull()
  })
})

/*
 * The New settlement screen's footer once floated over the form (sticky, on a
 * see-through gradient), hiding the seed field behind its buttons. It is now a
 * solid bar below the scrolling body; jsdom has no layout, so the rules that
 * make it so are checked here (the markup in SetupScreen.test.tsx).
 */
describe('the setup screen footer', () => {
  const css = (name: string) => codeOnly(STYLESHEETS.find(([n]) => n === name)![1])
  const rule = (sheet: string, selector: string) =>
    new RegExp(`(?:^|\\})\\s*${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css(sheet))?.[1] ?? ''

  it('is a solid bar in a column card, under a body that scrolls clear of it', () => {
    const card = rule('ui/setup.css', '.menu-card.setup-card')
    expect(card).toMatch(/display:\s*flex/)
    expect(card).toMatch(/flex-direction:\s*column/)
    expect(card).toMatch(/overflow:\s*hidden/)
    const body = rule('ui/setup.css', '.setup-body')
    expect(body).toMatch(/overflow-y:\s*auto/)
    expect(body).toMatch(/min-height:\s*0/)
    expect(body).toMatch(/padding:\s*28px 28px 12px/)
    const foot = rule('ui/setup.css', '.modal-foot.setup-foot')
    expect(foot).toMatch(/flex:\s*none/)
    expect(foot).toMatch(/margin:\s*0;/)
    expect(foot).toMatch(/background:\s*var\(--panel\)/)
  })

  it('is never sticky or see-through anywhere', () => {
    for (const [name] of STYLESHEETS) {
      for (const [, body] of css(name).matchAll(/\.setup-foot[^{]*\{([^}]*)\}/g)) {
        expect(body, name).not.toMatch(/position:\s*sticky/)
        expect(body, name).not.toMatch(/rgba\(/)
      }
    }
  })
})
