import { test } from '@japa/runner'
import type { RouteOperation } from '../../src/routes/route_operation.ts'
import { securityFor } from '../../src/document/security.ts'

// SAFETY: `securityFor` only reads the route's `middleware`.
const behind = (...middleware: string[]) => ({ middleware }) as RouteOperation

test.group('securityFor', () => {
  test('requires the schemes of every mapped middleware together', ({ assert }) => {
    assert.deepEqual(
      securityFor(behind('auth', 'tenant', 'throttle'), { auth: 'accessToken', tenant: 'tenant' }),
      { secured: ['auth', 'tenant'], security: [{ accessToken: [], tenant: [] }] },
    )
  })

  test('lists one requirement per scheme a middleware accepts', ({ assert }) => {
    assert.deepEqual(
      securityFor(behind('auth', 'tenant'), {
        auth: ['accessToken', 'apiKey'],
        tenant: 'tenant',
      }).security,
      [
        { accessToken: [], tenant: [] },
        { apiKey: [], tenant: [] },
      ],
    )
  })

  test('leaves out a scheme that another scheme of the requirement makes unnecessary', ({
    assert,
  }) => {
    const middleware = {
      auth: ['accessToken', 'apiKey'],
      tenant: { scheme: 'tenant', notWith: ['apiKey'] },
    }

    assert.deepEqual(securityFor(behind('auth', 'tenant'), middleware).security, [
      { accessToken: [], tenant: [] },
      { apiKey: [] },
    ])
    assert.deepEqual(securityFor(behind('tenant'), middleware).security, [{ tenant: [] }])
  })

  test('lists a requirement two combinations share once', ({ assert }) => {
    assert.deepEqual(
      securityFor(behind('auth', 'tenant'), {
        auth: ['accessToken', 'apiKey'],
        tenant: { scheme: 'tenant', notWith: ['accessToken', 'apiKey'] },
      }).security,
      [{ accessToken: [] }, { apiKey: [] }],
    )
  })

  test('gives a route behind no mapped middleware no security', ({ assert }) => {
    assert.deepEqual(securityFor(behind('throttle'), { auth: 'accessToken' }), {
      secured: [],
      security: [],
    })
  })
})
