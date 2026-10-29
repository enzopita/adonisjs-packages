import { spawn } from 'node:child_process'
import type { Socket } from 'node:net'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { debuglog } from 'node:util'
import { Worker } from 'node:worker_threads'
import { withoutNodeOptions, type ProgramCache } from '../program/program_cache.ts'
import type { WorkerAnswer, WorkerInput } from './document_request.ts'

const log = debuglog('openapi')

// The build compiles each source next to the others, so both have the extension of this file.
const workerFile = new URL(`./document_worker${extname(import.meta.url)}`, import.meta.url)
const processFile = new URL(`./document_process${extname(import.meta.url)}`, import.meta.url)

/**
 * Where the document is generated, off the main thread: it parses the app's program from the
 * start, and answers the first input it receives. Kept from holding the process open until `ref()`.
 */
interface Runner {
  answer: Promise<WorkerAnswer>
  post(input: WorkerInput): void
  ref(): void
  stop(): Promise<void>
}

function settled(answer: Promise<WorkerAnswer>) {
  // Read once the input is posted: a failure before it, which stops the runner, is the one it throws.
  answer.catch(() => undefined)

  return answer
}

function workerRunner(appRoot: string): Runner {
  const worker = new Worker(workerFile, { workerData: appRoot })

  worker.unref()

  return {
    answer: settled(
      new Promise((resolve, reject) => {
        worker.once('message', resolve)
        worker.once('error', reject)
        worker.once('exit', code =>
          reject(new Error(`openapi: the document worker exited with code ${code}`)),
        )
      }),
    ),
    post: input => worker.postMessage(input),
    ref: () => worker.ref(),
    stop: async () => {
      await worker.terminate()
    },
  }
}

function snapshotRunner(appRoot: string, blob: string): Runner {
  const child = spawn(
    process.execPath,
    ['--snapshot-blob', blob, fileURLToPath(processFile), appRoot],
    {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced',
      windowsHide: true,
      env: withoutNodeOptions(),
    },
  )

  child.unref()
  child.channel?.unref()

  // Held back until the process answers: one that fails, such as on a snapshot that does not
  // start, says nothing, and the worker thread that takes over prints what a run prints.
  const held: [NodeJS.WriteStream, Buffer][] = []
  let answered = false

  for (const [stream, target] of [
    [child.stdout!, process.stdout],
    [child.stderr!, process.stderr],
  ] as const) {
    // SAFETY: the pipes of a child process are sockets.
    const pipe = stream as Socket

    pipe.unref()
    pipe.on('data', (chunk: Buffer) =>
      answered ? target.write(chunk) : held.push([target, chunk]),
    )
  }

  return {
    answer: settled(
      new Promise<WorkerAnswer>((resolve, reject) => {
        child.once('message', resolve)
        child.on('error', reject)
        child.once('exit', code => reject(new Error(`the snapshot process exited with ${code}`)))
      }).then(answer => {
        answered = true

        for (const [target, chunk] of held) target.write(chunk)

        return answer
      }),
    ),
    post: input => child.send(input),
    ref: () => {
      child.ref()
      child.channel?.ref()
    },
    stop: async () => {
      child.kill()
    },
  }
}

/**
 * A runner started from the program cache when it holds a snapshot, which hands over to a
 * worker thread on any failure, with the input it got: the cache never fails a run.
 */
export function startRunner(appRoot: string, cache: ProgramCache | undefined): Runner {
  if (!cache?.exists) return workerRunner(appRoot)

  let current = snapshotRunner(appRoot, cache.blob)
  let input: WorkerInput | undefined
  let referenced = false
  let stopped = false

  const answer = current.answer.catch(async (error: Error) => {
    // Stopped by `generate()`, which no longer reads the answer, such as on a config that throws.
    if (stopped) throw error

    log('program cache: %s, generating on a worker thread', error.message)

    void current.stop()
    current = workerRunner(appRoot)

    if (referenced) current.ref()

    if (input) current.post(input)

    const fallback = await current.answer

    // The worker succeeded where the snapshot did not: the next run rebuilds it.
    cache.discard()

    return fallback
  })

  return {
    answer: settled(answer),
    post: posted => {
      input = posted
      current.post(posted)
    },
    ref: () => {
      referenced = true
      current.ref()
    },
    stop: () => {
      stopped = true

      return current.stop()
    },
  }
}
