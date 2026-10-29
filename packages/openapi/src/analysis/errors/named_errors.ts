import type { ErrorsConfig } from '../../types.ts'

type Named = { name: string }

type NamedEntries = Record<string, Named | readonly Named[] | false>

/**
 * The `errors` config with each class down to its name, the only part of it the document reads,
 * which a worker thread can receive.
 */
export type NamedErrors = Pick<ErrorsConfig, 'body'> & {
  throwers?: NamedEntries
  middleware?: NamedEntries
}

const isList = <T>(value: T | readonly T[]): value is readonly T[] => Array.isArray(value)

type Entry = NonNullable<ErrorsConfig['throwers']>[string]

function named(value: Entry) {
  if (value === false) return value

  return isList(value) ? value.map(item => item && { name: item.name }) : { name: value.name }
}

const namedEntries = (entries: ErrorsConfig['throwers']): NamedEntries | undefined =>
  entries && Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, named(value)]))

export function namedErrors({ body, throwers, middleware }: ErrorsConfig): NamedErrors {
  return { body, throwers: namedEntries(throwers), middleware: namedEntries(middleware) }
}
