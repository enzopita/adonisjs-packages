import { debuglog } from 'node:util'
import { prepareProgram } from '../program/create_program.ts'
import type { ParsedFiles } from '../program/parsed_files.ts'
import { answer, type WorkerInput } from './document_request.ts'

const log = debuglog('openapi')

/**
 * The document worker of a process started from the startup snapshot of the program cache, which
 * holds `parsed`. Any failure exits the process with no output: the main thread then generates
 * the document on a worker thread, which reports it.
 */
export function fromSnapshot(parsed: ParsedFiles, appRoot: string) {
  // The main thread is gone: nothing will ask for the document.
  process.once('disconnect', () => process.exit(1))

  let prepared: ReturnType<typeof prepareProgram>

  try {
    prepared = prepareProgram(appRoot, parsed)
  } catch {
    process.exit(1)
  }

  const { reusedFiles, reusedText, parsedFiles, parsedText } = prepared.stats

  log(
    'program cache: %d source files reused (%d KB), %d parsed (%d KB)',
    reusedFiles,
    Math.round(reusedText / 1024),
    parsedFiles,
    Math.round(parsedText / 1024),
  )

  process.once('message', (input: WorkerInput) => {
    try {
      process.send!(answer(input, prepared))
    } catch {
      process.exit(1)
    }
  })
}
