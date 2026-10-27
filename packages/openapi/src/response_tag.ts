import ts from 'typescript'
import { namedType, tagText, type Problem, type ResolveModule } from './operation_docs.ts'
import { reasonOf } from './throws_tag.ts'
import type { Diagnostic, SourceLocation } from './types.ts'

export interface ResponseTag {
  code: string
  body?: ts.Type
  reason?: string
  tag: ts.JSDocTag
}

/**
 * `@response {404} reason` or `@response {502} {UpstreamError} reason`.
 */
export function responseTag(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  method: ts.MethodDeclaration,
  tag: ts.JSDocTag,
  problems: Problem[],
): ResponseTag | undefined {
  const parsed = /^\{([^}]*)\}\s*(?:\{([^}]*)\}\s*)?([\s\S]*)$/.exec(tagText(tag))
  const status = parsed?.[1]?.trim() ?? ''
  const code = /^[1-5]\d\d$/.test(status) ? status : undefined

  if (!parsed || !code) {
    problems.push({
      code: 'OA-T004',
      severity: 'warning',
      message: `@response: ${parsed ? `${status} is not a status code` : 'expected a status code'}`,
      fix: 'write it as @response {404} reason or @response {404} {Type} reason',
      node: tag,
    })

    return undefined
  }

  const reason = reasonOf(parsed[3] ?? '')

  if (parsed[2] === undefined) return { code, ...(reason && { reason }), tag }

  const body = namedType(checker, resolveModule, method, tag, parsed[2], problems)

  return body && { code, body, ...(reason && { reason }), tag }
}

/**
 * The tags to document, a declared body first so a reason alone can describe the status it
 * declares, and the reasons for a status nothing documents.
 */
export function applicable(tags: ResponseTag[], documented: (code: string) => boolean) {
  const declared = tags.filter(({ body }) => body)
  const codes = new Set(declared.map(({ code }) => code))
  const described = tags.filter(({ body }) => !body)
  const derived = ({ code }: ResponseTag) => documented(code) || codes.has(code)

  return {
    apply: [...declared, ...described.filter(derived)],
    underived: described.filter(tag => !derived(tag)),
  }
}

export function underivedResponse(
  route: string,
  code: string,
  location: SourceLocation,
): Diagnostic {
  return {
    code: 'OA-T003',
    severity: 'error',
    route,
    message: `@response {${code}}: nothing documents a ${code} for this route`,
    fix: `declare its body with \`@response {${code}} {Type}\`, or remove the tag`,
    location,
  }
}
