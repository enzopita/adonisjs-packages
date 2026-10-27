import ts from 'typescript'
import { isAppSource } from './symbols.ts'
import { jsDoc, reasonOf } from './tags/tag_text.ts'

/**
 * The class a response comes from, a middleware or an exception, with the reason the first
 * paragraph of its doc comment gives the responses it produces. Only the app's own classes have one.
 */
export interface ResponseOwner {
  symbol: ts.Symbol
  name: string
  reason?: string
}

export function responseOwner(symbol: ts.Symbol | undefined): ResponseOwner | undefined {
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]

  if (!symbol || !declaration) return undefined

  // A default export is named `default`: its class has the name the code knows it by.
  const name = (ts.isClassDeclaration(declaration) && declaration.name?.text) || symbol.name
  const doc = isAppSource(declaration.getSourceFile()) ? jsDoc(declaration) : undefined
  const [summary = ''] = (ts.getTextOfJSDocComment(doc?.comment) ?? '').trim().split(/\n\s*\n/)
  const reason = reasonOf(summary)

  return { symbol, name, ...(reason && { reason }) }
}
