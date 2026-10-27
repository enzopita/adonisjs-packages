import User from '#models/user'
import { echoProbeValidator, searchProbeValidator } from '#validators/probe'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Handler patterns whose responses are not a single returned body.
 */
export default class ProbeController {
  async model() {
    return new User()
  }

  async collections() {
    return { tags: new Set(['a']), counts: new Map([['a', 1]]), total: 10n }
  }

  async search({ request }: HttpContext) {
    return request.validateUsing(searchProbeValidator)
  }

  async item({ params }: HttpContext) {
    return { id: params.id as string | undefined }
  }

  async echo({ request }: HttpContext) {
    return request.validateUsing(echoProbeValidator)
  }

  async head() {
    return {}
  }
}
