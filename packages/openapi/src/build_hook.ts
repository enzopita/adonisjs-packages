import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { isAbsolute, relative } from 'node:path'
import type { Bundler } from '@adonisjs/assembler'
import { hooks } from '@adonisjs/core/app'

/**
 * Runs before `node ace build` compiles the app and copies the meta files, and adds the document
 * the config `output` names to them, so it lands in the build folder at the same path.
 */
const generateOnBuild: (bundler: Bundler) => void | PromiseLike<void> = hooks.buildStarting(
  async bundler => {
    bundler.ui.logger.info('generating the OpenAPI document', { suffix: 'openapi:generate' })

    const child = spawn(process.execPath, ['ace', 'openapi:generate'], {
      cwd: bundler.cwdPath,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    })

    let output: string | undefined

    child.on('message', (message: { openapiOutput?: string }) => {
      output = message.openapiOutput ?? output
    })

    const [code] = await once(child, 'close')

    if (code !== 0) throw new Error(`"node ace openapi:generate" exited with code ${code}`)

    const pattern = output && relative(bundler.cwdPath, output)

    if (!pattern || pattern.startsWith('..') || isAbsolute(pattern)) {
      bundler.ui.logger.warning(`the OpenAPI document at ${output} is outside the app, not shipped`)

      return
    }

    const metaFiles = (bundler.options.metaFiles ??= [])

    if (!metaFiles.some(file => file.pattern === pattern))
      metaFiles.push({ pattern, reloadServer: false })
  },
)

export default generateOnBuild
