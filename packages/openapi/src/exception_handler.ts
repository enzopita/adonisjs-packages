import ts from 'typescript'
import { aliased, answersOf, methodBodies, responseCalls, type Answer } from './operation_docs.ts'

/**
 * An `if (error instanceof X)` branch of the exception handler, and what it answers with.
 */
export interface HandlerBranch {
  symbol: ts.Symbol
  answers: Answer[]
}

export interface ExceptionHandlerAnswers {
  /**
   * The branches of `handle()`, which run before the `handle()` of the exception itself.
   */
  handled: HandlerBranch[]
  /**
   * The branches of `renderErrorAsJSON()`, which only exceptions without a `handle()` reach.
   */
  rendered: HandlerBranch[]
  /**
   * What the handler sends outside its branches with the status of the error.
   */
  generic: Answer[]
}

function instanceofBranches(checker: ts.TypeChecker, body: ts.Node) {
  const branches: { symbol: ts.Symbol; body: ts.Statement }[] = []

  const visit = (node: ts.Node) => {
    let condition = ts.isIfStatement(node) ? node.expression : undefined

    while (condition && ts.isParenthesizedExpression(condition)) condition = condition.expression

    if (
      ts.isIfStatement(node) &&
      condition &&
      ts.isBinaryExpression(condition) &&
      condition.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
    ) {
      const symbol = checker.getSymbolAtLocation(condition.right)

      if (symbol) branches.push({ symbol: aliased(checker, symbol), body: node.thenStatement })
    }

    ts.forEachChild(node, visit)
  }

  visit(body)

  return branches
}

/**
 * What the app's exception handler answers with, read from its `handle()` and
 * `renderErrorAsJSON()`. Only a condition that is an `instanceof` alone makes a branch: one that
 * also checks a `code` or a status names no class.
 */
export function exceptionHandlerAnswers(
  checker: ts.TypeChecker,
  instance: ts.Type,
): ExceptionHandlerAnswers {
  const read = (method: string) => {
    const bodies = methodBodies(checker, instance, [method])
    const branches = bodies.flatMap(body => instanceofBranches(checker, body))
    const skip = new Set<ts.Node>(branches.map(({ body }) => body))

    return {
      branches: branches.map(({ symbol, body }) => ({
        symbol,
        answers: answersOf(checker, responseCalls(checker, [body]).calls),
      })),
      generic: answersOf(checker, responseCalls(checker, bodies, skip).calls).filter(
        answer => answer.code === undefined && answer.body,
      ),
    }
  }

  const handle = read('handle')
  const render = read('renderErrorAsJSON')

  return {
    handled: handle.branches,
    rendered: render.branches,
    generic: [...handle.generic, ...render.generic],
  }
}
