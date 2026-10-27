---
'@enzopita/adonisjs-openapi': major
---

Each tag has one meaning, and a body comes from an exception class, never from a status code.

- `@throws {Class}` takes one class, found in scope or by name in `app/**/exceptions/`. `@throws {404}` and `@throws {A | B}` fail generation (`OA-T001`), as does a class name that none or several classes have (`OA-T002`).
- `@response {N} reason` describes a status the generator documents, and fails generation when nothing does (`OA-T003`). `@response {N} {Type} reason` declares a status and its body.
- `errors.throwers` names the exception a call throws inside a package, such as `bouncer.authorize` or `findOrFail`, and `errors.middleware` the one a package middleware throws, such as the limiter's `throttle`. `errors.body` replaces `errorResponse`.
- An exception's body is the one an `instanceof` branch of the exception handler renders for its class, else the exception's own, else the handler's generic body. The handler's bodies are no longer matched to a status code.
- `download()` and `attachment()` are documented with the media type of a literal file extension (#20).
- An error diagnostic makes `openapi:generate` and `openapi:check` exit with code 1, and `openapi:generate` writes no file. An unknown tag gets the `OA-T008` warning.
