import type ts from 'typescript'
import type { OperationMeta } from '../analysis/tags/operation_docs.ts'
import type { AppTypes } from '../program/app_types.ts'
import type { HttpMethod, JsonSchema, OpenApiOperation } from '../types.ts'
import type { RouteOperation } from '../routes/route_operation.ts'
import { parametersFor } from './parameters.ts'

export interface OperationParts {
  meta: OperationMeta
  requestBody?: ts.Type
  input?: JsonSchema
  fields?: JsonSchema
  responses: OpenApiOperation['responses']
  security: Record<string, string[]>[]
  operationId: string
}

export function operationFor(
  route: RouteOperation,
  method: HttpMethod,
  app: AppTypes,
  { meta, requestBody, input, fields, responses, security, operationId }: OperationParts,
): OpenApiOperation {
  const parser = app.bodyParser
  const readsQueryOnly = !parser.methods.has(method.toUpperCase())
  const validated = readsQueryOnly ? undefined : fields
  const body = requestBody ? app.schemas.convert(requestBody) : validated

  const parameters = parametersFor(
    route,
    readsQueryOnly ? fields : undefined,
    input?.properties?.params,
  )

  const operation: OpenApiOperation = {
    operationId,
    ...meta,
    responses,
  }

  if (parameters.length) operation.parameters = parameters

  if (security.length) operation.security = security

  if (body) {
    const mediaTypes = JSON.stringify(body).includes('"format":"binary"')
      ? parser.multipart
      : [...parser.json, ...parser.form, ...parser.multipart]

    operation.requestBody = {
      required: true,
      content: Object.fromEntries(mediaTypes.map(mediaType => [mediaType, { schema: body }])),
    }
  }

  return operation
}
