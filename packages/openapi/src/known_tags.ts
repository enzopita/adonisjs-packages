import type ts from 'typescript'
import type { Problem } from './operation_docs.ts'

const READ_TAGS = new Set(['throws', 'response', 'requestBody', 'tags', 'deprecated', 'remarks'])

// Standard JSDoc tags an action can carry for its readers, which the document has no place for.
const IGNORED_TAGS = new Set(['param', 'returns', 'see', 'example', 'since'])

/**
 * A tag the generator does not read, such as a misspelled `@reponse`.
 */
export function unknownTag(tag: ts.JSDocTag): Problem[] {
  const name = tag.tagName.text

  if (READ_TAGS.has(name) || IGNORED_TAGS.has(name)) return []

  return [
    {
      code: 'OA-T008',
      severity: 'warning',
      message: `@${name} is not a tag the generator reads`,
      fix: 'use @throws, @response, @requestBody, @tags, @deprecated or @remarks',
      node: tag,
    },
  ]
}
