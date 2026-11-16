import type { MiddlewareSecurity, SecurityConfig } from '../types.ts'
import type { RouteOperation } from '../routes/route_operation.ts'

interface Accepted {
  scheme: string
  notWith: string[]
  onlyWith?: string[]
}

// The schemes any one of which passes the middleware.
function accepted(entry: MiddlewareSecurity): Accepted[] {
  if (Array.isArray(entry)) return entry.flatMap(accepted)

  if (entry instanceof Object) return [{ notWith: [], ...entry }]

  return [{ scheme: entry, notWith: [] }]
}

/**
 * The middleware of a route that map to a scheme, and the `security` they give the operation.
 * Entries of `security` are alternatives: one per way of passing every mapped middleware, holding
 * the schemes it requires together, less those that another scheme of the entry makes unnecessary.
 * A way that holds a scheme without any of its `onlyWith` is not one.
 */
export function securityFor(route: RouteOperation, middleware: SecurityConfig['middleware']) {
  const secured = route.middleware.filter(name => middleware[name])
  const entries = secured.map(name => accepted(middleware[name]!))

  if (!entries.length) return { secured, security: [] }

  const combinations = entries.reduce<Accepted[][]>(
    (sets, entry) => sets.flatMap(set => entry.map(scheme => [...set, scheme])),
    [[]],
  )

  const requirements = new Map(
    combinations.flatMap(set => {
      const names = set.map(({ scheme }) => scheme)
      const holds = (others: string[]) => others.some(other => names.includes(other))

      if (set.some(({ onlyWith }) => onlyWith && !holds(onlyWith))) return []

      const kept = [
        ...new Set(set.filter(({ notWith }) => !holds(notWith)).map(({ scheme }) => scheme)),
      ]

      return [[kept.toSorted().join(' '), kept] as const]
    }),
  )

  const security = [...requirements.values()].map(set =>
    Object.fromEntries(set.map((scheme): [string, string[]] => [scheme, []])),
  )

  return { secured, security }
}
