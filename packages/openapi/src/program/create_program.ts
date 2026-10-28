import ts from 'typescript'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Parses the app's own program up front, before the `entryFile` exists, and returns how to create
 * it with that file added: its sources are the ones the app compiles, so the module augmentations
 * (container bindings, auth guards) the types depend on apply.
 */
export function prepareProgram(appRoot: string) {
  const dataFile = join(appRoot, '.adonisjs/client/data.d.ts')

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
  let entry: { file: string; source: string } | undefined

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === entry?.file)
      return ts.createSourceFile(fileName, entry.source, languageVersion)

    const cached = shouldCreateNewSourceFile ? undefined : parsed.get(fileName)

    if (cached) return cached

    const sourceFile = getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)

    if (sourceFile) parsed.set(fileName, sourceFile)

    return sourceFile
  }

  const fileExists = host.fileExists.bind(host)
  host.fileExists = fileName => fileName === entry?.file || fileExists(fileName)

  // Never bound: the checker of the program below binds the source files it shares with this one.
  ts.createProgram({ rootNames: [...config.fileNames, ...data], options, host })

  return (entryFile: string, entrySource: string) => {
    entry = { file: entryFile, source: entrySource }

    const program = ts.createProgram({
      rootNames: [...config.fileNames, entryFile, ...data],
      options,
      host,
    })

    return { program, options: config.options, dataFile }
  }
}
