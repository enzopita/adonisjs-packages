import type { NamedErrors } from '../analysis/errors/named_errors.ts'
import { operationDocs, type OperationDocs } from '../analysis/tags/operation_docs.ts'
import { duplicateOperationId } from '../diagnostics/operation.ts'
import { lucidModel, noJsonSchema } from '../diagnostics/route.ts'
import { readApp } from '../program/app_types.ts'
import type { prepareProgram } from '../program/create_program.ts'
import type { RouteOperation } from '../routes/route_operation.ts'
import type { locateFunctions } from '../routes/function_location.ts'
import type {
  Diagnostic,
  GeneratedDocument,
  JsonSchema,
  OpenApiConfig,
  OpenApiDocument,
} from '../types.ts'
import { errorCodes } from './error_codes.ts'
import { operationFor } from './operation.ts'
import { operationRules } from './operation_rules.ts'
import { ResponseComponents } from './response_components.ts'
import { responsesFor } from './responses/responses.ts'
import { securityFor } from './security.ts'
import { bodyFields, mergeSchemas } from './validator_schemas.ts'

const NO_DOCS: OperationDocs = { meta: {}, throws: [], responses: [], examples: [], problems: [] }

/**
 * What the document reads from the running app and its config, which a worker thread can receive:
 * `operationIds` are those of each route, by method, and `diagnostics` the ones found so far.
 */
export interface DocumentInput {
  appRoot: string
  configFile: string
  routes: RouteOperation[]
  operationIds: string[][]
  config: Omit<OpenApiConfig, 'routes' | 'operationId' | 'errors'> & { errors: NamedErrors }
  vine: Map<string, JsonSchema>
  diagnostics: Diagnostic[]
}

export function documentOf(
  {
    appRoot,
    configFile,
    routes,
    operationIds: routeOperationIds,
    config,
    vine,
    diagnostics,
  }: DocumentInput,
  createProgram: ReturnType<typeof prepareProgram>,
  locateInline?: typeof locateFunctions,
): GeneratedDocument {
  const types = readApp(createProgram, appRoot, routes, config.errors, configFile, locateInline)
  const routeIndex = new Map(routes.map((route, index) => [route, index]))

  const paths: OpenApiDocument['paths'] = {}
  const provenance: GeneratedDocument['provenance'] = {}
  const components = new ResponseComponents(appRoot)
  const operationIds = new Map<string, string>()

  // A route with an optional param has a path without it too, which shares everything else.
  for (const [name, variants] of Map.groupBy(routes, route => route.name)) {
    const route = variants[0]!
    const { request, response } = types.routeTypes(name)
    const input = request && mergeSchemas(vine.get(name), types.schemas.convert(request))
    const fields = input && bodyFields(input)
    const controller = types.handler(route)

    const docs = controller
      ? operationDocs(types.tags, controller.declaration, controller.method)
      : NO_DOCS

    diagnostics.push(
      ...docs.problems.map((problem): Diagnostic => ({ ...problem, route: name })),
      ...operationRules(
        name,
        docs.meta,
        config,
        controller && types.locate(controller.method.name),
      ),
    )

    const { secured, security } = securityFor(route, config.security.middleware)

    const { responses, sources } = responsesFor(route, types, controller, response, docs, secured, {
      diagnostics,
      components,
    })

    provenance[name] = sources

    for (const variant of variants) {
      const methods = paths[variant.path] ?? {}
      paths[variant.path] = methods

      for (const [index, method] of variant.methods.entries()) {
        const operationId = routeOperationIds[routeIndex.get(variant)!]![index]!
        const first = operationIds.get(operationId)

        if (first === undefined)
          operationIds.set(operationId, `${method.toUpperCase()} ${variant.path}`)
        else diagnostics.push(duplicateOperationId(name, operationId, first))

        methods[method] = operationFor(variant, method, types, {
          operationId,
          meta: docs.meta,
          requestBody: docs.requestBody,
          input,
          fields,
          responses,
          security,
        })
      }
    }
  }

  diagnostics.push(
    ...types.exceptions.diagnostics,
    ...types.errors.diagnostics,
    ...types.inlineDiagnostics,
  )

  for (const type of types.schemas.unsupported) diagnostics.push(noJsonSchema(type))

  for (const model of types.schemas.models) diagnostics.push(lucidModel(model))

  const responses = components.responses()

  const document: OpenApiDocument = {
    openapi: '3.1.0',
    info: config.document.info,
    paths,
    components: {
      schemas: types.schemas.components,
      ...(Object.keys(responses).length > 0 && { responses }),
      securitySchemes: config.security.schemes,
    },
  }

  const codes = errorCodes(document)

  if (codes.length && !('ErrorCode' in document.components.schemas))
    document.components.schemas = {
      ...document.components.schemas,
      ErrorCode: { type: 'string', enum: codes },
    }

  if (config.document.servers.length) document.servers = config.document.servers

  if (config.document.tags.length) document.tags = config.document.tags

  return {
    document,
    diagnostics,
    provenance,
  }
}
