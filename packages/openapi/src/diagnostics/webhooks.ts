import type { Diagnostic, SourceLocation } from '../types.ts'

export function webhookBodiesUnresolved(): Diagnostic {
  return {
    code: 'OA-W001',
    severity: 'error',
    message: 'webhooks: the config names no object type of webhook bodies',
    fix: 'write webhooks as defineWebhooks<Bodies>(), where Bodies is an exported type of the app with a key per webhook',
  }
}

export function webhookExampleNotJson(key: string, why: string): Diagnostic {
  return {
    code: 'OA-W002',
    severity: 'warning',
    message: `webhooks.examples: ${key} is not JSON (${why}), the example is ignored`,
    fix: 'give the example the JSON body the app sends',
  }
}

export function exampleWebhookUnknown(key: string): Diagnostic {
  return {
    code: 'OA-W003',
    severity: 'warning',
    message: `webhooks.examples: ${key} is not a webhook of the bodies type, the example is ignored`,
    fix: 'fix the key, or add the webhook to the bodies type',
  }
}

export function webhookBodyEmpty(name: string, location?: SourceLocation): Diagnostic {
  return {
    code: 'OA-W004',
    severity: 'warning',
    message: `webhook ${name}: the body has no JSON Schema and is emitted as {}`,
    fix: 'type the body as plain data',
    location,
  }
}
