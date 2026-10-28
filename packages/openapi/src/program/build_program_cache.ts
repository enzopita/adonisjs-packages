import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { setPriority } from 'node:os'
import { basename, dirname, join } from 'node:path'

/**
 * Run detached by `ProgramCache.rebuild()` as `node build_program_cache.js <builder> <blob> <input>`:
 * builds the snapshot into a file of its own and renames it to `blob`, so a run reads a whole
 * snapshot or none. One build at a time takes the lock; a lock older than a build can take is stale.
 */
// SAFETY: `ProgramCache.rebuild()` passes the three.
const [builder, blob, input] = process.argv.slice(2) as [string, string, string]
const lock = `${blob}.lock`
const STALE_LOCK_MS = 10 * 60_000

// Builds while the user works: the snapshot only speeds up a later run.
setPriority(19)

function acquire() {
  try {
    closeSync(openSync(lock, 'wx'))

    return true
  } catch {
    if (Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) < STALE_LOCK_MS)
      return false

    rmSync(lock, { force: true })
    closeSync(openSync(lock, 'wx'))

    return true
  }
}

// Other snapshots are of another Node.js or TypeScript, which no run of this one reads, and files
// left by builds that were stopped.
function prune() {
  const dir = dirname(blob)

  for (const name of readdirSync(dir)) {
    const file = join(dir, name)

    const stale =
      /^program-[0-9a-f]{16}\.blob$/.test(name) ||
      (/\.(tmp|json)$/.test(name) &&
        Date.now() - (statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0) > STALE_LOCK_MS)

    if (name !== basename(blob) && stale) rmSync(file, { force: true })
  }
}

const temporary = `${blob}.${process.pid}.tmp`

try {
  if (acquire()) {
    try {
      const { status } = spawnSync(
        process.execPath,
        ['--snapshot-blob', temporary, '--build-snapshot', builder, input],
        { stdio: 'ignore', windowsHide: true },
      )

      if (status === 0) {
        renameSync(temporary, blob)
        prune()
      }
    } finally {
      rmSync(lock, { force: true })
    }
  }
} catch {
  // A snapshot that cannot be built leaves the runs as they were.
} finally {
  rmSync(temporary, { force: true })
  rmSync(input, { force: true })
}
