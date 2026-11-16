---
'@enzopita/adonisjs-openapi': patch
---

Type the path parameters of a validator whose object is merged with a `vine.group` from its `params`, as without a group. They were documented as `{ "type": "string" }`, since the input of such a validator is an `anyOf` with no top-level `params`.
