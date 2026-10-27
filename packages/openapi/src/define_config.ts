import type { ErrorsConfig, OpenApiConfig } from './types.ts'

/**
 * Generic over `errors` so the type of the config keeps each exception the entries name: the
 * generator reads it to match the `instanceof` branches of the exception handler.
 */
export function defineConfig<const Errors extends ErrorsConfig = {}>(
  config: Partial<Omit<OpenApiConfig, 'errors'>> & { errors?: Errors } = {},
): OpenApiConfig & { errors: Errors } {
  if (config.routes?.only && config.routes.except) {
    throw new Error('openapi: use either "routes.only" or "routes.except", not both')
  }

  return {
    output: 'openapi.json',
    info: { title: 'API', version: '1.0.0' },
    servers: [],
    tags: [],
    routes: {},
    securitySchemes: {},
    middlewareSecurity: {},
    // SAFETY: `Errors` defaults to `{}`, the only value a config without `errors` can have.
    errors: {} as Errors,
    ...config,
  }
}
