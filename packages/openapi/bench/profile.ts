interface ProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number }
  children?: number[]
}

interface CpuProfile {
  nodes: ProfileNode[]
  samples: number[]
  timeDeltas: number[]
}

const label = ({ functionName, url, lineNumber }: ProfileNode['callFrame']) =>
  `${functionName || '(anonymous)'} ${url.replace(/^.*\/(node_modules|build\/src)\//, '')}:${lineNumber}`

function top(totals: Map<string, number>, count: number) {
  for (const [key, us] of [...totals].toSorted((a, b) => b[1] - a[1]).slice(0, count))
    console.log(`${(us / 1000).toFixed(0).padStart(7)} ms  ${key}`)
}

/**
 * Prints the self time per file and per function, and the inclusive time of the package's own
 * functions, from a `--cpu-prof` profile.
 */
export function profile({ nodes, samples, timeDeltas }: CpuProfile) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const parent = new Map<number, number>()

  for (const node of nodes) for (const child of node.children ?? []) parent.set(child, node.id)

  const sampled = new Map<number, number>()

  for (const [index, id] of samples.entries())
    sampled.set(id, (sampled.get(id) ?? 0) + (timeDeltas[index] ?? 0))

  const selfFile = new Map<string, number>()
  const selfFunction = new Map<string, number>()
  const inclusive = new Map<string, number>()

  const add = (totals: Map<string, number>, key: string, us: number) =>
    totals.set(key, (totals.get(key) ?? 0) + us)

  for (const [id, us] of sampled) {
    const { callFrame } = byId.get(id)!

    add(selfFile, callFrame.url.replace(/^.*\/node_modules\//, '') || '(native)', us)
    add(selfFunction, label(callFrame), us)

    const seen = new Set<string>()

    for (
      let current: number | undefined = id;
      current !== undefined;
      current = parent.get(current)
    ) {
      const frame = byId.get(current)!.callFrame

      if (!frame.url.includes('/build/src/')) continue

      const key = label(frame)

      if (!seen.has(key)) add(inclusive, key, us)

      seen.add(key)
    }
  }

  const total = [...sampled.values()].reduce((sum, us) => sum + us, 0)

  console.log(`total ${(total / 1000).toFixed(0)} ms\n-- self time by file`)
  top(selfFile, 10)
  console.log('-- self time by function')
  top(selfFunction, 20)
  console.log('-- inclusive time of the package functions')
  top(inclusive, 30)
}
