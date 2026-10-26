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

function statusCode(node: ts.Node | undefined) {
  return node && ts.isNumericLiteral(node) && /^\d{3}$/.test(node.text) ? node.text : undefined
}

/**
 * An exception class documents its response with `static status = 422` and, when
 * `handle()` sends a body, a `toResponse()` method that returns it.
 */
function exceptionResponse(checker: ts.TypeChecker, symbol: ts.Symbol) {
  const constructor = checker.getTypeOfSymbol(symbol)
  const status = checker.getPropertyOfType(constructor, 'status')?.valueDeclaration
  const code = status && ts.isPropertyDeclaration(status) && statusCode(status.initializer)

  if (!code) return undefined

  const toResponse = checker.getPropertyOfType(
    checker.getDeclaredTypeOfSymbol(symbol),
    'toResponse',
  )

  const signature = toResponse && checker.getTypeOfSymbol(toResponse).getCallSignatures()[0]
  const body = signature && checker.getAwaitedType(signature.getReturnType())

  return { code, bodies: body ? [body] : [] }
}

/**
 * `@throws {404}` parses as a JSDoc type expression holding the literal type `404`,
 * `@throws {SmsRejectedException}` as a reference to the class.
 */
function thrownResponse(checker: ts.TypeChecker, tag: ts.JSDocTag) {
  const type = ts.isJSDocThrowsTag(tag) ? tag.typeExpression?.type : undefined

  if (type && ts.isLiteralTypeNode(type)) {
    const code = statusCode(type.literal)

    return code && { code, bodies: [] }
  }

  const symbol = type && ts.isTypeReferenceNode(type) && checker.getSymbolAtLocation(type.typeName)

  const target =
    symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol

  return target && target.flags & ts.SymbolFlags.Class
    ? exceptionResponse(checker, target)
    : undefined
}

/**
 * `@requestBody {TypeName}` is not a tag TypeScript parses, so its comment holds the name to resolve.
 */
function requestBodyType(checker: ts.TypeChecker, method: ts.MethodDeclaration, tag: ts.JSDocTag) {
  const name = /^\{\s*([\w$]+)\s*\}$/.exec(tagText(tag))?.[1]

  const symbol =
    name &&
    checker
      .getSymbolsInScope(method, ts.SymbolFlags.Type | ts.SymbolFlags.Alias)
      .find(candidate => candidate.name === name)

  return symbol
    ? checker.getDeclaredTypeOfSymbol(
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
      )
    : undefined
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

  const [summary, ...paragraphs] = (ts.getTextOfJSDocComment(doc?.comment) ?? '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  for (const tag of doc?.tags ?? []) {
    const thrown = thrownResponse(checker, tag)

    if (thrown) {
      const response = (responses[thrown.code] ??= {
        description: tagText(tag) || (STATUS_CODES[Number(thrown.code)] ?? thrown.code),
        bodies: [],
      })

      response.bodies.push(...thrown.bodies)
    } else if (tag.tagName.text === 'requestBody')
      requestBody = requestBodyType(checker, method, tag)
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
  }
}
