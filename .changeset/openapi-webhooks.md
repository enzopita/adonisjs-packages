---
'@enzopita/adonisjs-openapi': minor
---

Document the webhooks the app sends in the OpenAPI 3.1 top-level `webhooks` object. `webhooks: defineWebhooks<Bodies>({ examples })` names a type whose keys are the webhook names and whose values are the bodies, and an optional example per webhook, typed by those bodies. Each key becomes a `post` operation with the id `webhook.<key>`, its doc comment as the summary and description, and its body in `components.schemas` as `Webhook.<key>`. `openapi:check` fails when a body type changes. New diagnostics `OA-W001` to `OA-W004` report a config with no bodies type, an example that is not JSON, an example of no webhook and a body emitted as `{}`.
