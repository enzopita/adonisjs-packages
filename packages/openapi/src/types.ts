import type { HttpContext } from '@adonisjs/core/http'

export type JsonValue = string | number | boolean | null

/**
 * The JSON Schema keywords the generator reads or writes. Keywords Vine adds
 * (`minLength`, `pattern`...) pass through untouched.
 */
export interface JsonSchema {
  $ref?: string
  type?: string | string[]
  format?: string
  const?: JsonValue
  enum?: JsonValue[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  prefixItems?: JsonSchema[]
  minItems?: number
  maxItems?: number
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  not?: JsonSchema
}

export type RouteMatcher = string | RegExp | ((routeName: string) => boolean)

export type SecurityScheme =
  | { type: 'http'; scheme: 'bearer' | 'basic'; bearerFormat?: string; description?: string }
  | { type: 'apiKey'; name: string; in: 'header' | 'query' | 'cookie'; description?: string }

export interface DocumentInfo {
  title: string
  version: string
  summary?: string
  description?: string
  termsOfService?: string
  contact?: { name?: string; url?: string; email?: string }
  license?: { name: string; url?: string; identifier?: string }
}

export interface DocumentConfig {
  info: DocumentInfo
  servers: { url: string; description?: string }[]
  /**
   * Written as the document's top-level `tags`, to describe and order the tags operations use.
   */
  tags: { name: string; description?: string }[]
}

export interface SecurityConfig {
  schemes: Record<string, SecurityScheme>
  /**
   * Maps a named middleware (as in `middleware.auth()`) to a key of `schemes`.
   */
  middleware: Record<string, string>
}

export interface OpenApiConfig {
  /**
   * Where the document is written, relative to the app root.
   */
  output: string
  document: DocumentConfig
  /**
   * Same filters as Tuyau's `generateRegistry({ routes })`. Only one of them can be set.
   */
  routes: { only?: RouteMatcher[]; except?: RouteMatcher[] }
  security: SecurityConfig
  errors: ErrorsConfig
  /**
   * Makes every warning an error, so `openapi:generate` and `openapi:check` fail on it. The
   * `--strict` and `--no-strict` flags of both commands override it.
   */
  strict: boolean
  rules: RulesConfig
}

/**
 * Style rules each operation is checked against. A rule left out is not checked.
 */
export interface RulesConfig {
  /**
   * The longest summary, in characters, without a warning.
   */
  summaryMaxLength?: number
  /**
   * `true` warns about a summary that does not end with a period, `false` about one that does.
   */
  summaryTrailingPeriod?: boolean
}

/**
 * What `defineConfig()` takes: every key is optional, and `document` and `security` merge their
 * keys over the defaults.
 */
export type OpenApiUserConfig<Errors extends ErrorsConfig = ErrorsConfig> = Partial<
  Omit<OpenApiConfig, 'document' | 'security' | 'errors'>
> & {
  document?: Partial<DocumentConfig>
  security?: Partial<SecurityConfig>
  errors?: Errors
}

/**
 * An exception class, or a constant holding one such as the `E_ROW_NOT_FOUND` of `@adonisjs/lucid`.
 */
export interface ExceptionClass {
  new (...args: never[]): Error & { status?: number }
  status?: number
}

export interface ErrorsConfig {
  /**
   * The body of an error the exception handler renders with no branch of its own, as a type
   * expression such as `import('#types/api').ApiError`. Defaults to what the handler sends.
   */
  body?: string
  /**
   * The exception a call throws inside a package, by the method that throws it: `findOrFail`
   * matches any call of that method, `bouncer.authorize` a call on `bouncer`, also through
   * `bouncer.with(Policy)`.
   */
  throwers?: Record<string, ExceptionClass>
  /**
   * The exception a middleware throws inside a package, by its name as `node ace list:routes`
   * shows it, such as `auth` or the `globalThrottle` of `limiter.define('global')`, or by its
   * kernel specifier.
   */
  middleware?: Record<string, ExceptionClass>
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options'

export interface OpenApiParameter {
  name: string
  in: 'path' | 'query'
  required: boolean
  schema: JsonSchema
  style?: 'deepObject'
  explode?: true
}

export interface OpenApiResponse {
  description: string
  headers?: Record<string, { schema: JsonSchema }>
  content?: Record<string, { schema: JsonSchema }>
}

export interface OpenApiReference {
  $ref: string
}

export interface OpenApiOperation {
  operationId: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: true
  parameters?: OpenApiParameter[]
  requestBody?: { required: true; content: Record<string, { schema: JsonSchema }> }
  responses: Record<string, OpenApiResponse | OpenApiReference>
  security?: Record<string, string[]>[]
}

export interface OpenApiDocument {
  openapi: '3.1.0'
  info: DocumentInfo
  servers?: DocumentConfig['servers']
  tags?: DocumentConfig['tags']
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
  components: {
    schemas: Record<string, JsonSchema>
    responses?: Record<string, OpenApiResponse>
    securitySchemes: SecurityConfig['schemes']
  }
}

/**
 * A line of the app's sources, relative to the app root. Lines start at 1.
 */
export interface SourceLocation {
  file: string
  line: number
}

/**
 * What documented a status code of an operation.
 */
export type ResponseSource = (
  | { kind: 'return' }
  | { kind: 'answer' }
  | { kind: 'throw'; exception: string }
  | { kind: 'thrower'; call: string; exception: string }
  | { kind: 'middleware'; middleware: string }
  | { kind: 'security'; middleware: string }
  | { kind: 'validator' }
  | { kind: 'tag'; tag: '@throws' | '@response' }
) & { location?: SourceLocation }

/**
 * Codes are stable: a code keeps its meaning across releases.
 *
 * - `OA-R001`: a closure route, skipped.
 * - `OA-R002`: a handler whose return type is unknown.
 * - `OA-R003`: a function passed to `.use()` that no function of the app's sources matches.
 * - `OA-R004`: a function passed to `.use()` that several functions of the app's sources match.
 * - `OA-V001`: a validator whose JSON Schema cannot be read.
 * - `OA-T001`: a `@throws` that names a status code or a union instead of one class, or a class without braces.
 * - `OA-T002`: a `@throws` class name that no exception class of the app has, or several have.
 * - `OA-T003`: a `@response {N} reason` whose status nothing documents.
 * - `OA-T004`: a `@response` status that is not a status code.
 * - `OA-T005`: a `@throws` type that does not resolve to a class.
 * - `OA-T006`: an exception with no status code.
 * - `OA-T007`: a `@requestBody` or `@response` type that does not resolve, an error for `@response`.
 * - `OA-T008`: a tag the generator does not read.
 * - `OA-E001`: an `errors` entry whose exception status cannot be read from its source.
 * - `OA-E002`: a package exception that renders its own body, which its declaration does not carry.
 * - `OA-E003`: an `errors.throwers` or `errors.middleware` key that matches nothing in the documented routes.
 * - `OA-S001`: an operation without tags.
 * - `OA-S002`: a tag that `document.tags` does not declare.
 * - `OA-S003`: a summary longer than `rules.summaryMaxLength`.
 * - `OA-S004`: a summary whose trailing period breaks `rules.summaryTrailingPeriod`.
 * - `OA-J001`: a type with no JSON Schema, emitted as `{}`.
 * - `OA-J002`: a Lucid model, emitted as `{}`.
 */
export type DiagnosticCode =
  | 'OA-R001'
  | 'OA-R002'
  | 'OA-R003'
  | 'OA-R004'
  | 'OA-V001'
  | 'OA-T001'
  | 'OA-T002'
  | 'OA-T003'
  | 'OA-T004'
  | 'OA-T005'
  | 'OA-T006'
  | 'OA-T007'
  | 'OA-T008'
  | 'OA-E001'
  | 'OA-E002'
  | 'OA-E003'
  | 'OA-S001'
  | 'OA-S002'
  | 'OA-S003'
  | 'OA-S004'
  | 'OA-J001'
  | 'OA-J002'

export interface Diagnostic {
  code: DiagnosticCode
  severity: 'error' | 'warning'
  /**
   * The route name, absent for a problem of the whole document.
   */
  route?: string
  message: string
  fix?: string
  location?: SourceLocation
}

/**
 * What `generateDocument()` returns.
 */
export interface GeneratedDocument {
  document: OpenApiDocument
  diagnostics: Diagnostic[]
  /**
   * Route name to status code to what documented that response, in the order it was read.
   */
  provenance: Record<string, Record<string, ResponseSource[]>>
}

/**
 * What a docs UI needs to render its page.
 */
export interface DocsPage {
  title: string
  /**
   * Relative to the page, so the page keeps working behind a proxy that adds a path prefix.
   */
  documentUrl: string
  /**
   * The CSP nonce Shield sets on the response, when CSP is enabled.
   */
  nonce?: string
}

export type Json = JsonValue | Json[] | { [key: string]: Json }

/**
 * Serialized as JSON into the UI's own init call.
 */
export type UiOptions = { [key: string]: Json }

export type DocsUi =
  | { ui?: 'scalar'; uiOptions?: UiOptions; cdn?: { script?: string } }
  | { ui: 'swagger-ui'; uiOptions?: UiOptions; cdn?: { script?: string; style?: string } }
  | { ui: 'redoc'; uiOptions?: UiOptions; cdn?: { script?: string } }
  | { ui: (page: DocsPage) => string; uiOptions?: never; cdn?: never }

export type DocsOptions = DocsUi & {
  /**
   * Path of the page. The document is served at `<prefix>/openapi.json`.
   */
  prefix?: string
  title?: string
  /**
   * `live` generates the document on each request and needs the app's TypeScript
   * sources. `file` serves the file `node ace openapi:generate` wrote at the config `output`.
   */
  source?: 'live' | 'file'
  transform?: (
    document: OpenApiDocument,
    ctx: HttpContext,
  ) => OpenApiDocument | Promise<OpenApiDocument>
}
