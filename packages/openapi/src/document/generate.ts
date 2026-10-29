import { fileURLToPath } from 'node:url'
import type { ApplicationService } from '@adonisjs/core/types'
import type { Router } from '@adonisjs/core/http'
import { namedErrors } from '../analysis/errors/named_errors.ts'
import { locateFunctions, parsedScripts } from '../routes/function_location.ts'
import type { Diagnostic, GeneratedDocument, OpenApiConfig } from '../types.ts'
import { programCache } from '../program/program_cache.ts'
import type { WorkerInput } from './document_request.ts'
import { startRunner } from './document_runner.ts'
import { operationIdFor } from './operation_id.ts'
import { validatorSchemas } from './validator_schemas.ts'

/**
 * Starts parsing the app's program off the main thread, which reads the document's types once the
 * app it was started for gives its routes to `generate()`. Starting it before the app boots lets
 * the TypeScript compiler parse the app's sources while the app boots; the program cache, when it
 * holds the files of an earlier run, spares most of that parse.
 */
export function prepareDocument(appRoot: string) {
  const cache = programCache(appRoot)
  const runner = startRunner(appRoot, cache)

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

        runner.ref()
        runner.post(input)

        const { generated, cacheInput } = await runner.answer

        if (cache && cacheInput) cache.rebuild(cacheInput)

        return generated
      } finally {
        await runner.stop()
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
