import ts from 'typescript'

type NodeConstructor = new (...args: never[]) => ts.Node

/**
 * The fields of a source file whose value depends on its JSDoc.
 */
interface JSDocFields {
  nodeCount: number
  identifierCount: number
  identifiers: Map<string, string>
  jsDocParsingMode: ts.JSDocParsingMode
  jsDocDiagnostics: ts.Diagnostic[] | undefined
}

type JSDocField = keyof JSDocFields

// SAFETY: the compiler defines these at runtime and keeps them out of its public types;
// `tests/lazy_jsdoc.spec.ts` fails when one of them changes.
const internal = ts as typeof ts & {
  NodeFlags: { Ambient: number }
  setParent(child: ts.Node, parent: ts.Node): void
  setParentRecursive(node: ts.Node, incremental: boolean): void
  objectAllocator: Record<
    `get${'Node' | 'Token' | 'Identifier' | 'PrivateIdentifier' | 'SourceFile'}Constructor`,
    () => NodeConstructor
  >
}

const FILE_FIELDS: JSDocField[] = [
  'nodeCount',
  'identifierCount',
  'identifiers',
  'jsDocParsingMode',
  'jsDocDiagnostics',
]

// A `@deprecated` tag flags the node it documents as it parses, and the checker reads that flag for
// its suggestions without reading the JSDoc: a file that may have one parses in full. The letters
// of a tag name may be unicode escapes.
const DEPRECATED_TAG = new RegExp(
  `@${'deprecated'
    .split('')
    .map(letter => {
      const code = letter.charCodeAt(0).toString(16)

      return `(?:${letter}|\\\\u(?:00${code}|\\{0*${code}\\}))`
    })
    .join('')}`,
  'i',
)

const pending = new Map<ts.SourceFile, ts.CreateSourceFileOptions>()
const lazyFields = new WeakMap<ts.SourceFile, Partial<JSDocFields>>()
let armed = false

function ownJSDoc(node: ts.Node): ts.JSDoc[] | undefined {
  return Object.getOwnPropertyDescriptor(node, 'jsDoc')?.value
}

function ownField<Field extends JSDocField>(file: ts.SourceFile, field: Field): JSDocFields[Field] {
  return Object.getOwnPropertyDescriptor(file, field)?.value
}

function defineOwn(
  node: ts.Node,
  key: 'jsDoc' | JSDocField,
  value: ts.JSDoc[] | JSDocFields[JSDocField],
) {
  Object.defineProperty(node, key, { value, writable: true, enumerable: true, configurable: true })
}

function children(node: ts.Node) {
  const nodes: ts.Node[] = []

  ts.forEachChild(node, child => {
    nodes.push(child)
  })

  return nodes
}

/**
 * Gives each node of `lazy` the JSDoc of its twin in `full`, the same file parsed with it, and the
 * parents the binder gives JSDoc nodes.
 */
function adoptJSDoc(lazy: ts.Node, full: ts.Node, fileName: string) {
  const lazyChildren = children(lazy)
  const fullChildren = children(full)

  if (
    lazy.kind !== full.kind ||
    lazy.pos !== full.pos ||
    lazy.end !== full.end ||
    lazyChildren.length !== fullChildren.length
  ) {
    throw new Error(`openapi: ${fileName} parses to another tree with its JSDoc`)
  }

  const docs = ownJSDoc(full)

  if (docs) {
    for (const doc of docs) {
      internal.setParent(doc, lazy)
      internal.setParentRecursive(doc, false)
    }

    defineOwn(lazy, 'jsDoc', docs)
  }

  lazyChildren.forEach((child, index) => adoptJSDoc(child, fullChildren[index]!, fileName))
}

function hydrate(file: ts.SourceFile) {
  const options = pending.get(file)!

  pending.delete(file)

  const full = ts.createSourceFile(file.fileName, file.text, {
    ...options,
    jsDocParsingMode: ts.JSDocParsingMode.ParseAll,
  })

  adoptJSDoc(file, full, file.fileName)

  for (const field of FILE_FIELDS) {
    if (Object.hasOwn(full, field)) defineOwn(file, field, ownField(full, field))
  }
}

/**
 * Parses the JSDoc of the file of `node` if it is parsed lazily, and tells whether it did.
 */
function hydrateFileOf(node: ts.Node) {
  // Every node of a declaration file is ambient, which spares the walk up for most others.
  if (!armed || !pending.size || !(node.flags & internal.NodeFlags.Ambient)) return false

  let current: ts.Node | undefined = node

  while (current && !ts.isSourceFile(current)) current = current.parent

  if (!current || !pending.has(current)) return false

  hydrate(current)

  return true
}

const allocator = internal.objectAllocator

// A node reads its JSDoc through `jsDoc`, an own property of the nodes that have some, which hides
// these accessors: a node without one reads none, unless it is in a lazily parsed file.
for (const constructor of [
  allocator.getNodeConstructor(),
  allocator.getTokenConstructor(),
  allocator.getIdentifierConstructor(),
  allocator.getPrivateIdentifierConstructor(),
  allocator.getSourceFileConstructor(),
]) {
  Object.defineProperty(constructor.prototype, 'jsDoc', {
    configurable: true,
    get(this: ts.Node) {
      return hydrateFileOf(this) ? ownJSDoc(this) : undefined
    },
    set(this: ts.Node, jsDoc: ts.JSDoc[] | undefined) {
      // The node factory gives each node it creates an empty `jsDoc`: defining it would hide the
      // getter, and costs more on every node than the lazy parse saves.
      if (!jsDoc && !Object.hasOwn(this, 'jsDoc') && !hydrateFileOf(this)) return

      defineOwn(this, 'jsDoc', jsDoc)
    },
  })
}

for (const field of FILE_FIELDS) {
  Object.defineProperty(allocator.getSourceFileConstructor().prototype, field, {
    configurable: true,
    get(this: ts.SourceFile) {
      if (pending.has(this)) hydrate(this)

      return Object.hasOwn(this, field) ? ownField(this, field) : lazyFields.get(this)?.[field]
    },
    set(this: ts.SourceFile, value: JSDocFields[JSDocField]) {
      defineOwn(this, field, value)
    },
  })
}

/**
 * Parses a file like `ts.createSourceFile()`, and a declaration file without its JSDoc unless it may
 * deprecate something: such a file parses its JSDoc when one of its nodes reads it, or when it reads
 * a field that depends on it.
 */
export function createSourceFile(
  fileName: string,
  text: string,
  options: ts.CreateSourceFileOptions,
) {
  if (!/\.d\.[cm]?ts$/.test(fileName) || DEPRECATED_TAG.test(text)) {
    return ts.createSourceFile(fileName, text, options)
  }

  const file = ts.createSourceFile(fileName, text, {
    ...options,
    jsDocParsingMode: ts.JSDocParsingMode.ParseNone,
  })

  const fields: Partial<JSDocFields> = {}

  for (const field of FILE_FIELDS) {
    if (Object.hasOwn(file, field)) Object.assign(fields, { [field]: ownField(file, field) })

    Reflect.deleteProperty(file, field)
  }

  lazyFields.set(file, fields)
  pending.set(file, options)

  return file
}

/**
 * Lets the nodes of lazily parsed files parse their JSDoc when they read it, once the checker has
 * bound them: before, a node has no parent to find its file with. Until then, the program and the
 * binder read the JSDoc of a TypeScript file only to set the parents that `adoptJSDoc()` sets.
 */
export function hydrateOnRead() {
  armed = true
}
