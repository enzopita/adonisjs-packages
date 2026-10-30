import { webhookExampleNotJson } from '../diagnostics/webhooks.ts'
import type { Diagnostic, Json, WebhooksConfig } from '../types.ts'

/**
 * The `webhooks` config as a worker thread receives it: each example as the JSON the app sends.
 */
export interface WireWebhooks {
  examples: Record<string, Json>
}

export function wireWebhooks(webhooks: WebhooksConfig, diagnostics: Diagnostic[]): WireWebhooks {
  const examples: Record<string, Json> = {}

  for (const [key, value] of Object.entries(webhooks.examples ?? {})) {
    try {
      const text = JSON.stringify(value)

      if (text === undefined)
        diagnostics.push(webhookExampleNotJson(key, 'JSON.stringify writes nothing for it'))
      else examples[key] = JSON.parse(text)
    } catch (error) {
      diagnostics.push(webhookExampleNotJson(key, String(error)))
    }
  }

  return { examples }
}
