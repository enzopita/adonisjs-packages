import User from '#models/user'

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
}
