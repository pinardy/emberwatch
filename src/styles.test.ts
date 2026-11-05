import { describe, expect, it } from 'vitest'

/**
 * Stylesheets are merged by hand when branches collide, and a lost closing
 * brace is silent: the browser swallows every later rule into the broken one,
 * so whole features lose their styling with no error anywhere. This keeps the
 * nesting of every stylesheet in the app balanced.
 */

/** Every stylesheet under src/, read as text by Vite at test time. */
const STYLESHEETS = import.meta.glob('./**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

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
  const files = Object.entries(STYLESHEETS)

  it('finds the app stylesheets', () => {
    expect(files.map(([name]) => name)).toContain('./styles.css')
  })

  it.each(files)('%s has balanced braces', (_name, css) => {
    expect(braceProblem(css)).toBeNull()
  })

  it('reports an unclosed block, the failure it guards against', () => {
    expect(braceProblem('.a {\n  color: red;\n\n.b { color: blue; }\n')).toMatch(/line 1/)
    expect(braceProblem('.a { content: "}"; }')).toBeNull()
  })
})
