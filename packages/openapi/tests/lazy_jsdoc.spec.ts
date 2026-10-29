import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
import { test } from '@japa/runner'
import ts from 'typescript'
import { prepareProgram } from '../src/program/create_program.ts'
import { playground } from './support/playground.ts'

type NodeConstructor = new (...args: never[]) => ts.Node

/**
 * A value a node holds, which the test compares between two parses of the same file.
 */
type Field =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Function
  | ts.Node
  | Field[]
  | Map<string, Field>
  | { [key: string]: Field }

// SAFETY: the compiler allocates its nodes with the constructors of this internal object.
const { objectAllocator } = ts as typeof ts & {
  objectAllocator: Record<string, () => NodeConstructor>
}

const constructors = [
  'getNodeConstructor',
  'getTokenConstructor',
  'getIdentifierConstructor',
  'getPrivateIdentifierConstructor',
  'getSourceFileConstructor',
].map(name => objectAllocator[name]!())

// The fields whose value differs between two programs of the same files: `parent` is checked by
// identity, symbols and ids are numbered as the checker creates them, and package scopes are cached.
const PROGRAM_STATE = new Set(['parent', 'id', 'symbol', 'localSymbol', 'packageJsonScope'])

function isNode(value: Field): value is ts.Node {
  return constructors.some(constructor => value instanceof constructor)
}

function isRecord(value: Field): value is { [key: string]: Field } {
  return value instanceof Object && !(value instanceof Function)
}

function fieldsOf(node: ts.Node): Map<string, Field> {
  return new Map(Object.entries(node))
}

function jsDocOf(node: ts.Node): ts.JSDoc[] {
  return Object.getOwnPropertyDescriptor(node, 'jsDoc')?.value ?? []
}

function children(node: ts.Node) {
  const nodes: ts.Node[] = []

  ts.forEachChild(node, child => {
    nodes.push(child)
  })

  return nodes
}

/**
 * Counts the callers that read `jsDoc` through the accessors of the node prototypes, which only a
 * node without JSDoc of its own reaches, while `run()` runs.
 */
function jsDocReaders(run: () => void) {
  const readers = new Map<string, number>()

  const originals = constructors.map(constructor =>
    Object.getOwnPropertyDescriptor(constructor.prototype, 'jsDoc')!,
  )

  const { stackTraceLimit } = Error
  const prepareStackTrace = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace')

  let callSites: NodeJS.CallSite[] = []

  Error.stackTraceLimit = 3
  Error.prepareStackTrace = (_, sites) => {
    callSites = sites

    return ''
  }

  constructors.forEach((constructor, index) => {
    const original = originals[index]!

    Object.defineProperty(constructor.prototype, 'jsDoc', {
      ...originals[index],
      get(this: ts.Node) {
        void new Error().stack

        const reader = callSites
          .slice(1)
          .map(site => site.getFunctionName())
          .join(' < ')

        readers.set(reader, (readers.get(reader) ?? 0) + 1)

        return original.get?.call(this)
      },
    })
  })

  try {
    run()
  } finally {
    constructors.forEach((constructor, index) =>
      Object.defineProperty(constructor.prototype, 'jsDoc', originals[index]!),
    )
    Error.stackTraceLimit = stackTraceLimit

    if (prepareStackTrace) Object.defineProperty(Error, 'prepareStackTrace', prepareStackTrace)
    else Reflect.deleteProperty(Error, 'prepareStackTrace')
  }

  return readers
}

/**
 * Lists every difference between a node of a lazily parsed file and its twin in the full parse,
 * down its children and its JSDoc, each JSDoc node's parent included.
 */
