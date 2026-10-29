import { enableCompileCache, registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'
import type { prepareProgram } from '../program/create_program.ts'
import type { WorkerInput } from './document_request.ts'

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
const { answer } = await import('./document_request.ts')

let prepared: ReturnType<typeof prepareProgram> | undefined
let failure: unknown

try {
  prepared = prepare(workerData)
} catch (error) {
  failure = error
}

parentPort!.once('message', (input: WorkerInput) => {
  if (!prepared) throw failure

  parentPort!.postMessage(answer(input, prepared))
})
