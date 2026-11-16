import { test } from '@japa/runner'
import type { JsonSchema } from '../../src/types.ts'
import { mergeSchemas } from '../../src/document/validator_schemas.ts'

test.group('mergeSchemas', () => {
  test('takes the TypeScript shape when Vine has no schema', ({ assert }) => {
    const typed = { type: 'string' }

    assert.deepEqual(mergeSchemas(undefined, typed), typed)
    assert.deepEqual(mergeSchemas({}, typed), typed)
  })

  test('takes the Vine schema when either side has no properties', ({ assert }) => {
    const vine = { type: 'string', format: 'email' }

    assert.deepEqual(mergeSchemas(vine, { type: 'string' }), vine)
    assert.deepEqual(
      mergeSchemas({ type: 'object', properties: { a: { type: 'string' } } }, { type: 'object' }),
      { type: 'object', properties: { a: { type: 'string' } } },
    )
  })

  test('fills a property Vine left empty from the TypeScript shape', ({ assert }) => {
    const merged = mergeSchemas(
      { type: 'object', properties: { avatar: {}, name: { type: 'string', format: 'email' } } },
      {
        type: 'object',
        properties: { avatar: { type: 'string', format: 'binary' }, name: { type: 'string' } },
      },
    )

    assert.deepEqual(merged.properties, {
      avatar: { type: 'string', format: 'binary' },
      name: { type: 'string', format: 'email' },
    })
  })

  test('merges nested objects', ({ assert }) => {
    const merged = mergeSchemas(
      { type: 'object', properties: { profile: { type: 'object', properties: { bio: {} } } } },
      {
        type: 'object',
        properties: { profile: { type: 'object', properties: { bio: { type: 'string' } } } },
      },
    )

    assert.deepEqual(merged.properties?.profile?.properties, { bio: { type: 'string' } })
  })

  test('drops the property only the TypeScript shape has', ({ assert }) => {
    const merged = mergeSchemas(
      { type: 'object', properties: { a: { type: 'string' } } },
      { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } },
    )

    assert.deepEqual(Object.keys(merged.properties!), ['a'])
  })

  test('requires the properties either side requires', ({ assert }) => {
    const properties = { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } }

    const merged = mergeSchemas(
      { type: 'object', properties, required: ['a'] },
      { type: 'object', properties, required: ['b', 'zzz'] },
    )

    assert.deepEqual(merged.required, ['a', 'b'])
  })

  test('has no required keyword when neither side requires a property', ({ assert }) => {
    const merged = mergeSchemas(
      { type: 'object', properties: { a: { type: 'string' } } },
      { type: 'object', properties: { a: { type: 'string' } } },
    )

    assert.notProperty(merged, 'required')
  })

  test('merges an object with every branch of its groups', ({ assert }) => {
    const branch = (key: string) => ({
      type: 'object',
      properties: { [key]: { type: 'string' } },
      required: [key],
    })

    const merged = mergeSchemas(
      {
        anyOf: [
          { anyOf: [branch('a'), branch('b')] },
          { anyOf: [branch('c')] },
          { ...branch('base'), additionalProperties: false },
        ],
      },
      {},
    )

    assert.deepEqual(
      merged.anyOf?.map(object => [object.required, object.additionalProperties]),
      [
        [['base', 'a', 'c'], false],
        [['base', 'b', 'c'], false],
      ],
    )
  })

  test('fills a group branch from the union member with the same literal', ({ assert }) => {
    const branch = (channel: string) => ({
      type: 'object',
      properties: { channel: { type: 'string', enum: [channel] }, file: {} },
    })

    const member = (channel: string, format: string) => ({
      type: 'object',
      properties: { channel: { type: 'string', const: channel }, file: { type: 'string', format } },
    })

    const merged = mergeSchemas(
      { anyOf: [{ anyOf: [branch('rcs'), branch('sms')] }, { type: 'object', properties: {} }] },
      { anyOf: [member('sms', 'sms'), member('rcs', 'rcs')] },
    )

    assert.deepEqual(
      merged.anyOf?.map(object => object.properties?.file),
      [
        { type: 'string', format: 'rcs' },
        { type: 'string', format: 'sms' },
      ],
    )
  })

  test('keeps a group branch no union member matches as Vine emits it', ({ assert }) => {
    const vineBranch = { type: 'object', properties: { file: {} } }

    const merged = mergeSchemas(
      { anyOf: [{ anyOf: [vineBranch] }, { type: 'object', properties: {} }] },
      {
        anyOf: [
          { type: 'object', properties: { file: { type: 'string' } } },
          { type: 'object', properties: { file: { type: 'number' } } },
        ],
      },
    )

    assert.deepEqual(merged.anyOf, [vineBranch])
  })

  test('merges an object with its groups in array items and group branches', ({ assert }) => {
    const merged: JsonSchema = {
      anyOf: [
        { anyOf: [{ type: 'object', properties: { a: {} }, required: ['a'] }] },
        { type: 'object', properties: { base: {} }, required: ['base'] },
      ],
    }

    const schema = mergeSchemas(
      {
        anyOf: [
          { anyOf: [{ type: 'object', properties: { list: { type: 'array', items: merged } } }] },
          { type: 'object', properties: {} },
        ],
      },
      {},
    )

    assert.deepEqual(schema.anyOf?.[0]?.properties?.list?.items, {
      anyOf: [{ type: 'object', properties: { base: {}, a: {} }, required: ['base', 'a'] }],
    })
  })

  test('keeps a union of objects as Vine emits it', ({ assert }) => {
    const union: JsonSchema = {
      anyOf: [
        { type: 'object', properties: { a: {} } },
        { type: 'object', properties: { b: {} } },
      ],
    }

    assert.deepEqual(mergeSchemas(union, { anyOf: [{ type: 'object' }] }), union)
  })
})
