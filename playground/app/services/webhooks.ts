interface Envelope<Type extends string, Data> {
  /**
   * The same across the retries of one delivery.
   */
  id: string
  type: Type
  occurredAt: string
  data: Data
}

/**
 * The bodies the app POSTs to the URL of each subscriber, by event.
 */
export interface WebhookBodies {
  /**
   * A user signed up.
   *
   * Sent once the account exists, before its email is verified.
   */
  'user.created': Envelope<'user.created', { userId: number; email: string }>
  /**
   * A user deleted their account.
   */
  'user.deleted': Envelope<'user.deleted', { userId: number }>
  /**
   * A user changed their email.
   *
   * @deprecated Read the email from `user.updated` instead.
   */
  'user.email_changed': Envelope<'user.email_changed', { userId: number; email: string }>
}
