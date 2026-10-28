import { enableCompileCache, registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'
import type { prepareProgram } from '../program/create_program.ts'
import type { FunctionLocation } from '../routes/function_location.ts'
import type { RouteOperation } from '../routes/route_operation.ts'
import type { DocumentInput } from './document.ts'

type WireRoute = Omit<RouteOperation, 'inlineMiddleware'> & {
  inlineMiddleware: (Omit<RouteOperation['inlineMiddleware'][number], 'fn'> & { fn: number })[]
}

/**
 * The document's input from the main thread, where each inline middleware is the index of its
 * function in `located`, the lookup of that function alone.
 */
export type WorkerInput = Omit<DocumentInput, 'routes'> & {
  routes: WireRoute[]
  located: { location?: FunctionLocation; failures: Error[] }[]
}

// A worker thread has a compile cache of its own, which the 9 MB TypeScript compiler loads from.
enableCompileCache()

const sources = new URL('..', import.meta.url).href
const REQUIRED = 'openapi-require:'

// Importing the CommonJS compiler makes Node scan its 9 MB for the names it exports, which the
// package never imports: its modules get what `require()` returns, on this thread only.
registerHooks({
  resolve: (specifier, context, next) => {
    const resolved = next(specifier, context)

    return specifier === 'typescript' && context.parentURL?.startsWith(sources)
      ? { url: `${REQUIRED}${resolved.url}`, shortCircuit: true }
      : resolved
  },
  load: (url, context, next) => {
    if (!url.startsWith(REQUIRED)) return next(url, context)

    const file = JSON.stringify(fileURLToPath(url.slice(REQUIRED.length)))
    const source = `export default process.getBuiltinModule('node:module').createRequire(${file})(${file})`

    return { format: 'module', source, shortCircuit: true }
  },
})

const { prepareProgram: prepare } = await import('../program/create_program.ts')
const { documentOf } = await import('./document.ts')

let prepared: ReturnType<typeof prepareProgram> | undefined
let failure: unknown

try {
  prepared = prepare(workerData)
} catch (error) {
  failure = error
}

parentPort!.once('message', ({ routes, located, ...input }: WorkerInput) => {
  if (!prepared) throw failure

  // A function cannot reach another thread: a stand-in takes the place of each one.
  const standIns = located.map((): Function => () => {})
  const indexOf = new Map(standIns.map((fn, index) => [fn, index]))

  const locate = (functions: Function[]) => {
    const found = new Map<Function, FunctionLocation>()
    const failures: Error[] = []

    for (const fn of functions) {
      const { location, failures: failed } = located[indexOf.get(fn)!]!

      if (location) found.set(fn, location)

      failures.push(...failed)
    }

    return { found, failures }
  }

  const document = documentOf(
    {
      ...input,
      routes: routes.map(route => ({
        ...route,
        inlineMiddleware: route.inlineMiddleware.map(({ fn, ...entry }) => ({
          ...entry,
          fn: standIns[fn]!,
        })),
      })),
    },
    prepared,
    locate,
  )

  parentPort!.postMessage(document)
})
