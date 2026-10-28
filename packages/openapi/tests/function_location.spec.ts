import { Session } from 'node:inspector'
import { SourceMap } from 'node:module'
import ts from 'typescript'
import { test } from '@japa/runner'
import { locateFunctions } from '../src/routes/function_location.ts'
import { inlineMiddleware } from '../src/routes/inline_middleware.ts'

test.group('locateFunctions', group => {
  const { connect, post } = Session.prototype
  const { findEntry } = SourceMap.prototype

  group.each.teardown(() => {
    Session.prototype.connect = connect
    Session.prototype.post = post
    SourceMap.prototype.findEntry = findEntry
  })

  const failConnect = () => {
    Session.prototype.connect = () => {
      throw new Error('Inspector is not available')
    }
  }

  test('locates nothing without an inspector, and says why', ({ assert }) => {
    failConnect()

    const { found, failure } = locateFunctions([() => {}])

    assert.equal(found.size, 0)
    assert.equal(failure?.message, 'Inspector is not available')
  })

  test('locates nothing when the inspector protocol fails, and says why', ({ assert }) => {
    Session.prototype.post = (...args: unknown[]) => {
      const callback = args.at(-1)

      if (callback instanceof Function) callback(new Error('protocol failure'))
    }

    const { found, failure } = locateFunctions([() => {}])

    assert.equal(found.size, 0)
    assert.equal(failure?.message, 'protocol failure')
  })

  test('says why when the mapping of a location throws', ({ assert }) => {
    SourceMap.prototype.findEntry = () => {
      throw new Error('mapping failure')
    }

    const { failure } = locateFunctions([() => {}])

    assert.equal(failure?.message, 'mapping failure')
  })

  test('reports no failure when every function is located', ({ assert }) => {
    const { found, failure } = locateFunctions([() => {}])

    assert.equal(found.size, 1)
    assert.isUndefined(failure)
  })

  test('reports a failed lookup once, and still answers', ({ assert }) => {
    failConnect()

    const middleware = [() => 1, () => 2].map(fn => ({ source: fn.toString(), fn }))
    const { find, diagnostics } = inlineMiddleware(ts.createProgram([], {}), middleware)

    for (const each of middleware) assert.deepEqual(find(each), { kind: 'missing' })

    assert.lengthOf(diagnostics, 1)
    assert.equal(diagnostics[0]!.code, 'OA-R005')
    assert.include(diagnostics[0]!.message, 'Inspector is not available')
  })
})
