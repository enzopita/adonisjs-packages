import { readFileSync } from 'node:fs'
import { type Debugger, type Runtime, Session } from 'node:inspector'
import { SourceMap, type SourceMapPayload } from 'node:module'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where a function is declared in the source the app was compiled from. `line` and `column` start at 0.
 */
export interface FunctionLocation {
  file: string
  line: number
  column: number
}

type Script = Pick<Debugger.ScriptParsedEventDataType, 'url' | 'sourceMapURL'>

/**
 * The scripts V8 had parsed when they were read, by id, or why they could not be read.
 */
export type Scripts = Map<string, Script> | Error

const HANDLE = Symbol.for('@enzopita/adonisjs-openapi:locate')

function sourceMapOf({ url, sourceMapURL }: Script): SourceMapPayload | undefined {
  if (!sourceMapURL) return undefined

  if (!sourceMapURL.startsWith('data:'))
    return JSON.parse(readFileSync(new URL(sourceMapURL, url), 'utf8'))

  const [header = '', data = ''] = sourceMapURL.split(',', 2)

  return JSON.parse(
    header.endsWith(';base64') ? Buffer.from(data, 'base64').toString() : decodeURIComponent(data),
  )
}

function toPath(url: string) {
  // `/` like the TypeScript file names the location is compared with, on Windows too.
  return url.startsWith('file:') ? fileURLToPath(url).split(sep).join('/') : undefined
}

function original(script: Script, line: number, column: number): FunctionLocation | undefined {
  const payload = sourceMapOf(script)

  if (!payload) {
    const file = toPath(script.url)

    return file ? { file, line, column } : undefined
  }

  const entry = new SourceMap(payload).findEntry(line, column)

  if (!('originalSource' in entry)) return undefined

  const file = toPath(new URL(entry.originalSource, script.url).href)

  return file ? { file, line: entry.originalLine, column: entry.originalColumn } : undefined
}

/**
 * `Debugger.enable` reports every script V8 has parsed, and costs as much as their sources weigh.
 * A function's script is parsed before the function exists, so this can run long before the lookup.
 */
export function parsedScripts(): Scripts {
  const session = new Session()
  const scripts = new Map<string, Script>()

  session.on('Debugger.scriptParsed', ({ params }) => scripts.set(params.scriptId, params))

  try {
    session.connect()
    session.post('Debugger.enable')

    return scripts
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  } finally {
    session.disconnect()
  }
}

/**
 * Where V8 says each function was declared, mapped through the source map of its script. A bound
 * function is located by the function it binds. A function V8 has no script with a file for, such
 * as a native one, has no location. A failure of the inspector ends the lookup and comes back with
 * the locations found so far. A source map that cannot be read or applied fails only the functions
 * of its script, and the lookup goes on.
 */
export function locateFunctions(functions: Function[], parsed?: Scripts) {
  const found = new Map<Function, FunctionLocation>()
  const failures: Error[] = []

  if (!functions.length) return { found, failures }

  const scripts = parsed ?? parsedScripts()

  if (scripts instanceof Error) return { found, failures: [scripts] }

  const session = new Session()

  // A session on the thread it inspects calls back before `post` returns.
  const remote = () => {
    let objectId: string | undefined

    session.post(
      'Runtime.evaluate',
      { expression: `globalThis[Symbol.for(${JSON.stringify(HANDLE.description)})]` },
      (error, response) => {
        if (error) throw error
        objectId = response.result.objectId
      },
    )

    return objectId
  }

  const internals = (objectId: string) => {
    let properties: Runtime.InternalPropertyDescriptor[] = []

    session.post('Runtime.getProperties', { objectId, ownProperties: true }, (error, result) => {
      if (error) throw error
      properties = result.internalProperties ?? []
    })

    return properties
  }

  try {
    session.connect()

    for (const fn of functions) {
      Reflect.set(globalThis, HANDLE, fn)

      const objectId = remote()
      let properties = objectId ? internals(objectId) : []
      const target = properties.find(({ name }) => name === '[[TargetFunction]]')?.value?.objectId

      if (target) properties = internals(target)

      const location: Debugger.Location | undefined = properties.find(
        ({ name }) => name === '[[FunctionLocation]]',
      )?.value?.value

      const script = location && scripts.get(location.scriptId)

      try {
        const mapped = script && original(script, location.lineNumber, location.columnNumber ?? 0)

        if (mapped) found.set(fn, mapped)
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)))
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error : new Error(String(error)))
  } finally {
    Reflect.deleteProperty(globalThis, HANDLE)
    session.disconnect()
  }

  return { found, failures }
}
