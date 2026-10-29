export interface SortResult<T> {
  /** Nodes not involved in any cycle, ordered so every node comes after its dependencies. */
  order: T[]
  /** Each strongly connected component that contains a cycle. */
  cycles: Cycle<T>[]
}

export interface Cycle<T> {
  /** Every node in the strongly connected component; none of them can be evaluated. */
  members: T[]
  /** One concrete cycle through the component, starting and ending at the same node, e.g. [a, b, a]. */
  path: T[]
}

interface Vertex<T> {
  node: T
  deps: Vertex<T>[]
  index: number
  lowLink: number
  onStack: boolean
}

/**
 * Topologically sort a dependency graph and detect cycles (Tarjan's SCC algorithm).
 * `dependencies(node)` lists the nodes `node` depends on; nodes not in `nodes` are ignored.
 * Output is deterministic for a given input order.
 */
export function topologicalSort<T>(nodes: readonly T[], dependencies: (node: T) => readonly T[]): SortResult<T> {
  const vertices = new Map<T, Vertex<T>>()
  for (const node of nodes) vertices.set(node, { node, deps: [], index: -1, lowLink: -1, onStack: false })
  for (const vertex of vertices.values()) {
    for (const dep of dependencies(vertex.node)) {
      const target = vertices.get(dep)
      if (target) vertex.deps.push(target)
    }
  }

  const stack: Vertex<T>[] = []
  let counter = 0
  const order: T[] = []
  const cycles: Cycle<T>[] = []

  // Tarjan emits each SCC only after every SCC it depends on, which is exactly dependency order.
  const strongConnect = (vertex: Vertex<T>): void => {
    vertex.index = vertex.lowLink = counter++
    stack.push(vertex)
    vertex.onStack = true

    for (const dep of vertex.deps) {
      if (dep.index === -1) {
        strongConnect(dep)
        vertex.lowLink = Math.min(vertex.lowLink, dep.lowLink)
      } else if (dep.onStack) {
        vertex.lowLink = Math.min(vertex.lowLink, dep.index)
      }
    }

    if (vertex.lowLink !== vertex.index) return

    const component = new Set<Vertex<T>>()
    let member: Vertex<T> | undefined
    while ((member = stack.pop()) !== undefined) {
      member.onStack = false
      component.add(member)
      if (member === vertex) break
    }

    if (component.size === 1 && !vertex.deps.includes(vertex)) {
      order.push(vertex.node)
    } else {
      const members = nodes.filter((node) => {
        const v = vertices.get(node)
        return v !== undefined && component.has(v)
      })
      cycles.push({ members, path: findCyclePath(vertex, component).map((v) => v.node) })
    }
  }

  for (const vertex of vertices.values()) if (vertex.index === -1) strongConnect(vertex)

  return { order, cycles }
}

/** Shortest path from `start` back to itself staying inside one strongly connected component. */
function findCyclePath<T>(start: Vertex<T>, component: Set<Vertex<T>>): Vertex<T>[] {
  const previous = new Map<Vertex<T>, Vertex<T>>()
  const queue: Vertex<T>[] = [start]
  for (const vertex of queue) {
    for (const dep of vertex.deps) {
      if (dep === start) {
        const path = [start]
        for (let at: Vertex<T> | undefined = vertex; at && at !== start; at = previous.get(at)) path.push(at)
        path.push(start)
        return path.reverse()
      }
      if (component.has(dep) && !previous.has(dep)) {
        previous.set(dep, vertex)
        queue.push(dep)
      }
    }
  }
  // Every strongly connected component with more than one vertex, or with a self-loop, contains a cycle.
  throw new Error('Invariant violated: strongly connected component without a cycle')
}
