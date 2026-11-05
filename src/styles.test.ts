import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Stylesheets are merged by hand when branches collide, and a lost closing
 * brace is silent: the browser swallows every later rule into the broken one,
 * so whole features lose their styling with no error anywhere. This keeps the
 * nesting of every stylesheet in the app balanced.
 */

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return path.endsWith('.css') ? [path] : []
  })
}

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
  const files = cssFiles(join(process.cwd(), 'src'))

  it('finds the app stylesheets', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files.map((f) => [f.slice(process.cwd().length + 1), f]))(
    '%s has balanced braces',
    (_name, file) => {
      expect(braceProblem(readFileSync(file, 'utf8'))).toBeNull()
    },
  )

  it('reports an unclosed block, the failure it guards against', () => {
    expect(braceProblem('.a {\n  color: red;\n\n.b { color: blue; }\n')).toMatch(/line 1/)
    expect(braceProblem('.a { content: "}"; }')).toBeNull()
  })
})
