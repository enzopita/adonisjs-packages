/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'
import { openapiRoutes } from '@enzopita/adonisjs-openapi/routes'

router.get('/', () => {
  return { hello: 'world' }
})

router
  .group(() => {
    router
      .group(() => {
        router.post('signup', [controllers.NewAccount, 'store'])
        router.post('login', [controllers.AccessTokens, 'store'])
      })
      .prefix('auth')
      .as('auth')

    router
      .group(() => {
        router.get('profile', [controllers.Profile, 'show'])
        router.post('logout', [controllers.AccessTokens, 'destroy'])
        router.put('avatar', [controllers.Avatar, 'update']).use(middleware.tenant())
        router.delete('avatar', [controllers.Avatar, 'destroy']).use(middleware.tenant())
      })
      .prefix('account')
      .as('profile')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/', [controllers.Users, 'index'])
        router.get('/:id', [controllers.Users, 'show'])
      })
      .prefix('users')
      .as('users')

    router.post('webhooks/mail', [controllers.MailEvents, 'store']).as('webhooks.mail')

    router
      .group(() => {
        router.get('model', [controllers.Probe, 'model'])
        router.get('collections', [controllers.Probe, 'collections'])
        router.get('search', [controllers.Probe, 'search'])
        router.get('items/:id?', [controllers.Probe, 'item'])
        router.route('echo', ['GET', 'POST'], [controllers.Probe, 'echo'])
        router.route('head', ['HEAD'], [controllers.Probe, 'head'])
        router.get('closure', () => ({ ok: true })).as('closure')
      })
      .prefix('probe')
      .as('probe')
  })
  .prefix('/api/v1')

openapiRoutes().use(middleware.auth({ guards: ['basic'] }))
