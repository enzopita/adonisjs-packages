import { enableCompileCache } from 'node:module'
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

const { prepareProgram: prepare } = await import('../program/create_program.ts')
const { documentOf } = await import('./document.ts')

let createProgram: ReturnType<typeof prepareProgram> | undefined
let failure: unknown

try {
  createProgram = prepare(workerData)
} catch (error) {
  failure = error
}

parentPort!.once('message', ({ routes, located, ...input }: WorkerInput) => {
  if (!createProgram) throw failure

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
    createProgram,
    locate,
  )

  parentPort!.postMessage(document)
})
