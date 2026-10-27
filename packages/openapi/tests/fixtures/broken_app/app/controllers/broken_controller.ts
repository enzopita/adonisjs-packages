import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'

const ledger = { reject() {} }

/**
 * @tags Broken
 */
export default class BrokenController {
  /**
   * @throws {404} Not found
   */
  async numeric() {
    return { ok: true }
  }

  /**
   * @throws {PlanLimitException | MaintenanceException}
   */
  async union() {
    return { ok: true }
  }

  /**
   * @throws {LimitException}
   */
  async duplicate() {
    return { ok: true }
  }

  /**
   * @throws {QuotaException}
   */
  async missing() {
    return { ok: true }
  }

  /**
   * @throws {import('#exceptions/billing/limit_exception').default}
   */
  async escaped() {
    return { ok: true }
  }

  /**
   * @response {418} A teapot
   */
  async underived() {
    return { ok: true }
  }

  /**
   * @reponse {404} Not found
   */
  async misspelled() {
    return { ok: true }
  }

  async unread({ request }: HttpContext) {
    const user = await User.verifyCredentials(request.input('email'), request.input('password'))
    return { id: user.id }
  }

  async ledger() {
    ledger.reject()
    return { ok: true }
  }
}
