---
'@enzopita/adonisjs-openapi': minor
---

Let a scheme of `security.middleware` be valid only together with another. `{ scheme, onlyWith }` leaves out every requirement that holds the scheme without any scheme of `onlyWith`, and both `{ scheme, notWith }` and `{ scheme, onlyWith }` can now sit in an array of alternatives: `auth: ['accessToken', { scheme: 'apiKey', onlyWith: ['tenant'] }]` and `tenant: { scheme: 'tenant', notWith: ['apiKey'] }` give a route behind both `[{ "accessToken": [], "tenant": [] }, { "apiKey": [] }]`, and a route behind `auth` alone `[{ "accessToken": [] }]`, where the API key used to be listed too.
