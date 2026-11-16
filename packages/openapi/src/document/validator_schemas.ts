import type { ApplicationService } from '@adonisjs/core/types'
import { unreadableValidator } from '../diagnostics/route.ts'
import type { Diagnostic, JsonSchema } from '../types.ts'
import type { RouteOperation } from '../routes/route_operation.ts'

// The keys `request.validateUsing()` adds next to the body and the query string.
const NOT_IN_BODY = new Set(['params', 'headers', 'cookies'])

// A Vine union of objects has the same shape as a merged group's input, and keeps its undocumented body.
const fromGroups = new WeakSet<JsonSchema>()

/**
 * Vine emits draft-7 object schemas, and every keyword JsonSchema names means the same there.
 */
interface VineValidator {
  toJSONSchema(): JsonSchema
}

/**
 * Vine knows the constraints (formats, bounds, enums) but has no JSON Schema for
 * files or custom rules and emits `{}` there: the TypeScript shape fills those gaps.
 */
export function mergeSchemas(vine: JsonSchema | undefined, typed: JsonSchema): JsonSchema {
  if (!vine || !Object.keys(vine).length) return typed

  const branches = groupBranches(vine)

  if (branches) {
    const merged = {
      anyOf: branches.map(branch => mergeSchemas(branch, typedBranch(branch, typed) ?? {})),
    }

    fromGroups.add(merged)

    return merged
  }

  if (vine.items) return { ...vine, items: mergeSchemas(vine.items, typed.items ?? {}) }

  if (!vine.properties) return vine

  const typedProperties = typed.properties ?? {}

  const properties = Object.fromEntries(
    Object.entries(vine.properties).map(([key, schema]) => [
      key,
      mergeSchemas(schema, typedProperties[key] ?? {}),
    ]),
  )

  // Vine leaves a `.nullable()` field out of `required`, although it rejects a body without the key.
  const required = Object.keys(properties).filter(
    key => vine.required?.includes(key) || typed.required?.includes(key),
  )

  return { ...vine, properties, ...(required.length > 0 && { required }) }
}

/**
 * Vine emits `object.merge(group)` as `{ anyOf: [...groups, object] }`, each group an `anyOf` of
 * its branches, but means the object and one branch of every group: these are the complete objects.
 */
function groupBranches(vine: JsonSchema): JsonSchema[] | undefined {
  const base = vine.anyOf?.at(-1)
  const groups = vine.anyOf?.slice(0, -1) ?? []

  const isGroup = (group: JsonSchema) => group.anyOf?.every(branch => branch.type === 'object')

  if (base?.type !== 'object' || !groups.length || !groups.every(isGroup)) return undefined

  return groups.reduce(
    (objects, group) =>
      objects.flatMap(object =>
        group.anyOf!.map(branch => {
          const required = [...(object.required ?? []), ...(branch.required ?? [])]

          return {
            ...object,
            properties: { ...object.properties, ...branch.properties },
            ...(required.length > 0 && { required }),
          }
        }),
      ),
    [base],
  )
}

/**
 * The TypeScript union member a branch is, told apart by the literals Vine emits as one-value enums.
 */
function typedBranch(branch: JsonSchema, typed: JsonSchema) {
  const literals = Object.entries(branch.properties ?? {}).filter(
    ([, schema]) => schema.enum?.length === 1,
  )

  const matches = (typed.anyOf ?? []).filter(member =>
    literals.every(([key, schema]) => member.properties?.[key]?.const === schema.enum![0]),
  )

  return matches.length === 1 ? matches[0] : undefined
}

/**
 * The `params` the input validates, which every branch of a merged group shares.
 */
export function paramsOf(input: JsonSchema | undefined) {
  return (input && fromGroups.has(input) ? input.anyOf![0] : input)?.properties?.params
}

/**
 * The part of the input that is the request body: what `params`, `headers` and `cookies` hold is not.
 */
export function bodyFields(input: JsonSchema): JsonSchema | undefined {
  if (fromGroups.has(input)) {
    const branches = input.anyOf!.map(bodyFields).filter(branch => branch !== undefined)

    return branches.length ? { anyOf: branches } : undefined
  }

  const keep = (key: string) => !NOT_IN_BODY.has(key)
  const properties = Object.entries(input.properties ?? {}).filter(([key]) => keep(key))

  if (!properties.length) return undefined

  const { required = [], ...rest } = input
  const kept = required.filter(keep)

  return kept.length
    ? { ...rest, properties: Object.fromEntries(properties), required: kept }
    : { ...rest, properties: Object.fromEntries(properties) }
}

export async function validatorSchemas(
  app: ApplicationService,
  routes: RouteOperation[],
  diagnostics: Diagnostic[],
) {
  const schemas = new Map<string, JsonSchema>()

  for (const route of routes) {
    if (!route.validator) continue

    const { specifier, exportName } = route.validator

    try {
      // SAFETY: the routes scanner only reports values passed to `request.validateUsing()`, which are Vine validators.
      const module = (await app.import(specifier)) as Record<string, VineValidator>
      const validator = module[exportName]

      if (validator) schemas.set(route.name, validator.toJSONSchema())
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      diagnostics.push(unreadableValidator(route.name, specifier, exportName, reason))
    }
  }

  return schemas
}
