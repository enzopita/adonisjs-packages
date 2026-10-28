import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { copyPlayground, run } from '../tests/support/playground.ts'

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '7' },
    only: { type: 'string' },
    profile: { type: 'boolean', default: false },
    update: { type: 'boolean', default: false },
    compare: { type: 'string' },
  },
})

const expectedFile = new URL('expected.json', import.meta.url)
const golden = new URL('../tests/fixtures/playground.openapi.json', import.meta.url)

const API_GROUP =
  /\nrouter\n {2}\.group\(\(\) => \{\n[\s\S]*?\n {2}\}\)\n {2}\.prefix\('\/api\/v1'\)\n/

/**
 * `large` repeats the playground's API group under 8 prefixes, so the per-route work dominates.
 */
const workloads = {
  small: async () => {},
  large: async (dir: string) => {
    const file = join(dir, 'start/routes.ts')
    const source = await readFile(file, 'utf8')
    const group = API_GROUP.exec(source)?.[0]

    if (!group) throw new Error('bench: the API group of start/routes.ts moved')

    const copies = [2, 3, 4, 5, 6, 7, 8].map(version =>
      group.replace("prefix('/api/v1')", `prefix('/api/v${version}')\n  .as('v${version}')`),
    )

    await writeFile(file, `${source}${copies.join('')}`)
  },
}

type Workload = keyof typeof workloads

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

// The success line ends with the duration, which is what the bench measures.
const normalized = (output: string) => output.replace(/ \([\d.]+ m?s\)/g, '')

async function generate(dir: string, nodeArgs: string[] = []) {
  const start = performance.now()

  const result = await run('node', [...nodeArgs, 'ace', 'openapi:generate'], { cwd: dir }).then(
    success => ({ ...success, failed: false }),
    (error: { stdout: string; stderr: string }) => ({ ...error, failed: true }),
  )

  const ms = performance.now() - start
  const document = await readFile(join(dir, 'openapi.json'), 'utf8').catch(() => '')

  return {
    ms,
    failed: result.failed,
    document,
    output: normalized(`${result.stdout}${result.stderr}`),
  }
}

const known = Object.keys(workloads)

const names = (values.only?.split(',') ?? known).filter((name): name is Workload =>
  known.includes(name),
)

const dirs = new Map<string, { workload: Workload; dir: string }>()

// `--compare` takes the root of another checkout, such as a worktree of main, and alternates runs of
// both, so the noise of the machine falls on both sides alike.
const sides: Array<[string, typeof copyPlayground]> = [['', copyPlayground]]

if (values.compare) {
  const other = join(values.compare, 'packages/openapi/tests/support/playground.ts')
  sides.push([' (compare)', (await import(other)).copyPlayground])
}

for (const name of names)
  for (const [suffix, copy] of sides)
    dirs.set(`${name}${suffix}`, { workload: name, dir: await copy(workloads[name]) })

if (values.profile) {
  const { profile } = await import('./profile.ts')

  for (const [name, { dir }] of dirs) {
    const out = await mkdtemp(join(tmpdir(), 'openapi-prof-'))

    await generate(dir, ['--cpu-prof', `--cpu-prof-dir=${out}`])
    const [file] = await readdir(out)

    console.log(`\n=== ${name} (${join(out, file!)})`)
    profile(JSON.parse(await readFile(join(out, file!), 'utf8')))
  }

  process.exit(0)
}

const expected: Record<string, { document: string; output: string; operations: number }> =
  JSON.parse(await readFile(expectedFile, 'utf8').catch(() => '{}'))

const goldenText = await readFile(golden, 'utf8')
const times = new Map<string, number[]>([...dirs.keys()].map(name => [name, []]))
const errors: string[] = []
const operations = new Map<string, number>()

const check = (label: string, name: Workload, result: Awaited<ReturnType<typeof generate>>) => {
  if (result.failed) errors.push(`${label}: the command failed\n${result.output}`)

  if (name === 'small' && result.document !== goldenText)
    errors.push(`${label}: the document differs from tests/fixtures/playground.openapi.json`)

  const document = JSON.parse(result.document || '{}')
  const count = Object.values(document.paths ?? {}).flatMap(item => Object.keys(item!)).length
  operations.set(label, count)

  const actual = { document: sha(result.document), output: sha(result.output), operations: count }

  if (values.update) expected[name] = actual
  else if (JSON.stringify(expected[name]) !== JSON.stringify(actual))
    errors.push(
      `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected[name])}\n${result.output}`,
    )
}

// One unmeasured run each warms the disk cache and checks the output before any timing.
for (const [label, { workload, dir }] of dirs) check(label, workload, await generate(dir))

if (values.update) await writeFile(expectedFile, `${JSON.stringify(expected, null, 2)}\n`)

for (let index = 0; index < Number(values.runs); index++)
  for (const [label, { workload, dir }] of dirs) {
    const result = await generate(dir)

    times.get(label)!.push(result.ms)
    check(label, workload, result)
  }

for (const [name, samples] of times) {
  const sorted = samples.toSorted((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!

  console.log(
    `${name.padEnd(16)} median ${median.toFixed(0)} ms  range ${sorted[0]!.toFixed(0)}-${sorted.at(-1)!.toFixed(0)} ms  runs ${sorted.length}  operations ${operations.get(name)}`,
  )
}

console.log(`errors ${errors.length}`)

for (const error of new Set(errors)) console.error(error)

process.exit(errors.length ? 1 : 0)
