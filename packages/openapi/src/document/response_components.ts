import type { OpenApiReference, OpenApiResponse } from '../types.ts'

/**
 * The responses a middleware or an exception describes once in its doc comment, which every
 * operation it answers for references from `components.responses`.
 */
export class ResponseComponents {
  readonly responses: Record<string, OpenApiResponse> = {}

  /**
   * Named after the owner class, then after its status code too, then with a number, when another
   * response already has the name.
   */
  ref(owner: string, code: string, response: OpenApiResponse): OpenApiReference {
    const serialized = JSON.stringify(response)
    const names = [owner, `${owner}_${code}`]
    let name = owner

    for (let index = 0; this.responses[name]; index++) {
      if (JSON.stringify(this.responses[name]) === serialized) break

      name = names[index + 1] ?? `${owner}_${code}_${index}`
    }

    this.responses[name] = response

    return { $ref: `#/components/responses/${name}` }
  }
}
