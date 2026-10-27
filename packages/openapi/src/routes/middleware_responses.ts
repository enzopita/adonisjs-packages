import ts from 'typescript'
import type { Answer } from '../analysis/answers.ts'
import type { ConfiguredErrors } from '../analysis/errors/configured_errors.ts'
import type { ExceptionResponses } from '../analysis/exceptions/exception_responses.ts'
import { handlerResponses } from '../analysis/handler_responses.ts'
import { methodBodies } from '../analysis/response_calls.ts'
import type { SourceLocation } from '../types.ts'
import type { RouteOperation } from './route_operation.ts'
import type { Kernel } from './kernel.ts'

/**
 * What the route's middleware answer with when they stop the request, such as the `400` of
 * `response.badRequest(...)` in a tenant middleware or in a function passed to `.use()`, and what
 * the package middleware an `errors.middleware` key names throw. Only answers with a status are kept.
 */
export class MiddlewareResponses {
  #checker: ts.TypeChecker
  #kernel: Kernel
  #instanceOf: (specifier: string) => ts.Type | undefined
  #exceptions: ExceptionResponses
  #errors: ConfiguredErrors
  #locate: (node: ts.Node) => SourceLocation
  #findInline: (source: string) => ts.FunctionLikeDeclaration | undefined
  #answers = new Map<string, Answer[]>()

  constructor(
    checker: ts.TypeChecker,
    kernel: Kernel,
    instanceOf: (specifier: string) => ts.Type | undefined,
    exceptions: ExceptionResponses,
    errors: ConfiguredErrors,
    locate: (node: ts.Node) => SourceLocation,
    findInline: (source: string) => ts.FunctionLikeDeclaration | undefined,
  ) {
    this.#checker = checker
    this.#kernel = kernel
    this.#instanceOf = instanceOf
    this.#exceptions = exceptions
    this.#errors = errors
    this.#locate = locate
    this.#findInline = findInline
  }

  /**
   * An answer of the middleware's own belongs to its class, `owner`, and a thrown one to the
   * class of the exception.
   */
  #read(bodies: ts.Node[], owner?: ts.Symbol): Answer[] {
    const read = handlerResponses(this.#checker, bodies)

    return [
      ...read.answers.map(answer => ({ ...answer, owner })),
      ...this.#exceptions.thrownAnswers(read.throws),
    ]
  }

  #answersOf(specifier: string) {
    let found = this.#answers.get(specifier)

    if (!found) {
      const instance = this.#instanceOf(specifier)
      found = instance
        ? this.#read(methodBodies(this.#checker, instance, ['handle']), instance.getSymbol())
        : []
      this.#answers.set(specifier, found)
    }

    return found
  }

  of(route: RouteOperation) {
    const specifiers = [
      ...this.#kernel.global,
      ...route.middleware.flatMap(name => this.#kernel.named.get(name) ?? []),
    ]

    const inline = route.inlineMiddleware.flatMap(({ name, source }) => {
      const body = this.#findInline(source)?.body

      return body ? [{ middleware: name, answers: this.#read([body]) }] : []
    })

    const read = [
      ...specifiers.map(specifier => ({
        middleware: specifier,
        answers: this.#answersOf(specifier),
      })),
      ...inline,
    ].flatMap(({ middleware, answers }) =>
      answers.flatMap(({ code, body, node, owner }) =>
        code === undefined ? [] : [{ code, body, middleware, owner, location: this.#locate(node) }],
      ),
    )

    return [
      ...read,
      ...this.#errors.middlewareResponses(new Set([...specifiers, ...route.middleware])),
    ]
  }
}
