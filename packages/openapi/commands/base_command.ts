import { BaseCommand, flags } from '@adonisjs/core/ace'
import { defineConfig } from '../src/define_config.ts'
import type { Diagnostic, OpenApiConfig } from '../src/types.ts'

/**
 * Generates the document the way `node ace codegen` reads the app: assembled like the web
 * environment, but never ready, so no long-running side effect starts.
 */
export abstract class OpenApiCommand extends BaseCommand {
  @flags.boolean({
    description: 'Fail on warnings too. Overrides "strict" in config/openapi.ts',
    showNegatedVariantInHelp: true,
  })
  declare strict?: boolean

  protected async generate() {
    this.app.setEnvironment('web')
    this.app.setMode('warmup')
    await this.app.boot()
    await this.app.warmUp()

    const router = await this.app.container.make('router')
    router.commit()

    const configured = this.app.config.get<OpenApiConfig | undefined>('openapi') ?? defineConfig()
    const config = { ...configured, strict: this.strict ?? configured.strict }

    // Loaded on run: it pulls in the TypeScript compiler, which every other ace command would pay for.
    const { generateDocument } = await import('../src/document/generate.ts')
    const generated = await generateDocument(this.app, router, config)

    for (const diagnostic of generated.diagnostics) this.#report(diagnostic)

    const failed = generated.diagnostics.some(({ severity }) => severity === 'error')

    if (failed) this.exitCode = 1

    return { ...generated, config, failed }
  }

  #report({ code, severity, route, message, fix, location }: Diagnostic) {
    const where = location ? ` (${location.file}:${location.line})` : ''
    const text = `${code} ${route ? `${route}: ` : ''}${message}${fix ? `: ${fix}` : ''}${where}`

    if (severity === 'error') this.logger.error(text)
    else this.logger.warning(text)
  }
}
