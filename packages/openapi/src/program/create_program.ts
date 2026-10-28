import ts from 'typescript'
import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'

/**
 * Parses the app's own program up front, with an empty `entryFile`, and returns how to create it
 * with the source of that file: its sources are the ones the app compiles, so the module
 * augmentations (container bindings, auth guards) the types depend on apply.
 */
export function prepareProgram(appRoot: string) {
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
  const host = ts.createCompilerHost(config.options)
  const getSourceFile = host.getSourceFile.bind(host)
  const parsed = new Map<string, ts.SourceFile>()
  const data = existsSync(dataFile) ? [dataFile] : []
  let entrySource = ''

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === entryFile) return ts.createSourceFile(fileName, entrySource, languageVersion)

    const cached = shouldCreateNewSourceFile ? undefined : parsed.get(fileName)

    if (cached) return cached

    const sourceFile = getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)

    if (sourceFile) parsed.set(fileName, sourceFile)

    return sourceFile
  }

  const fileExists = host.fileExists.bind(host)
  host.fileExists = fileName => fileName === entryFile || fileExists(fileName)

  const rootNames = [...config.fileNames, entryFile, ...data]

  // Never bound: the checker of the program below binds the source files it shares with this one,
  // and reuses the module resolutions of every file but the entry.
  const oldProgram = ts.createProgram({ rootNames, options, host })

  return {
    entryFile,
    create(source: string) {
      entrySource = source

      const program = ts.createProgram({ rootNames, options, host, oldProgram })

      return { program, options: config.options, dataFile }
    },
  }
}
