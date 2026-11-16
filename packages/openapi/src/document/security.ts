import type { MiddlewareSecurity, SecurityConfig } from '../types.ts'
import type { RouteOperation } from '../routes/route_operation.ts'

// The schemes any one of which passes the middleware, and those that make its scheme unnecessary.
function accepted(entry: MiddlewareSecurity) {
  if (Array.isArray(entry)) return { schemes: entry, notWith: [] }

  if (entry instanceof Object) return { schemes: [entry.scheme], notWith: entry.notWith }

  return { schemes: [entry], notWith: [] }
}

/**
 * The middleware of a route that map to a scheme, and the `security` they give the operation.
 * Entries of `security` are alternatives: one per way of passing every mapped middleware, holding
 * the schemes it requires together, less those that another scheme of the entry makes unnecessary.
 */
export function securityFor(route: RouteOperation, middleware: SecurityConfig['middleware']) {
  const secured = route.middleware.filter(name => middleware[name])
  const entries = secured.map(name => accepted(middleware[name]!))

  if (!entries.length) return { secured, security: [] }

  const combinations = entries.reduce<string[][]>(
    (sets, entry) => sets.flatMap(set => entry.schemes.map(scheme => [...set, scheme])),
    [[]],
  )

  const notWith = new Map(
    entries.flatMap(entry => entry.schemes.map(scheme => [scheme, entry.notWith] as const)),
  )

  const requirements = new Map(
    combinations.map(set => {
      const kept = [
        ...new Set(set.filter(scheme => !notWith.get(scheme)?.some(other => set.includes(other)))),
      ]

      return [kept.toSorted().join(' '), kept]
    }),
  )

  const security = [...requirements.values()].map(set =>
    Object.fromEntries(set.map((scheme): [string, string[]] => [scheme, []])),
  )

  return { secured, security }
}
