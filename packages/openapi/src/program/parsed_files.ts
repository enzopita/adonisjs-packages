import ts from 'typescript'

/**
 * A source file of an earlier run, parsed and bound, with the arguments TypeScript parsed it with.
 */
export interface ParsedFile {
  sourceFile: ts.SourceFile
  languageVersion: ts.ScriptTarget
  impliedNodeFormat: ts.ResolutionMode
  jsDocParsingMode: ts.JSDocParsingMode | undefined
}

/**
 * The source files the program cache holds, parsed and bound under the compiler options `key` stands for.
 */
export interface ParsedFiles {
  key: string
  files: Map<string, ParsedFile>
}

/**
 * What the program cache is built from: the program of the app, less the document's entry file.
 */
export interface ProgramInput {
  key: string
  rootNames: string[]
  options: ts.CompilerOptions
}

interface Internals {
  getKeyForCompilerOptions?: (
    options: ts.CompilerOptions,
    declarations: readonly object[],
  ) => string
  sourceFileAffectingCompilerOptions?: readonly object[]
}

/**
 * The key the language service of TypeScript shares parsed and bound files between programs by:
 * the options that change what the parser and the binder produce. Undefined when this version of
 * TypeScript lacks it, and then no file is reused.
 */
export function parseKey(options: ts.CompilerOptions) {
  // SAFETY: both are internal to TypeScript, read only when present.
  const { getKeyForCompilerOptions, sourceFileAffectingCompilerOptions } = ts as Internals

  if (!getKeyForCompilerOptions || !sourceFileAffectingCompilerOptions) return undefined

  // The key ends with the base of `paths`, which module resolution alone reads: without it, apps
  // that share their dependencies, such as copies of one app, share their parsed files too.
  return getKeyForCompilerOptions(
    { ...options, pathsBasePath: undefined },
    sourceFileAffectingCompilerOptions,
  )
}

/**
 * Hands out the files of `previous` that a fresh parse would give as they are: same text, parsed
 * with the same arguments, under the same `key`. Counts the text it reused and the text parsed anew.
 */
export function fileReuse(host: ts.CompilerHost, key: string | undefined, previous?: ParsedFiles) {
  const files = previous && key !== undefined && previous.key === key ? previous.files : undefined
  const stats = { reusedFiles: 0, reusedText: 0, parsedFiles: 0, parsedText: 0 }

  return {
    stats,
    reuse(fileName: string, options: ts.ScriptTarget | ts.CreateSourceFileOptions) {
      const file = files?.get(fileName)

      if (
        !file ||
        !(options instanceof Object) ||
        file.languageVersion !== options.languageVersion ||
        file.impliedNodeFormat !== options.impliedNodeFormat ||
        file.jsDocParsingMode !== options.jsDocParsingMode ||
        host.readFile(fileName) !== file.sourceFile.text
      )
        return undefined

      stats.reusedFiles++
      stats.reusedText += file.sourceFile.text.length

      return file.sourceFile
    },
    parsed(sourceFile: ts.SourceFile) {
      stats.parsedFiles++
      stats.parsedText += sourceFile.text.length
    },
  }
}
