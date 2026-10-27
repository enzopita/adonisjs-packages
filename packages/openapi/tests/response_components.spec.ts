import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generatePlayground, json, object } from './support/playground.ts'

const emailTaken = object({
  code: { type: 'string', const: 'E_EMAIL_TAKEN' },
  message: { type: 'string' },
})

const emailNotVerified = object({
  code: { type: 'string', const: 'E_EMAIL_NOT_VERIFIED' },
  message: { type: 'string' },
})

test.group('openapi:generate on the playground app: responses described once', group => {
  let document: OpenApiDocument

  group.setup(async () => {
    ;({ document } = await generatePlayground())
  })

  const probe = (path: string) => document.paths[`/api/v1/probe/${path}`]!.get!

  test('references the response of an exception described in its doc comment', ({ assert }) => {
    assert.deepEqual(document.paths['/api/v1/auth/signup']!.post!.responses['409'], {
      $ref: '#/components/responses/EmailTakenException',
    })
    assert.deepEqual(document.components.responses?.EmailTakenException, {
      description: 'Another account uses this email address',
      content: { 'application/json': { schema: emailTaken } },
    })
  })

  test('references the response of an exception a middleware throws', ({ assert }) => {
    assert.deepEqual(probe('verified').responses['403'], {
      $ref: '#/components/responses/EmailNotVerifiedException',
    })
    assert.deepEqual(document.components.responses?.EmailNotVerifiedException, {
      description: 'The email address of the account is not verified',
      content: { 'application/json': { schema: emailNotVerified } },
    })
  })

  test('describes the response inline when a tag of the action gives a reason', ({ assert }) => {
    assert.deepEqual(probe('reasoned').responses['403'], {
      description: 'Verify the email address first',
      content: { 'application/json': { schema: emailNotVerified } },
    })
    assert.deepEqual(probe('thrown').responses['409'], {
      description: 'The email is taken',
      content: { 'application/json': { schema: emailTaken } },
    })
  })

  test('joins the reasons of the classes that share a status', ({ assert }) => {
    const forbidden = probe('screened').responses['403']

    assert.notProperty(forbidden, '$ref')
    assert.equal(
      'description' in forbidden! && forbidden.description,
      'The email address of the account is not verified; Forbidden',
    )
    assert.sameDeepMembers(json(forbidden).oneOf!, [
      emailNotVerified,
      object({
        code: { type: 'string', const: 'E_AUTHORIZATION_FAILURE' },
        message: { type: 'string' },
      }),
    ])
  })

  test('keeps the status text for a class without a doc comment', ({ assert }) => {
    assert.containsSubset(probe('plan').responses['402'], { description: 'Payment Required' })
    assert.notProperty(document.components.responses ?? {}, 'PlanLimitException')
  })
})