function differences(lazy: ts.Node, full: ts.Node, path: string, found: string[]) {
  const at = (key: string) => `${path} ${ts.SyntaxKind[full.kind]}@${full.pos}.${key}`

  const same = (a: Field, b: Field, key: string): void => {
    if (isNode(a) && isNode(b)) {
      if (a.kind !== b.kind || a.pos !== b.pos || a.end !== b.end) found.push(at(key))
    } else if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) found.push(at(`${key}.length`))
      else a.forEach((item, index) => same(item, b[index], `${key}[${index}]`))
    } else if (a instanceof Map && b instanceof Map) {
      const sorted = (map: Map<string, Field>) =>
        [...map.keys()].map(String).sort((x, y) => x.localeCompare(y))

      same(sorted(a), sorted(b), key)
    } else if (isRecord(a) && isRecord(b)) {
      for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
        same(a[name], b[name], `${key}.${name}`)
      }
    } else if (!(a instanceof Function) && a !== b) {
      found.push(`${at(key)}: ${inspect(a)} != ${inspect(b)}`)
    }
  }

  const lazyFields = fieldsOf(lazy)
  const fullFields = fieldsOf(full)

  for (const key of new Set([...lazyFields.keys(), ...fullFields.keys()])) {
    if (!PROGRAM_STATE.has(key) && key !== 'jsDoc')
      same(lazyFields.get(key), fullFields.get(key), key)
  }

  const lazyDocs = jsDocOf(lazy)
  const fullDocs = jsDocOf(full)

  if (lazyDocs.length !== fullDocs.length) found.push(at('jsDoc.length'))

  lazyDocs.forEach((doc, index) => {
    if (doc.parent !== lazy) found.push(at(`jsDoc[${index}].parent`))

    if (fullDocs[index]) differences(doc, fullDocs[index], `${path} jsDoc`, found)
  })

  const lazyChildren = children(lazy)
  const fullChildren = children(full)

  if (lazyChildren.length !== fullChildren.length) found.push(at('children.length'))

  lazyChildren.forEach((child, index) => {
    if (child.parent !== lazy) found.push(at(`child[${index}].parent`))

    if (fullChildren[index]) differences(child, fullChildren[index], path, found)
  })
}

test.group('lazy JSDoc', () => {
  test('a declaration file parsed without JSDoc reads what its full parse reads', ({ assert }) => {
    const appRoot = fileURLToPath(playground)
    let prepared: ReturnType<typeof prepareProgram> | undefined
    let lazy: ts.Program | undefined

    const readers = jsDocReaders(() => {
      prepared = prepareProgram(appRoot)
      lazy = prepared.create('').program
    })

    // Before a node can find its file to parse it in full, JSDoc is read only to set its parents,
    // and by the parser of a file parsed in full, which checks a node has none before it adds some.
    assert.sameMembers(
      [
        ...new Set(
          [...readers.keys()].map(reader => reader.replace(/^withJSDoc < .*/, 'withJSDoc')),
        ),
      ],
      ['hasJSDocNodes < bindJSDoc', 'withJSDoc'],
      JSON.stringify(Object.fromEntries(readers)),
    )

    const { entryFile } = prepared!
    const host = ts.createCompilerHost(lazy!.getCompilerOptions())
    const getSourceFile = host.getSourceFile.bind(host)
    const fileExists = host.fileExists.bind(host)

    host.fileExists = fileName => fileName === entryFile || fileExists(fileName)
    host.getSourceFile = (fileName, ...rest) =>
      fileName === entryFile
        ? ts.createSourceFile(fileName, '', rest[0])
        : getSourceFile(fileName, ...rest)

    const full = ts.createProgram({
      rootNames: lazy!.getRootFileNames(),
      options: lazy!.getCompilerOptions(),
      host,
    })

    full.getTypeChecker()

    const files = lazy!.getSourceFiles()
    const lazyFiles = files.filter(file => !Object.hasOwn(file, 'nodeCount'))
    const found: string[] = []

    assert.isAbove(lazyFiles.length, 500)

    // A node of a lazily parsed file that reads its JSDoc parses the file in full.
    for (const file of lazyFiles) ts.getJSDocCommentsAndTags(file.endOfFileToken)

    assert.isTrue(lazyFiles.every(file => Object.hasOwn(file, 'nodeCount')))

    for (const file of files) {
      const twin = full.getSourceFile(file.fileName)

      if (twin) differences(file, twin, file.fileName, found)
      else found.push(`${file.fileName} is missing from the full program`)
    }

    assert.deepEqual(found.slice(0, 20), [])
  }).timeout(120_000)
})
