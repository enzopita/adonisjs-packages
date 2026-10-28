import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { readBodyParser } from '../../src/program/body_parser.ts'

async function configFile(source: string) {
  const file = join(await mkdtemp(join(tmpdir(), 'bodyparser-')), 'bodyparser.ts')
  await writeFile(file, source)

  return file
}

test.group('readBodyParser', () => {
  test('reads the methods and the parser types written as literals', async ({ assert }) => {
    const parser = readBodyParser(
      await configFile(`
        import { defineConfig } from '@adonisjs/core/bodyparser'

        export default defineConfig({
          allowedMethods: ['POST'],
          json: { types: ['application/json'] },
          form: { types: [] },
          multipart: { autoProcess: true },
        })
      `),
    )

    assert.deepEqual([...parser.methods], ['POST'])
    assert.deepEqual(parser.json, ['application/json'])
    assert.deepEqual(parser.form, [])
    assert.deepEqual(parser.multipart, ['multipart/form-data'])
  })

  test('keeps the default of a setting that is not a literal array of strings', async ({
    assert,
  }) => {
    const parser = readBodyParser(
      await configFile(`
        const types = ['application/json']

        export default defineConfig({ json: { types }, form: { types: [...types, 'text/x'] } })
      `),
    )

    assert.lengthOf(parser.json, 4)
    assert.deepEqual(parser.form, ['application/x-www-form-urlencoded'])
  })

  test('falls back to the bodyparser defaults without a config file', ({ assert }) => {
    const parser = readBodyParser(join(tmpdir(), 'missing', 'bodyparser.ts'))

    assert.deepEqual([...parser.methods], ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.deepEqual(parser.form, ['application/x-www-form-urlencoded'])
  })
})
