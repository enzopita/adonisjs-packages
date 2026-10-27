import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Json } from '../src/types.ts'
import { OpenApiCommand } from './base_command.ts'

const SHOWN = 20

function children(value: Json | undefined) {
  if (Array.isArray(value)) return new Map(value.map((item, index) => [String(index), item]))

  if (value instanceof Object) return new Map(Object.entries(value))

  return undefined
}

/**
 * The JSON Pointers where `committed` and `generated` differ, stopping at the first differing
 * value of each branch.
 */
function differences(
  committed: Json | undefined,
  generated: Json | undefined,
  pointer = '',
): string[] {
  const left = children(committed)
  const right = children(generated)

  if (!left || !right)
    return JSON.stringify(committed) === JSON.stringify(generated) ? [] : [pointer || '/']

  return [...new Set([...left.keys(), ...right.keys()])].flatMap(key =>
    differences(
      left.get(key),
      right.get(key),
      `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
    ),
  )
}

export default class CheckOpenApi extends OpenApiCommand {
  static commandName = 'openapi:check'
  static description =
    'Fail on diagnostics, or when the committed OpenAPI document differs from the one the app generates. Writes no file'

  /**
   * The JSON Pointers where the committed file differs from `generated`, empty when it is up to
   * date, or undefined when there is no file.
   */
  async #changes(output: string, generated: string) {
    let committed: string

    try {
      committed = await readFile(output, 'utf8')
    } catch {
      return undefined
    }

    if (committed === generated) return []

    try {
      const before: Json = JSON.parse(committed)
      const after: Json = JSON.parse(generated)
      const changed = differences(before, after)

      // Same content in another formatting, such as a file a formatter rewrote.
      return changed.length ? changed : ['the formatting']
    } catch {
      return ['/']
    }
  }

  async run() {
    const { document, config, failed } = await this.generate()
    const output = resolve(fileURLToPath(this.app.appRoot), config.output)
    const changed = await this.#changes(output, `${JSON.stringify(document, null, 2)}\n`)

    if (failed) this.logger.error('The errors above fail the check')

    if (!changed) {
      this.logger.error(`${config.output} does not exist: run node ace openapi:generate`)
      this.exitCode = 1

      return
    }

    if (!changed.length) {
      if (!failed) this.logger.success(`${config.output} is up to date`)

      return
    }

    this.logger.error(
      `${config.output} is out of date: run node ace openapi:generate. It differs at:`,
    )

    for (const pointer of changed.slice(0, SHOWN)) this.logger.log(`  ${pointer}`)

    if (changed.length > SHOWN) this.logger.log(`  and ${changed.length - SHOWN} more`)

    this.exitCode = 1
  }
}
