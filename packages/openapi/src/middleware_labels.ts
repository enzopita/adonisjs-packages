import type { ApplicationService } from '@adonisjs/core/types'

/**
 * The module an `errors.middleware` key such as `#start/limiter` names exports the middleware a
 * route uses, such as the `throttle` of `limiter.define()`: each value it exports is labelled
 * with the key, so the route lists it by that key.
 */
export async function middlewareLabels(app: ApplicationService, keys: string[]) {
  const labels = new Map<unknown, string>()

  // A key without a slash is the name of a named middleware, not a module.
  for (const key of keys.filter(candidate => candidate.includes('/'))) {
    try {
      const module: object = await app.import(key)

      for (const value of Object.values(module)) labels.set(value, key)
    } catch {}
  }

  return labels
}
