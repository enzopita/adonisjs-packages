import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { copyPlayground, run } from './support/playground.ts'

const golden = await readFile(new URL('fixtures/playground.openapi.json', import.meta.url), 'utf8')

/**
 * Runs `openapi:generate` with the program cache in `cache`, or with it off. Returns the document,
 * the cache's debug lines, and the rest of the output, less the duration it ends with.
 */
async function generate(dir: string, cache: string) {
  const { stdout, stderr } = await run('node', ['ace', 'openapi:generate'], {
    cwd: dir,
    env: { ...process.env, ADONISJS_OPENAPI_CACHE: cache, NODE_DEBUG: 'openapi' },
  })

  const lines = `${stdout}${stderr}`.split('\n')
  const debug = /^OPENAPI \d+: /

  return {
    document: await readFile(join(dir, 'openapi.json'), 'utf8'),
    log: lines.filter(line => debug.test(line)).join('\n'),
    output: lines
      .filter(line => !debug.test(line))
      .join('\n')
      .replace(/ \([\d.]+ m?s\)/g, ''),
  }
}

// The build runs detached: it is done once the snapshot is in place and its other files are gone.
async function built(cache: string) {
  for (const started = Date.now(); Date.now() - started < 150_000; await setTimeout(200)) {
    const files = await readdir(cache)

    if (files.length === 1 && files[0]!.endsWith('.blob')) return join(cache, files[0]!)
  }

  throw new Error(
    `the program cache in ${cache} was not built: ${(await readdir(cache)).join(', ')}`,
  )
}

test.group('openapi:generate with the program cache', group => {
  let dir: string
  let cache: string

  group.setup(async () => {
    dir = await copyPlayground(async () => {})
    cache = await mkdtemp(join(tmpdir(), 'openapi-cache-'))

    return () => rm(cache, { recursive: true, force: true })
  })

  test('two cold runs at once build one snapshot, which a warm run starts from', async ({
    assert,
  }) => {
    const cold = await Promise.all([generate(dir, cache), generate(dir, cache)])

    for (const { document, log } of cold) {
      assert.include(log, 'missing')
      assert.isTrue(document === golden)
    }

    await built(cache)

    const warm = await generate(dir, cache)

    assert.match(warm.log, /: \d+ source files reused \(\d+ KB\), 0 parsed/)
    assert.notInclude(warm.log, 'worker thread')
    assert.isTrue(warm.document === golden)
    assert.equal(warm.output, cold[0].output)
  }).timeout(240_000)

  test('a warm run parses anew the files that changed or appeared, and forgets those that went', async ({
    assert,
  }) => {
    const controller = join(dir, 'app/controllers/probe_controller.ts')
    const added = join(dir, 'app/cache_probe.ts')
    const source = await readFile(controller, 'utf8')

    await writeFile(added, 'export type CacheProbe = { fresh: true }\n')
    await writeFile(
      controller,
      `import type { CacheProbe } from '../cache_probe.js'\n${source.replace(
        'async empty() {\n    return null',
        'async empty(): Promise<CacheProbe> {\n    return { fresh: true }',
      )}`,
    )

    const warm = await generate(dir, cache)
    const off = await generate(dir, 'false')

    assert.match(warm.log, /, 2 parsed/)
    assert.include(off.log, 'program cache: off')
    assert.isTrue(warm.document !== golden)
    assert.isTrue(warm.document === off.document)
    assert.equal(warm.output, off.output)

    // The import stays and no longer resolves.
    await rm(added)

    const gone = await generate(dir, cache)
    const goneOff = await generate(dir, 'false')

    assert.isTrue(gone.document === goneOff.document)
    assert.equal(gone.output, goneOff.output)

    await writeFile(controller, source)

    assert.isTrue((await generate(dir, cache)).document === golden)
  }).timeout(120_000)

  test('a run that fails before it asks for the document exits as it would without the cache', async ({
    assert,
  }) => {
    await built(cache)

    const config = join(dir, 'config/openapi.ts')
    const source = await readFile(config, 'utf8')

    await writeFile(
      config,
      source.replace('defineConfig({', "defineConfig({\n  operationId: () => '',"),
    )

    const failure = (cache: string) =>
      generate(dir, cache).then(
        () => assert.fail('the run succeeded'),
        (error: { stdout: string; stderr: string }) => `${error.stdout}${error.stderr}`,
      )

    const [failed, failedOff] = [await failure(cache), await failure('false')]

    await writeFile(config, source)

    assert.include(failed, 'operationId() must return a non-empty string')
    assert.include(failedOff, 'operationId() must return a non-empty string')
  }).timeout(120_000)

  test('a snapshot that does not start leaves the run as it would be without the cache', async ({
    assert,
  }) => {
    const blob = await built(cache)
    const off = await generate(dir, 'false')

    await writeFile(blob, 'not a snapshot')

    const broken = await generate(dir, cache)

    assert.include(broken.log, 'generating on a worker thread')
    assert.isTrue(broken.document === golden)
    assert.equal(broken.output, off.output)
  }).timeout(120_000)

  test('a snapshot that failed is neither started nor rebuilt for a day', async ({ assert }) => {
    const [marker] = (await readdir(cache)).filter(name => name.endsWith('.failed'))

    assert.exists(marker)

    const backedOff = await generate(dir, cache)

    assert.include(backedOff.log, 'failed lately')
    assert.notInclude(backedOff.log, 'building')
    assert.isTrue(backedOff.document === golden)
    assert.deepEqual(await readdir(cache), [marker])

    const dayAgo = new Date(Date.now() - 25 * 60 * 60_000)
    await utimes(join(cache, marker!), dayAgo, dayAgo)

    const retried = await generate(dir, cache)

    assert.include(retried.log, 'missing')
    assert.include(retried.log, 'building')
    assert.isTrue(retried.document === golden)

    await built(cache)
  }).timeout(240_000)
})
