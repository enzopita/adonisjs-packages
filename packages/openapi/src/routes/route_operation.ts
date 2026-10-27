import type { HttpMethod } from '../types.ts'
import type { FunctionLocation } from './function_location.ts'

/**
 * One named route as the generator sees it: where it lives, and the TypeScript
 * expressions the routes scanner extracted for its input and output.
 */
export interface RouteOperation {
  name: string
  /**
   * The route name, with a suffix on the path without an optional param, such as `users.show.without_id`.
   */
  operationId: string
  methods: HttpMethod[]
  path: string
  pathParams: string[]
  middleware: string[]
  inlineMiddleware: { name: string; source: string; location?: FunctionLocation }[]
  requestType?: string
  responseType?: string
  imports: string[]
  validator?: { specifier: string; exportName: string }
  controller?: { path: string; method: string }
}
