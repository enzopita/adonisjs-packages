import { fileURLToPath } from 'node:url'
import type { ApplicationService } from '@adonisjs/core/types'
import type { Router } from '@adonisjs/core/http'
import { collectRoutes } from '../routes/collect_routes.ts'
import { parsedScripts } from '../routes/function_location.ts'
import type { Diagnostic, GeneratedDocument, OpenApiConfig } from '../types.ts'

export async function generateDocument(
  app: ApplicationService,
  router: Router,
  config: OpenApiConfig,
): Promise<GeneratedDocument> {
  const diagnostics: Diagnostic[] = []
  const routes = await collectRoutes(fileURLToPath(app.appRoot), router, config, diagnostics)

  // Before the TypeScript compiler loads: `Debugger.enable` reports every script V8 has parsed, and
  // the 9 MB of the compiler would double what it costs.
  const scripts = routes.some(route => route.inlineMiddleware.length) ? parsedScripts() : undefined

  const { documentOf } = await import('./document.ts')

  return documentOf(app, routes, config, diagnostics, scripts)
}
