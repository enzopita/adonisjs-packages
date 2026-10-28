---
'@enzopita/adonisjs-openapi': minor
---

List a validated request body under each media type that the app's bodyparser accepts. The generator reads the `json`, `form` and `multipart` types and `allowedMethods` from `config/bodyparser.ts`, and uses the bodyparser defaults for a setting it cannot read. A body with a file field is listed only under the `multipart` types. On a method missing from `allowedMethods`, the validator fields become query parameters.
