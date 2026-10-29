import { describe, expect, it } from 'vitest'
import { topologicalSort } from './graph'

const graph = (edges: Record<string, string[]>) => (node: string) => edges[node] ?? []

describe('topologicalSort', () => {
  it('orders every node after its dependencies', () => {
    const deps = { a: ['b', 'c'], b: ['c'], c: [], d: ['a'] }
    const { order, cycles } = topologicalSort(Object.keys(deps), graph(deps))
    expect(cycles).toEqual([])
    expect(order).toEqual(['c', 'b', 'a', 'd'])
  })

  it('is deterministic and keeps independent nodes in input order', () => {
    const { order } = topologicalSort(['x', 'y', 'z'], graph({}))
    expect(order).toEqual(['x', 'y', 'z'])
  })

  it('ignores dependencies on unknown nodes', () => {
    const { order, cycles } = topologicalSort(['a'], graph({ a: ['missing'] }))
    expect(order).toEqual(['a'])
    expect(cycles).toEqual([])
  })

  it('detects a self-loop', () => {
    const { order, cycles } = topologicalSort(['a', 'b'], graph({ a: ['a'] }))
    expect(order).toEqual(['b'])
    expect(cycles).toEqual([{ members: ['a'], path: ['a', 'a'] }])
  })

  it('detects a longer cycle and reports a concrete path', () => {
    const deps = { a: ['b'], b: ['c'], c: ['a'], d: [] }
    const { order, cycles } = topologicalSort(Object.keys(deps), graph(deps))
    expect(order).toEqual(['d'])
    expect(cycles).toHaveLength(1)
    expect(cycles[0]?.members).toEqual(['a', 'b', 'c'])
    expect(cycles[0]?.path).toEqual(['a', 'b', 'c', 'a'])
  })

  it('reports every member of a component even when the path is shorter', () => {
    // a <-> b and a -> c -> a: one component, shortest cycle only visits a and b.
    const deps = { a: ['b', 'c'], b: ['a'], c: ['a'] }
    const { cycles } = topologicalSort(Object.keys(deps), graph(deps))
    expect(cycles).toHaveLength(1)
    expect(cycles[0]?.members).toEqual(['a', 'b', 'c'])
    expect(cycles[0]?.path).toHaveLength(3)
  })

  it('excludes nodes downstream of a cycle from both order and cycles', () => {
    const deps = { a: ['b'], b: ['a'], c: ['a'] }
    const { order, cycles } = topologicalSort(Object.keys(deps), graph(deps))
    expect(order).toEqual(['c'])
    expect(cycles[0]?.members).toEqual(['a', 'b'])
  })

  it('handles separate cycles independently', () => {
    const deps = { a: ['b'], b: ['a'], c: ['d'], d: ['c'] }
    const { cycles } = topologicalSort(Object.keys(deps), graph(deps))
    expect(cycles.map((c) => c.members)).toEqual([['a', 'b'], ['c', 'd']])
  })
})
