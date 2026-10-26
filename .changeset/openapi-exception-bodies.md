---
'@enzopita/adonisjs-openapi': minor
---

Document an exception's response with `@throws {ExceptionClass}`, which reads the class's `static status` and the return type of its `toResponse()` method, and a request body read without a validator with `@requestBody {TypeName}`. A status code with several bodies, such as an exception's `422` on a validated route, is a `oneOf` of them.
