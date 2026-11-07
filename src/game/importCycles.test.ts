import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * No runtime import cycles in src/game. A cycle makes module load order
 * matter (a function imported from a half-initialised module is undefined at
 * import time) and is usually a sign two modules each own half of an idea.
 * Type-only imports are erased at build time, so they may close a loop.
 * Dynamic `import()` is a lazy edge and is not counted either.
 */

// Typechecked by tsconfig.node.json, for the Node types.
const GAME = import.meta.dirname
const SRC = resolve(GAME, '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** True when an import or export statement brings in values (not only types). */
function isRuntime(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (!clause) return true // `import './x'` runs the module
    if (clause.isTypeOnly) return false
    if (clause.name) return true
    const bindings = clause.namedBindings
    if (!bindings || ts.isNamespaceImport(bindings)) return true
    return bindings.elements.length === 0 || bindings.elements.some((e) => !e.isTypeOnly)
  }
  if (node.isTypeOnly) return false
  const clause = node.exportClause
  return !clause || !ts.isNamedExports(clause) || clause.elements.some((e) => !e.isTypeOnly)
}

/** Module -> the modules it imports at runtime, for every source under `dir`. */
function runtimeImportGraph(dir: string): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  for (const file of sources(dir)) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false)
    const deps = new Set<string>()
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
      const spec = statement.moduleSpecifier
      if (!spec || !ts.isStringLiteral(spec) || !isRuntime(statement)) continue
      const target = resolveImport(file, spec.text)
      if (target && target.startsWith(dir)) deps.add(target)
    }
    graph.set(file, deps)
  }
  return graph
}

/** Strongly connected groups of more than one module (or a module importing itself). */
function importCycles(graph: Map<string, Set<string>>): string[][] {
  let counter = 0
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const groups: string[][] = []
  const visit = (v: string) => {
    index.set(v, counter)
    low.set(v, counter)
    counter++
    stack.push(v)
    onStack.add(v)
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!))
      }
    }
    if (low.get(v) === index.get(v)) {
      const group: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        group.push(w)
      } while (w !== v)
      if (group.length > 1 || graph.get(v)?.has(v)) groups.push(group.sort())
    }
  }
  for (const v of graph.keys()) if (!index.has(v)) visit(v)
  return groups
}

describe('import cycles', () => {
  it('finds a cycle when there is one', () => {
    const graph = new Map([
      ['a', new Set(['b'])],
      ['b', new Set(['c'])],
      ['c', new Set(['a'])],
      ['d', new Set(['a'])],
    ])
    expect(importCycles(graph)).toEqual([['a', 'b', 'c']])
  })

  it('src/game has no runtime import cycles', () => {
    const graph = runtimeImportGraph(GAME)
    // The scan must really be reading the engine, or an empty graph would pass.
    const edges = [...graph.values()].reduce((n, deps) => n + deps.size, 0)
    expect(graph.size).toBeGreaterThan(50)
    expect(edges).toBeGreaterThan(200)
    const cycles = importCycles(graph).map((group) => group.map((f) => relative(SRC, f)))
    expect(cycles).toEqual([])
  })
})
