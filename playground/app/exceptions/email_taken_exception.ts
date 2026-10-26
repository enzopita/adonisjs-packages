import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

export default class EmailTakenException extends Exception {
  static override status = 409
  static override code = 'E_EMAIL_TAKEN'

  constructor(public email: string) {
    super(`An account with ${email} already exists`)
  }

  toResponse() {
    return { code: 'E_EMAIL_TAKEN' as const, message: this.message }
  }

  async handle(error: this, { response }: HttpContext) {
    response.status(error.status).send(error.toResponse())
  }
}
