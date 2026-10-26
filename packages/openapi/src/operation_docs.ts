import { STATUS_CODES } from 'node:http'
import ts from 'typescript'

export interface OperationDocs {
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: true
  /**
   * Status code to the response a `@throws` tag documents: `@throws {404} User not found`
   * or `@throws {SmsRejectedException}`, whose class carries the status and the body.
   */
  responses: Record<string, ThrownResponse>
  /**
   * The type a `@requestBody {TypeName}` tag names.
   */
  requestBody?: ts.Type
  /**
   * Why a `@throws` or `@requestBody` tag could not be documented.
   */
  problems: string[]
}

export interface ThrownResponse {
  description: string
  bodies: ts.Type[]
}

function jsDoc(node: ts.Node) {
  return ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1)
}

function tagText(tag: ts.JSDocTag) {
  return ts.getTextOfJSDocComment(tag.comment)?.trim() ?? ''
}

function tagsOf(doc: ts.JSDoc | undefined) {
  const tag = doc?.tags?.find(candidate => candidate.tagName.text === 'tags')

  return (
    tag &&
    tagText(tag)
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)
  )
}

type Thrown = { code: string; bodies: ts.Type[] }

function statusOf(type: ts.Type | undefined) {
  return type?.isNumberLiteral() && type.value >= 100 && type.value <= 599
    ? String(type.value)
    : undefined
}

function aliased(checker: ts.TypeChecker, symbol: ts.Symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

/**
 * The calls `handle()` makes on the response, such as `response.status(422)` and
 * `response.send(body)`, searched in the nearest class of the hierarchy that defines it.
 */
function handleCalls(checker: ts.TypeChecker, instance: ts.Type, names: Set<string>) {
  const handle = checker.getPropertyOfType(instance, 'handle')?.valueDeclaration
  const calls: ts.CallExpression[] = []

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      names.has(node.expression.name.text) &&
      node.arguments[0]
    )
      calls.push(node)

    ts.forEachChild(node, visit)
  }

  if (handle && ts.isMethodDeclaration(handle) && handle.body) visit(handle.body)

  return calls
}

/**
 * The status is the type of `static status`, so `422`, `422 as const`, a constant or an enum
 * member all resolve; a plain `static status = 422` widens to `number`, so its initializer is
 * read instead. Without either, `handle()`'s `response.status(...)` call gives it.
 *
 * The body is the return type of `toResponse()`, or else what `handle()` sends.
 */
function exceptionResponse(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  problems: string[],
): Thrown[] {
  const instance = checker.getDeclaredTypeOfSymbol(symbol)
  const status = checker.getPropertyOfType(checker.getTypeOfSymbol(symbol), 'status')
  const declaration = status?.valueDeclaration

  const code =
    statusOf(status && checker.getTypeOfSymbol(status)) ??
    statusOf(
      declaration && ts.isPropertyDeclaration(declaration) && declaration.initializer
        ? checker.getTypeAtLocation(declaration.initializer)
        : undefined,
    ) ??
    handleCalls(checker, instance, new Set(['status']))
      .map(call => statusOf(checker.getTypeAtLocation(call.arguments[0]!)))
      .find(Boolean)

  if (!code) {
    problems.push(
      `@throws: ${checker.typeToString(instance)} has no status code: give it a literal \`static status\` or call \`response.status(...)\` with one in \`handle()\``,
    )

    return []
  }

  const toResponse = checker.getPropertyOfType(instance, 'toResponse')
  const signature = toResponse && checker.getTypeOfSymbol(toResponse).getCallSignatures()[0]

  const bodies = signature
    ? [checker.getAwaitedType(signature.getReturnType())!]
    : handleCalls(checker, instance, new Set(['send', 'json'])).map(call =>
        checker.getTypeAtLocation(call.arguments[0]!),
      )

  return [{ code, bodies }]
}

/**
 * `@throws {404}` parses as a JSDoc type expression holding the literal type `404`,
 * `@throws {SmsRejectedException}` as a reference to the class, and
 * `@throws {AException | BException}` as a union of either.
 */
function thrownResponses(checker: ts.TypeChecker, type: ts.TypeNode, problems: string[]): Thrown[] {
  if (ts.isUnionTypeNode(type))
    return type.types.flatMap(member => thrownResponses(checker, member, problems))

  if (ts.isLiteralTypeNode(type)) {
    const code = statusOf(checker.getTypeFromTypeNode(type))

    if (code) return [{ code, bodies: [] }]

    problems.push(`@throws: ${type.getText()} is not a status code`)

    return []
  }

  const symbol = ts.isTypeReferenceNode(type) && checker.getSymbolAtLocation(type.typeName)
  const target = symbol && aliased(checker, symbol)

  if (target && target.flags & ts.SymbolFlags.Class)
    return exceptionResponse(checker, target, problems)

  problems.push(
    target && target.declarations?.length
      ? `@throws: ${type.getText()} is not a class`
      : `@throws: ${type.getText()} is not in scope, import it in the controller`,
  )

  return []
}

/**
 * `@requestBody {TypeName}` is not a tag TypeScript parses, so its comment holds the name to resolve.
 */
function requestBodyType(
  checker: ts.TypeChecker,
  method: ts.MethodDeclaration,
  tag: ts.JSDocTag,
  problems: string[],
) {
  const name = /^\{\s*([\w$]+)\s*\}$/.exec(tagText(tag))?.[1]

  const symbol =
    name &&
    checker
      .getSymbolsInScope(method, ts.SymbolFlags.Type | ts.SymbolFlags.Alias)
      .find(candidate => candidate.name === name)

  if (symbol) return checker.getDeclaredTypeOfSymbol(aliased(checker, symbol))

  problems.push(
    `@requestBody ${tagText(tag)}: ${name ? `${name} is not in scope, import it in the controller` : 'expected a type name, such as {MailEvent}'}`,
  )

  return undefined
}

export function operationDocs(
  checker: ts.TypeChecker,
  controller: ts.ClassDeclaration,
  method: ts.MethodDeclaration,
): OperationDocs {
  const doc = jsDoc(method)
  const responses: Record<string, ThrownResponse> = {}
  let requestBody: ts.Type | undefined
  const tags = tagsOf(doc) ?? tagsOf(jsDoc(controller))
  let deprecated = false
  const problems: string[] = []

  const [summary, ...paragraphs] = (ts.getTextOfJSDocComment(doc?.comment) ?? '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  for (const tag of doc?.tags ?? []) {
    if (ts.isJSDocThrowsTag(tag)) {
      const thrownTypes = tag.typeExpression
        ? thrownResponses(checker, tag.typeExpression.type, problems)
        : []

      for (const thrown of thrownTypes) {
        const response = (responses[thrown.code] ??= {
          description: tagText(tag) || (STATUS_CODES[Number(thrown.code)] ?? thrown.code),
          bodies: [],
        })

        response.bodies.push(...thrown.bodies)
      }
    } else if (tag.tagName.text === 'requestBody')
      requestBody = requestBodyType(checker, method, tag, problems)
    else if (ts.isJSDocDeprecatedTag(tag)) deprecated = true
    else if (tag.tagName.text === 'remarks' && tagText(tag)) paragraphs.push(tagText(tag))
  }

  return {
    ...(summary && { summary }),
    ...(paragraphs.length > 0 && { description: paragraphs.join('\n\n') }),
    ...(tags?.length && { tags }),
    ...(deprecated && { deprecated: true }),
    ...(requestBody && { requestBody }),
    responses,
    problems,
  }
}
