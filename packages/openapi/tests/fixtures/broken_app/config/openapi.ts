import { errors as authErrors } from '@adonisjs/auth'
import { defineConfig } from '@enzopita/adonisjs-openapi'

export default defineConfig({
  errors: {
    throwers: { verifyCredentials: authErrors.E_INVALID_CREDENTIALS },
  },
})
