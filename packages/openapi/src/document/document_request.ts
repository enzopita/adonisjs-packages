import type { prepareProgram } from '../program/create_program.ts'
import type { ProgramInput } from '../program/parsed_files.ts'
import type { FunctionLocation } from '../routes/function_location.ts'
import type { RouteOperation } from '../routes/route_operation.ts'
import type { GeneratedDocument } from '../types.ts'
import { documentOf, type DocumentInput } from './document.ts'

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

/**
 * The document, and what to rebuild the program cache from when it is missing or stale.
 */
export interface WorkerAnswer {
  generated: GeneratedDocument
  cacheInput: ProgramInput | undefined
}

export function answer(
  { routes, located, ...input }: WorkerInput,
  prepared: ReturnType<typeof prepareProgram>,
): WorkerAnswer {
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

  const generated = documentOf(
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

  return { generated, cacheInput: prepared.cacheInput }
}
