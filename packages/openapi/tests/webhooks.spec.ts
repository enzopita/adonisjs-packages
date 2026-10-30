import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generateInCopy } from './support/playground.ts'

test.group('openapi:generate on the playground app: a webhook body of a named type', () => {
  test('references the named schema with no Webhook component around it', async ({ assert }) => {
    const { dir } = await generateInCopy(async copy => {
      const file = join(copy, 'app/services/webhooks.ts')
      const source = await readFile(file, 'utf8')

      await writeFile(
        file,
        source.replace(
          'export interface WebhookBodies {',
          "export interface WebhookBodies {\n  'user.synced': import('../../.adonisjs/client/data.js').Data.User",
        ),
      )
    })

    const document: OpenApiDocument = JSON.parse(await readFile(join(dir, 'openapi.json'), 'utf8'))

    assert.deepEqual(
      document.webhooks!['user.synced']!.post.requestBody!.content['application/json']!.schema,
      { $ref: '#/components/schemas/User' },
    )
    assert.notProperty(document.components.schemas, 'Webhook.user.synced')
  })
})
