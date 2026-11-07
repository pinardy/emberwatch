/**
 * Points git at the repo's own hooks (.githooks/), so the pre-commit check runs
 * for everyone who has run `npm install`. Runs as the `prepare` script.
 *
 * It never fails the install: without git, outside a work tree (a tarball, a
 * Docker layer) or in CI it does nothing.
 */
import { spawnSync } from 'node:child_process'

function git(...args) {
  try {
    return spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

const inside = git('rev-parse', '--is-inside-work-tree')
if (process.env.CI) {
  // CI runs the same checks as their own steps.
} else if (!inside || inside.status !== 0 || inside.stdout.trim() !== 'true') {
  // No git, or not a checkout: nothing to install.
} else if (git('config', 'core.hooksPath')?.stdout.trim() !== '.githooks') {
  const set = git('config', 'core.hooksPath', '.githooks')
  if (set && set.status === 0) console.log('git hooks: using .githooks/ (skip once with git commit --no-verify)')
}
