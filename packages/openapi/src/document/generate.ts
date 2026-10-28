import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { ApplicationService } from '@adonisjs/core/types'
import type { Router } from '@adonisjs/core/http'
import { namedErrors } from '../analysis/errors/named_errors.ts'
import { locateFunctions, parsedScripts } from '../routes/function_location.ts'
import type { Diagnostic, GeneratedDocument, OpenApiConfig } from '../types.ts'
import type { WorkerInput } from './document_request.ts'
import { operationIdFor } from './operation_id.ts'
import { validatorSchemas } from './validator_schemas.ts'

// The build compiles each source next to the others, so the worker has the extension of this file.
const workerFile = new URL(`./document_worker${extname(import.meta.url)}`, import.meta.url)

/**
 * Starts parsing the app's program on a worker thread, which reads the document's types once the
 * app it was started for gives its routes to `generate()`. Starting it before the app boots lets
 * the TypeScript compiler parse the app's sources while the app boots.
 */
export function prepareDocument(appRoot: string) {
  const worker = new Worker(workerFile, { workerData: appRoot })

  // Waited for only while `generate()` runs: an app that fails to boot exits without it.
  worker.unref()

  const result = new Promise<GeneratedDocument>((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', code =>
      reject(new Error(`openapi: the document worker exited with code ${code}`)),
    )
  })

  // Read by `generate()` only: a failure before it, which stops the worker, is the one it throws.
  result.catch(() => undefined)

  return {
    async generate(
      app: ApplicationService,
      router: Router,
      config: OpenApiConfig,
    ): Promise<GeneratedDocument> {
      try {
        const diagnostics: Diagnostic[] = []
        const { collectRoutes } = await import('../routes/collect_routes.ts')
        const routes = await collectRoutes(appRoot, router, config, diagnostics)
        const vine = await validatorSchemas(app, routes, diagnostics)

        const unique = [
          ...new Set(routes.flatMap(route => route.inlineMiddleware.map(({ fn }) => fn))),
        ]

        const scripts = unique.length ? parsedScripts() : undefined

        // Each function alone, for the worker to tell the failures of those it looks up.
        const located = unique.map(fn => {
          const { found, failures } = locateFunctions([fn], scripts)

          return { location: found.get(fn), failures }
        })

        // In the order the document reads them, for an `operationId()` that keeps count.
        const operationIds = new Map(
          [...Map.groupBy(routes, route => route.name).values()]
            .flat()
            .map(route => [
              route,
              route.methods.map(method => operationIdFor(route, method, config.operationId)),
            ]),
        )

        const { routes: _, operationId: __, errors, ...rest } = config

        const input: WorkerInput = {
          appRoot,
          configFile: app.configPath('openapi.ts'),
          routes: routes.map(route => ({
            ...route,
            inlineMiddleware: route.inlineMiddleware.map(({ fn, ...entry }) => ({
              ...entry,
              fn: unique.indexOf(fn),
            })),
          })),
          operationIds: routes.map(route => operationIds.get(route)!),
          config: { ...rest, errors: namedErrors(errors) },
          vine,
          diagnostics,
          located,
        }

        worker.ref()
        worker.postMessage(input)

        return await result
      } finally {
        await worker.terminate()
      }
    },
  }
}

export async function generateDocument(
  app: ApplicationService,
  router: Router,
  config: OpenApiConfig,
): Promise<GeneratedDocument> {
  return prepareDocument(fileURLToPath(app.appRoot)).generate(app, router, config)
}
