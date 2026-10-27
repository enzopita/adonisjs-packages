---
'@enzopita/adonisjs-openapi': minor
---

Document error bodies and resolve `@throws` classes without importing them:

- Every error status without a body of its own, such as `@throws {404}` or the `401` of a secured route, gets the body the app's exception handler sends, as the `Error` schema. `errorResponse` in the config overrides it.
- A route middleware that answers with a status, such as `response.badRequest(body)` in a tenant middleware, documents that response.
- `@throws {import('#exceptions/x').default}` and `@requestBody {import('#types/x').Name}` resolve a type without an import in the controller.
- A `@throws` reason that wraps lines is joined into one line, the reasons of several tags on one status code are joined, and identical bodies in a `oneOf` appear once.
