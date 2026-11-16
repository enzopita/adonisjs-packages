---
'@enzopita/adonisjs-openapi': minor
---

Document alternative security requirements. A `security.middleware` entry can map a middleware to an array of schemes, any one of which lets the request through, and each becomes its own Security Requirement Object. An entry `{ scheme, notWith }` leaves its scheme out of the requirements that hold a scheme of `notWith`, such as a tenant header an API key already implies: `auth: ['accessToken', 'apiKey']` and `tenant: { scheme: 'tenant', notWith: ['apiKey'] }` give a route behind both `"security": [{ "accessToken": [], "tenant": [] }, { "apiKey": [] }]`.
