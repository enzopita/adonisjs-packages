import ts from 'typescript'
import { duplicateOperationId } from '../diagnostics/operation.ts'
import {
  exampleWebhookUnknown,
  webhookBodiesUnresolved,
  webhookBodyEmpty,
} from '../diagnostics/webhooks.ts'
import type { AppTypes } from '../program/app_types.ts'
import type { Diagnostic, OpenApiDocument, OpenApiOperation } from '../types.ts'
import { shared } from './operation.ts'
import type { WireWebhooks } from './webhook_examples.ts'

/**
 * One Path Item per key of the bodies type, with the body the app POSTs to its subscribers.
 * `operationIds` holds those of the paths, so a webhook cannot repeat one.
 */
export function webhooksFor(
  types: AppTypes,
  { examples }: WireWebhooks,
  operationIds: Map<string, string>,
  diagnostics: Diagnostic[],
): OpenApiDocument['webhooks'] {
  const { checker } = types
  const bodies = types.webhooks && checker.getNonNullableType(types.webhooks)

  // A type import the checker cannot resolve gives `any`, and `defineWebhooks()` with no type `never`.
  if (
    !bodies ||
    bodies.flags & ts.TypeFlags.Any ||
    !(bodies.flags & ts.TypeFlags.Object || bodies.isIntersection())
  ) {
    diagnostics.push(webhookBodiesUnresolved())

    return undefined
  }

  for (const key of Object.keys(examples))
    if (!checker.getPropertyOfType(bodies, key)) diagnostics.push(exampleWebhookUnknown(key))

  const webhooks: NonNullable<OpenApiDocument['webhooks']> = {}

  for (const property of checker.getPropertiesOfType(bodies)) {
    const name = property.getName()
    const operationId = `webhook.${name}`
    const first = operationIds.get(operationId)

    if (first === undefined) operationIds.set(operationId, `webhook ${name}`)
    else diagnostics.push(duplicateOperationId(`webhook ${name}`, operationId, first))

    const body = types.schemas.convert(checker.getTypeOfSymbol(property))
    const empty = Object.keys(body).length === 0
    const declaration = property.valueDeclaration

    if (empty) diagnostics.push(webhookBodyEmpty(name, declaration && types.locate(declaration)))

    const [summary, ...paragraphs] = ts
      .displayPartsToString(property.getDocumentationComment(checker))
      .split(/\n\s*\n/)
      .map(paragraph => paragraph.trim())
      .filter(Boolean)

    const operation: OpenApiOperation = {
      operationId,
      ...(summary && { summary }),
      ...(paragraphs.length > 0 && { description: paragraphs.join('\n\n') }),
      ...(property.getJsDocTags(checker).some(tag => tag.name === 'deprecated') && {
        deprecated: true,
      }),
      requestBody: {
        required: true,
        content: {
          'application/json': {
            // A named schema is referenced as it is, with no alias component around it.
            schema: body.$ref || empty ? body : shared(types, `Webhook.${name}`, body),
            ...(Object.hasOwn(examples, name) && { example: examples[name]! }),
          },
        },
      },
      responses: { '2XX': { description: 'Received.' } },
    }

    webhooks[name] = { post: operation }
  }

  return webhooks
}
