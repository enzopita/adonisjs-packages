import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'

test.group('@enzopita/adonisjs-openapi/types', () => {
  test('declares the public types and no internal one', async ({ assert }) => {
    const declarations = await readFile(new URL('../build/src/types.d.ts', import.meta.url), 'utf8')

    const exported = [...declarations.matchAll(/^export (?:interface|type) (\w+)/gm)].map(
      ([, name]) => name,
    )

    assert.includeMembers(exported, [
      'OpenApiConfig',
      'OpenApiUserConfig',
      'OpenApiDocument',
      'GeneratedDocument',
      'Diagnostic',
      'DocsOptions',
    ])
    assert.notInclude(exported, 'RouteOperation')
  })
})
