import { errors as authErrors } from '@adonisjs/auth'
import { defineConfig } from '@enzopita/adonisjs-openapi'

export default defineConfig({
  errors: {
    throwers: { getUserOrFail: authErrors.E_UNAUTHORIZED_ACCESS },
  },
})
