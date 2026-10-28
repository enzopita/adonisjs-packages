import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { debuglog } from 'node:util'
import type { ProgramInput } from './parsed_files.ts'

const log = debuglog('openapi')

// Both run as files of their own: the build compiles them next to this one.
const builder = fileURLToPath(new URL('./program_snapshot.cjs', import.meta.url))
const buildScript = fileURLToPath(new URL('./build_program_cache.js', import.meta.url))
const typescript = createRequire(import.meta.url).resolve('typescript')

/**
 * The startup snapshot that holds TypeScript and the source files of an earlier run, parsed and
 * bound, under `node_modules/.cache/adonisjs-openapi` of the app, or the folder
 * `ADONISJS_OPENAPI_CACHE` names. `ADONISJS_OPENAPI_CACHE=false` turns it off.
 */
export interface ProgramCache {
  blob: string
  exists: boolean
  /**
   * Rebuilds the snapshot from `input` in a detached, low-priority process, when this run is
   * interactive (a terminal, outside CI) or the cache folder was named.
   */
  rebuild(input: ProgramInput): void
  discard(): void
}

export function programCache(appRoot: string): ProgramCache | undefined {
  const setting = process.env.ADONISJS_OPENAPI_CACHE
  const named = setting !== undefined && isAbsolute(setting)

  if (setting !== undefined && !named && setting !== 'true') {
    log('program cache: off')

    return undefined
  }

  // Run from its TypeScript sources, as in its own tests, the package cannot start from a snapshot.
  if (extname(import.meta.url) !== '.js') return undefined

  const modules = join(appRoot, 'node_modules')

  if (!named && !existsSync(modules)) return undefined

  const dir = named ? setting : join(modules, '.cache', 'adonisjs-openapi')
  const fingerprint = fingerprintOf()

  if (!fingerprint) return undefined

  const blob = join(dir, `program-${fingerprint}.blob`)
  const exists = existsSync(blob)

  log('program cache: %s %s', blob, exists ? 'found' : 'missing')

  return {
    blob,
    exists,
    rebuild(input) {
      const interactive = process.stdout.isTTY && !process.env.CI

      if (!named && !interactive) return

      try {
        mkdirSync(dir, { recursive: true })

        const inputFile = `${blob}.${process.pid}.json`
        writeFileSync(inputFile, JSON.stringify({ ...input, typescript }))

        const child = spawn(process.execPath, [buildScript, builder, blob, inputFile], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: withoutNodeOptions(),
        })

        child.on('error', () => undefined)
        child.unref()
        log('program cache: building %s', blob)
      } catch (error) {
        log('program cache: cannot build %s: %s', blob, error)
      }
    },
    discard() {
      try {
        rmSync(blob, { force: true })
      } catch {
        // Left for the next build to replace.
      }
    },
  }
}

// A snapshot starts only in the Node.js binary that built it, and holds this compiler and builder.
function fingerprintOf() {
  try {
    const { size, mtimeMs } = statSync(typescript)

    return createHash('sha256')
      .update(
        JSON.stringify([
          process.execPath,
          process.version,
          process.arch,
          typescript,
          size,
          mtimeMs,
        ]),
      )
      .update(readFileSync(builder))
      .digest('hex')
      .slice(0, 16)
  } catch {
    return undefined
  }
}

/**
 * The environment of the processes the cache starts, which run the package's own code alone: the
 * options of `NODE_OPTIONS`, such as `--import` hooks of the app, do not apply to them.
 */
export function withoutNodeOptions() {
  const { NODE_OPTIONS: _, ...env } = process.env

  return env
}
