import ts from 'typescript'
import { isAppSource } from '../analysis/symbols.ts'

type FunctionNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration

/**
 * The names and literals of a function in source order, without its types: the same for the
 * TypeScript the app wrote and the JavaScript a function's `toString()` gives at runtime.
 */
function fingerprint(root: ts.Node) {
  const words: string[] = []

  const visit = (node: ts.Node) => {
    if (ts.isTypeNode(node)) return

    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) words.push(node.text)
    else if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))
      words.push(JSON.stringify(node.text))

    ts.forEachChild(node, visit)
  }

  visit(root)

  return words.join(' ')
}

function isFunction(node: ts.Node): node is FunctionNode {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)
}

/**
 * Finds the function of the app an inline route middleware, such as
 * `.use(async (ctx, next) => {})`, was created from, by its runtime source.
 */
export function inlineMiddleware(program: ts.Program) {
  let index: Map<string, FunctionNode> | undefined

  const read = () => {
    const found = new Map<string, FunctionNode>()

    const visit = (node: ts.Node) => {
      if (isFunction(node) && node.body) {
        const key = fingerprint(node)

        if (!found.has(key)) found.set(key, node)
      }

      ts.forEachChild(node, visit)
    }

    for (const file of program.getSourceFiles()) if (isAppSource(file)) visit(file)

    return found
  }

  return (source: string) => {
    index ??= read()

    const parsed = ts.createSourceFile('inline.js', `(${source})`, ts.ScriptTarget.Latest)
    const [statement] = parsed.statements

    const expression =
      statement &&
      ts.isExpressionStatement(statement) &&
      ts.isParenthesizedExpression(statement.expression)
        ? statement.expression.expression
        : undefined

    return expression && isFunction(expression) ? index.get(fingerprint(expression)) : undefined
  }
}
