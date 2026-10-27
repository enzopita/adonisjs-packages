import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generatePlayground, json, object } from './support/playground.ts'

test.group('openapi:generate on the playground app: the request input', group => {
  let document: OpenApiDocument

  group.setup(async () => {
    ;({ document } = await generatePlayground())
  })

  test('documents a validator query object as a body field, not as query params', ({ assert }) => {
    const paged = document.paths['/api/v1/probe/paged']!.post!

    assert.isUndefined(paged.parameters)
    assert.deepEqual(
      paged.requestBody!.content['application/json']!.schema,
      object({ query: object({ page: { type: 'number' } }) }),
    )
    assert.deepEqual(
      json(paged.responses['200']),
      object({ query: object({ page: { type: 'number' } }) }),
    )
  })
})
