import ts from 'typescript'
import { methodBodies, responseCalls } from '../response_calls.ts'
import { aliased } from '../symbols.ts'
import { answersOf, type Answer } from '../answers.ts'

/**
 * An `if (error instanceof X)` branch of the exception handler, and what it answers with.
 */
export interface HandlerBranch {
  symbol: ts.Symbol
  answers: Answer[]
  /**
   * The condition also checks something else, as in `error instanceof A && error.code === 'X'`,
   * so an `A` that fails it falls through to the next step.
   */
  conditional: boolean
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

/**
 * The classes a condition such as `error instanceof A || error instanceof B` names, or none when
 * one side of an `||` names no class, such as a check of a `code` or a status. An `&&` with an
 * `instanceof` on either side names its classes conditionally.
 */
function instanceofClasses(
  condition: ts.Expression,
): { classes: ts.Expression[]; conditional: boolean } | undefined {
  while (ts.isParenthesizedExpression(condition)) condition = condition.expression

  if (!ts.isBinaryExpression(condition)) return undefined

  const operator = condition.operatorToken.kind

  if (operator === ts.SyntaxKind.InstanceOfKeyword)
    return { classes: [condition.right], conditional: false }

  if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
    const classes = [condition.left, condition.right].flatMap(
      side => instanceofClasses(side)?.classes ?? [],
    )

    return classes.length ? { classes, conditional: true } : undefined
  }

  if (operator !== ts.SyntaxKind.BarBarToken) return undefined

  const left = instanceofClasses(condition.left)
  const right = instanceofClasses(condition.right)

  return (
    left &&
    right && {
      classes: [...left.classes, ...right.classes],
      conditional: left.conditional || right.conditional,
    }
  )
}

function instanceofBranches(checker: ts.TypeChecker, body: ts.Node) {
  const branches: { symbol: ts.Symbol; body: ts.Statement; conditional: boolean }[] = []

  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node)) {
      const { classes = [], conditional = false } = instanceofClasses(node.expression) ?? {}

      for (const name of classes) {
        const symbol = checker.getSymbolAtLocation(name)

        if (symbol)
          branches.push({ symbol: aliased(checker, symbol), body: node.thenStatement, conditional })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(body)

  return branches
}

/**
 * What the app's exception handler answers with, read from its `handle()` and
 * `renderErrorAsJSON()`. A condition made of `instanceof` checks joined by `||` makes a branch for
 * each class, and one joined to another check by `&&` a conditional branch.
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
      branches: branches.map(({ symbol, body, conditional }) => ({
        symbol,
        conditional,
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
