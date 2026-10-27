import ts from 'typescript'
import { aliased, importedSymbol, type ResolveModule } from './analysis/symbols.ts'
import { unknownTag } from './known_tags.ts'
import { responseTag, type ResponseTag } from './response_tag.ts'
import { throwsTag, type FindException, type ThrowsTag } from './throws_tag.ts'
import type { DiagnosticCode } from './types.ts'

export interface OperationDocs {
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: true
  /**
   * The classes `@throws {SmsRejectedException}` tags name, which carry the status and the body.
   */
  throws: ThrowsTag[]
  /**
   * `@response {404} reason` describes a status something else documents, and
   * `@response {502} {UpstreamError}` declares a status and its body.
   */
  responses: ResponseTag[]
  /**
   * The type a `@requestBody {TypeName}` tag names.
   */
  requestBody?: ts.Type
  /**
   * Why a tag could not be documented.
   */
  problems: Problem[]
}

export interface Problem {
  code: DiagnosticCode
  severity: 'error' | 'warning'
  message: string
  fix?: string
  node: ts.Node
}

function jsDoc(node: ts.Node) {
  return ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1)
}

export function tagText(tag: ts.JSDocTag) {
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

/**
 * The type a tag such as `@requestBody {TypeName}` names, which TypeScript does not parse: a name
 * in scope, or an `import('...').TypeName` to resolve without importing it.
 */
export function namedType(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  method: ts.MethodDeclaration,
  tag: ts.JSDocTag,
  text: string,
  problems: Problem[],
) {
  const name = /^\s*([\w$]+)\s*$/.exec(text)?.[1]
  const imported = /^\s*import\(\s*(['"])(.+?)\1\s*\)((?:\.[\w$]+)+)\s*$/.exec(text)

  const symbol = imported
    ? importedSymbol(
        checker,
        resolveModule,
        imported[2]!,
        imported[3]!.slice(1).split('.'),
        method.getSourceFile(),
      )
    : name &&
      checker
        .getSymbolsInScope(method, ts.SymbolFlags.Type | ts.SymbolFlags.Alias)
        .find(candidate => candidate.name === name)

  // The scope holds the local side of an exported type, which has no declared type of its own.
  if (symbol)
    return checker.getDeclaredTypeOfSymbol(
      aliased(checker, checker.getExportSymbolOfSymbol(symbol)),
    )

  const message = `@${tag.tagName.text} {${text}}`

  if (imported)
    problems.push({
      code: 'OA-T007',
      severity: 'warning',
      message: `${message}: ${text.trim()} does not name an export of a module`,
      node: tag,
    })
  else if (name)
    problems.push({
      code: 'OA-T007',
      severity: 'warning',
      message: `${message}: ${name} is not in scope`,
      fix: `import it in the controller or name it as import('...').${name}`,
      node: tag,
    })
  else
    problems.push({
      code: 'OA-T007',
      severity: 'warning',
      message: `${message}: expected a type name`,
      fix: 'name a type, such as {MailEvent}',
      node: tag,
    })

  return undefined
}

export function operationDocs(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  findException: FindException,
  controller: ts.ClassDeclaration,
  method: ts.MethodDeclaration,
): OperationDocs {
  const doc = jsDoc(method)
  const throws: ThrowsTag[] = []
  const responses: ResponseTag[] = []
  let requestBody: ts.Type | undefined
  const tags = tagsOf(doc) ?? tagsOf(jsDoc(controller))
  let deprecated = false
  const problems: Problem[] = []

  const [summary, ...paragraphs] = (ts.getTextOfJSDocComment(doc?.comment) ?? '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  for (const tag of doc?.tags ?? []) {
    const name = tag.tagName.text

    if (ts.isJSDocThrowsTag(tag)) {
      const thrown = throwsTag(checker, resolveModule, findException, tag, problems)

      if (thrown) throws.push(thrown)
    } else if (name === 'response') {
      const response = responseTag(checker, resolveModule, method, tag, problems)

      if (response) responses.push(response)
    } else if (name === 'requestBody') {
      const text = /^\{(.*)\}$/s.exec(tagText(tag))?.[1] ?? ''
      requestBody = namedType(checker, resolveModule, method, tag, text, problems)
    } else if (ts.isJSDocDeprecatedTag(tag)) deprecated = true
    else if (name === 'remarks' && tagText(tag)) paragraphs.push(tagText(tag))
    else problems.push(...unknownTag(tag))
  }

  return {
    ...(summary && { summary }),
    ...(paragraphs.length > 0 && { description: paragraphs.join('\n\n') }),
    ...(tags?.length && { tags }),
    ...(deprecated && { deprecated: true }),
    ...(requestBody && { requestBody }),
    throws,
    responses,
    problems,
  }
}
