import ts from 'typescript'
import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileReuse, parseKey, type ParsedFiles, type ProgramInput } from './parsed_files.ts'

/**
 * Parses the app's own program up front, with an empty `entryFile`, and returns how to create it
 * with the source of that file: its sources are the ones the app compiles, so the module
 * augmentations (container bindings, auth guards) the types depend on apply. Takes the files of
 * `previous` that a fresh parse would give, already parsed and bound.
 */
export function prepareProgram(appRoot: string, previous?: ParsedFiles) {
  const dataFile = join(appRoot, '.adonisjs/client/data.d.ts')
  // TypeScript names files with `/`, and the compiler host matches this one by string.
  const entryFile = join(appRoot, '.adonisjs/openapi/routes.ts').split(sep).join('/')

  const config = ts.getParsedCommandLineOfConfigFile(
    join(appRoot, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: diagnostic => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    },
  )

  if (!config) throw new Error(`openapi: cannot read ${join(appRoot, 'tsconfig.json')}`)

  const options = { ...config.options, noEmit: true }
  const key = parseKey(options)
  const host = ts.createCompilerHost(config.options)
  const files = fileReuse(host, key, previous)
  const getSourceFile = host.getSourceFile.bind(host)
  const parsed = new Map<string, ts.SourceFile>()
  const data = existsSync(dataFile) ? [dataFile] : []
  let entrySource = ''

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === entryFile) return ts.createSourceFile(fileName, entrySource, languageVersion)

    const cached = shouldCreateNewSourceFile ? undefined : parsed.get(fileName)

    if (cached) return cached

    const reused = shouldCreateNewSourceFile ? undefined : files.reuse(fileName, languageVersion)

    if (reused) {
      parsed.set(fileName, reused)

      return reused
    }

    const sourceFile = getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)

    if (sourceFile) {
      parsed.set(fileName, sourceFile)
      files.parsed(sourceFile)
    }

    return sourceFile
  }

  const fileExists = host.fileExists.bind(host)
  host.fileExists = fileName => fileName === entryFile || fileExists(fileName)

  const rootNames = [...config.fileNames, entryFile, ...data]

  // Bound only in the files it reuses: the checker of the program below binds the others, and
  // reuses the module resolutions of every file but the entry.
  const oldProgram = ts.createProgram({ rootNames, options, host })

  const { stats } = files
  // Parsing an eighth of the text anew costs about a sixth of a second for a small app.
  const stale = stats.parsedText * 8 > stats.reusedText + stats.parsedText

  // `configFile` is a parsed file, which cannot leave the thread.
  const { configFile: _, ...plain }: ts.CompilerOptions & { configFile?: unknown } = options

  const cacheInput: ProgramInput | undefined =
    key !== undefined && stale
      ? { key, rootNames: [...config.fileNames, ...data], options: plain }
      : undefined

  return {
    entryFile,
    stats,
    /**
     * What to rebuild the program cache from, once it misses more than an eighth of the text.
     */
    cacheInput,
    create(source: string) {
      entrySource = source

      const program = ts.createProgram({ rootNames, options, host, oldProgram })

      return { program, options: config.options, dataFile }
    },
  }
}
