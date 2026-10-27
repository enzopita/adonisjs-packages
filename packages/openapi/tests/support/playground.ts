import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type {
  JsonSchema,
  OpenApiDocument,
  OpenApiReference,
  OpenApiResponse,
} from '../../src/types.ts'

export const playground = new URL('../../../../playground/', import.meta.url)
export const brokenApp = new URL('../fixtures/broken_app/', import.meta.url)
export const unauthorizedApp = new URL('../fixtures/unauthorized_app/', import.meta.url)
export const run = promisify(execFile)

/**
 * The response a test expects in the operation, failing on a `$ref` to `components.responses`.
 */
export function inline(response: OpenApiResponse | OpenApiReference | undefined) {
  if (!response || '$ref' in response)
    throw new Error(`expected an inline response, got ${JSON.stringify(response)}`)

  return response
}

/**
 * The response itself, or the one its `$ref` names in `components.responses`.
 */
export function resolved(
  document: OpenApiDocument,
  response: OpenApiResponse | OpenApiReference | undefined,
) {
  if (!response || !('$ref' in response)) return inline(response)

  return inline(document.components.responses?.[response.$ref.split('/').at(-1)!])
}

export const json = (response: OpenApiResponse | OpenApiReference | undefined) =>
  inline(response).content!['application/json']!.schema

export const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  properties,
  additionalProperties: false,
  required: Object.keys(properties),
})

let generated: Promise<{ document: OpenApiDocument; logs: string; raw: string }> | undefined

/**
 * Generates the playground document once for every spec that reads it.
 */
export function generatePlayground() {
  generated ??= (async () => {
    await run('node', ['ace', 'codegen'], { cwd: playground })

    const { stdout: logs } = await run('node', ['ace', 'openapi:generate'], { cwd: playground })

    const raw = await readFile(new URL('openapi.json', playground), 'utf8')
    const document: OpenApiDocument = JSON.parse(raw)

    return { document, logs, raw }
  })()

  return generated
}

/**
 * A copy of the playground with `overlay` laid over it, so the playground stays valid. Returns the
 * copy's directory and what `openapi:generate` printed.
 */
export async function generateInCopy(overlay: (dir: string) => Promise<void>) {
  const source = fileURLToPath(playground)
  const dir = await mkdtemp(join(tmpdir(), 'openapi-copy-'))

  await cp(source, dir, {
    recursive: true,
    filter: path =>
      !/^(node_modules|tmp|build|\.adonisjs|openapi\.json)(\/|$)/.test(relative(source, path)),
  })
  await symlink(join(source, 'node_modules'), join(dir, 'node_modules'))
  await mkdir(join(dir, 'tmp'))
  await overlay(dir)
  await run('node', ['ace', 'codegen'], { cwd: dir })

  const result = await run('node', ['ace', 'openapi:generate'], { cwd: dir }).then(
    success => success,
    (error: { stdout: string; stderr: string }) => error,
  )

  return { dir, output: `${result.stdout}${result.stderr}` }
}
