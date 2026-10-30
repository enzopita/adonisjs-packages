import type { ErrorsConfig, OpenApiConfig, OpenApiUserConfig, WebhooksConfig } from './types.ts'

// Where each 0.x key went, so a config that still sets one fails with the fix.
const MOVED = {
  info: 'document.info',
  servers: 'document.servers',
  tags: 'document.tags',
  securitySchemes: 'security.schemes',
  middlewareSecurity: 'security.middleware',
  errorResponse: 'errors.body',
} satisfies Record<string, string>

/**
 * Generic over `errors` so the type of the config keeps each exception the entries name: the
 * generator reads it to match the `instanceof` branches of the exception handler. Generic over
 * `webhooks` for the same reason: the generator reads the bodies from it.
 */
export function defineConfig<
  const Errors extends ErrorsConfig = {},
  Webhooks extends WebhooksConfig = never,
>(
  config: OpenApiUserConfig<Errors, Webhooks> = {},
): Omit<OpenApiConfig, 'webhooks'> & { errors: Errors; webhooks?: Webhooks } {
  if (config.routes?.only && config.routes.except) {
    throw new Error('openapi: use either "routes.only" or "routes.except", not both')
  }

  // A JavaScript config, or one typed loosely, would otherwise lose the option without a sign.
  const moved = Object.entries(MOVED).filter(([key]) => key in config)

  if (moved.length) {
    const fixes = moved.map(([key, path]) => `"${key}" is now "${path}"`).join(', ')

    throw new Error(`openapi: the config groups its keys since 1.0: ${fixes}`)
  }

  const { document, security, ...rest } = config

  return {
    output: 'openapi.json',
    routes: {},
    strict: false,
    rules: {},
    // SAFETY: `Errors` defaults to `{}`, the only value a config without `errors` can have.
    errors: {} as Errors,
    ...rest,
    document: { info: { title: 'API', version: '1.0.0' }, servers: [], tags: [], ...document },
    security: { schemes: {}, middleware: {}, ...security },
  }
}

/**
 * The `webhooks` of `defineConfig()`. `Bodies` is an exported type of the app with a key per
 * webhook and the body POSTed as its value, and `examples` holds an example body per webhook.
 */
export function defineWebhooks<Bodies extends object = never>(
  config: { examples?: WebhooksConfig<NoInfer<Bodies>>['examples'] } = {},
): WebhooksConfig<Bodies> {
  return config
}
