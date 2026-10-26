---
'@enzopita/adonisjs-openapi': minor
---

Document an exception's response with `@throws {ExceptionClass}`, which reads the class's `static status` and the return type of its `toResponse()` method, and a request body read without a validator with `@requestBody {TypeName}`. A status code with several bodies, such as an exception's `422` on a validated route, is a `oneOf` of them. A union, `@throws {AException | BException}`, documents each class under its own status code. When the class has no literal `static status` or no `toResponse()`, the status and body come from the `response.status(...)` and `response.send(...)` calls in its `handle()`. A `@throws` or `@requestBody` tag that can't be documented is reported as a warning.
