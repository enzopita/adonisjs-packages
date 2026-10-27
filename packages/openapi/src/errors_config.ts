import ts from 'typescript'
import { exceptionType, type ExceptionType } from './exception_class.ts'
import type { ExceptionResponses } from './exception_responses.ts'
import type { Thrown } from './operation_docs.ts'
import { callMatches } from './throwers.ts'
import type {
  Diagnostic,
  ErrorsConfig,
  ExceptionClass,
  ResponseSource,
  SourceLocation,
} from './types.ts'

type Kind = 'throwers' | 'middleware'

/**
 * An exception an `errors.throwers` or `errors.middleware` entry names: its class as the type of
 * the config reads it, and its status as the class holds it at runtime, since a package declares
 * it as a `number`.
 */
export interface ConfiguredException {
  key: string
  name: string
  exception?: ExceptionType
  status?: string
  location?: SourceLocation
}

/**
 * The status an exception of the class has when nothing overrides it. `@adonisjs/bouncer` and
 * `@adonisjs/limiter` set it in a class field, which only an instance carries.
 */
function defaultStatus(exception: ExceptionClass) {
  // An exception's constructor only stores what it is given, so placeholders build one.
  for (const args of [[{}, {}], []]) {
    try {
      const { status }: { status?: number } = Reflect.construct(exception, args)

      if (status !== undefined) return status
    } catch {}
  }

  return exception.status
}

/**
 * The exceptions the `errors` config names for the calls and the middleware the generator cannot
 * read, because their throw happens inside a package.
 */
export class ConfiguredErrors {
  #checker: ts.TypeChecker
  #errors: ErrorsConfig
  /**
   * The type of `config/openapi.ts`, absent when the app has none.
   */
  #config?: ts.Type
  #exceptions: ExceptionResponses
  #location: (node: ts.Node) => SourceLocation
  #entries = new Map<Kind, ConfiguredException[]>()
  /**
   * The `OA-E001` the entries raised.
   */
  readonly diagnostics: Diagnostic[] = []

  constructor(
    checker: ts.TypeChecker,
    errors: ErrorsConfig,
    config: ts.Type | undefined,
    exceptions: ExceptionResponses,
    location: (node: ts.Node) => SourceLocation,
  ) {
    this.#checker = checker
    this.#errors = errors
    this.#config = config
    this.#exceptions = exceptions
    this.#location = location
  }

  #property(type: ts.Type | undefined, name: string) {
    const symbol = type && this.#checker.getPropertyOfType(type, name)

    return symbol && this.#checker.getTypeOfSymbol(symbol)
  }

  #entriesOf(kind: Kind) {
    const cached = this.#entries.get(kind)

    if (cached) return cached

    const types = this.#property(this.#property(this.#config, 'errors'), kind)

    const entries = Object.entries(this.#errors[kind] ?? {}).map(
      ([key, value]): ConfiguredException => {
        const symbol = types && this.#checker.getPropertyOfType(types, key)
        const declaration = symbol?.valueDeclaration

        const initializer =
          declaration && ts.isPropertyAssignment(declaration) ? declaration.initializer : undefined

        const exception =
          exceptionType(
            this.#checker,
            initializer && this.#checker.getSymbolAtLocation(initializer),
          ) ?? exceptionType(this.#checker, symbol)

        const status = defaultStatus(value)

        const entry: ConfiguredException = {
          key,
          name: exception?.name ?? (value.name || key),
          ...(exception && { exception }),
          ...(status !== undefined && { status: String(status) }),
          ...(declaration && { location: this.#location(declaration) }),
        }

        if (!entry.status)
          this.diagnostics.push({
            code: 'OA-E001',
            severity: 'warning',
            message: `errors.${kind}['${key}']: ${entry.name} has no status code, the entry is ignored`,
            fix: 'name an exception class with a numeric `static status`',
            ...(entry.location && { location: entry.location }),
          })

        return entry
      },
    )

    this.#entries.set(kind, entries)

    return entries
  }

  #responses({ exception, status }: ConfiguredException): Thrown[] {
    if (!status) return []

    return exception
      ? this.#exceptions.responses(exception, status)
      : [{ code: status, bodies: this.#exceptions.generic }]
  }

  /**
   * What the calls an `errors.throwers` key names throw.
   */
  throwerResponses(invoked: ts.CallExpression[]) {
    return this.#entriesOf('throwers').flatMap(entry =>
      invoked
        .filter(call => callMatches(call, entry.key))
        .flatMap(call => {
          const source: ResponseSource = {
            kind: 'thrower',
            call: entry.key,
            exception: entry.name,
            location: this.#location(call),
          }

          return this.#responses(entry).map(thrown => ({ ...thrown, source }))
        }),
    )
  }

  /**
   * What the middleware an `errors.middleware` key names throw, for a route whose middleware go by
   * `names`: their names, their kernel specifiers, and the keys of the modules that export them.
   */
  middlewareResponses(names: Set<string>) {
    return this.#entriesOf('middleware')
      .filter(({ key }) => names.has(key))
      .flatMap(entry =>
        this.#responses(entry).flatMap(({ code, bodies }) =>
          (bodies.length ? bodies : [undefined]).map(body => ({
            code,
            body,
            middleware: entry.key,
            location: entry.location,
          })),
        ),
      )
  }
}
