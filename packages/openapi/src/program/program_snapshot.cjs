// @ts-check
/**
 * Builds the startup snapshot of the program cache, run as
 * `node --snapshot-blob <blob> --build-snapshot program_snapshot.cjs <input.json>`: it holds
 * TypeScript and the source files of the program the input names, parsed and bound. A process
 * started from it, as `node --snapshot-blob <blob> <entry> <appRoot>`, hands them to `entry`.
 *
 * JavaScript, not TypeScript: the builder of a snapshot runs a CommonJS script that has no
 * `exports`, which a compiled module writes to, and `require()` takes built-in modules alone.
 */
const { readFileSync } = require('node:fs')
const { createRequire, enableCompileCache, registerHooks } = require('node:module')
const { dirname } = require('node:path')
const { pathToFileURL } = require('node:url')
const { startupSnapshot } = require('node:v8')
const { runInThisContext } = require('node:vm')

/** @typedef {import('typescript')} TypeScript */
/** @typedef {import('./parsed_files.ts').ParsedFile} ParsedFile */
/** @typedef {import('./parsed_files.ts').ParsedFiles} ParsedFiles */

/** @type {import('./parsed_files.ts').ProgramInput & { typescript: string }} */
const input = JSON.parse(readFileSync(/** @type {string} */ (process.argv[2]), 'utf8'))

/**
 * @param {string} file
 * @returns {TypeScript}
 */
function loadTypeScript(file) {
  const module = { exports: {} }

  const wrapper = runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {${readFileSync(file, 'utf8')}\n})`,
    { filename: file },
  )

  wrapper(module.exports, require, module, file, dirname(file))

  // SAFETY: the module is the TypeScript compiler the input names.
  return /** @type {TypeScript} */ (module.exports)
}

/**
 * @param {TypeScript} typescript
 * @returns {ParsedFiles}
 */
function parse(typescript) {
  const host = typescript.createCompilerHost(input.options)
  const getSourceFile = host.getSourceFile.bind(host)
  /** @type {Map<string, ParsedFile>} */
  const files = new Map()

  host.getSourceFile = (fileName, options, onError, shouldCreateNewSourceFile) => {
    const sourceFile = getSourceFile(fileName, options, onError, shouldCreateNewSourceFile)

    if (sourceFile && options instanceof Object)
      files.set(fileName, {
        sourceFile,
        languageVersion: options.languageVersion,
        impliedNodeFormat: options.impliedNodeFormat,
        jsDocParsingMode: options.jsDocParsingMode,
      })

    return sourceFile
  }

  typescript.createProgram({ rootNames: input.rootNames, options: input.options, host })

  // SAFETY: internal to TypeScript, whose checker skips the files it already bound.
  const { bindSourceFile } =
    /** @type {{ bindSourceFile?: (file: import('typescript').SourceFile, options: import('typescript').CompilerOptions) => void }} */ (
      typescript
    )

  for (const { sourceFile } of files.values()) bindSourceFile?.(sourceFile, input.options)

  return { key: input.key, files }
}

const typescript = loadTypeScript(input.typescript)
const parsed = parse(typescript)
const GLOBAL = '@enzopita/adonisjs-openapi:typescript'
const SNAPSHOT_URL = 'openapi-snapshot:typescript'

Object.defineProperty(globalThis, Symbol.for(GLOBAL), { value: typescript })

startupSnapshot.setDeserializeMainFunction(() => {
  const typescriptUrl = pathToFileURL(input.typescript).href

  // The modules started from the snapshot import the compiler it holds.
  registerHooks({
    resolve: (specifier, context, next) => {
      const resolved = next(specifier, context)

      return resolved.url === typescriptUrl ? { url: SNAPSHOT_URL, shortCircuit: true } : resolved
    },
    load: (url, context, next) =>
      url === SNAPSHOT_URL
        ? {
            format: 'module',
            source: `export default globalThis[Symbol.for(${JSON.stringify(GLOBAL)})]`,
            shortCircuit: true,
          }
        : next(url, context),
  })

  enableCompileCache()

  const [, entry, appRoot] = /** @type {[string, string, string]} */ (process.argv)

  // SAFETY: the entry is the document process of the package that built this snapshot.
  const { fromSnapshot } =
    /** @type {{ fromSnapshot: (parsed: ParsedFiles, appRoot: string) => void }} */ (
      createRequire(entry)(entry)
    )

  fromSnapshot(parsed, appRoot)
})
