import { describe, expect, it } from 'vitest'
import { compileFormula, evaluateExpr, isValidName, type CompiledFormula, type Reference } from './formula'

function compile(source: string): CompiledFormula {
  const result = compileFormula(source)
  if (!result.ok) throw new Error(`Expected '${source}' to compile: ${result.message}`)
  return result.formula
}

function run(source: string, scope: Record<string, number> = {}): number {
  return evaluateExpr(compile(source).expr, (ref) => {
    const key = ref.kind === 'symbol' ? ref.name : `${ref.name}.${ref.axis}`
    const value = scope[key]
    if (value === undefined) throw new Error(`No value for ${key}`)
    return value
  })
}

describe('compileFormula', () => {
  it('collects unique symbol and point references in order', () => {
    const refs: Reference[] = compile('chest / 4 + ease + A.x - A.y + chest + A.x').references
    expect(refs).toEqual([
      { kind: 'symbol', name: 'chest' },
      { kind: 'symbol', name: 'ease' },
      { kind: 'pointCoord', name: 'A', axis: 'x' },
      { kind: 'pointCoord', name: 'A', axis: 'y' }
    ])
  })

  it('does not treat functions or constants as references', () => {
    expect(compile('max(a, sqrt(b)) * pi').references).toEqual([
      { kind: 'symbol', name: 'a' },
      { kind: 'symbol', name: 'b' }
    ])
  })

  it.each([
    ['', 'empty'],
    ['1 +', 'syntax error'],
    ['x = 3', 'assignment'],
    ['f(x) = x', 'function definition'],
    ['[1, 2]', 'matrix'],
    ['"text"', 'string literal'],
    ['evaluate("1")', 'unknown function'],
    ['A.z', 'non-coordinate property'],
    ['A["x"]["y"]', 'nested access'],
    ['sqrt', 'bare function name'],
    ['1:3', 'range'],
    ['a; b', 'block']
  ])('rejects %j (%s)', (source) => {
    expect(compileFormula(source).ok).toBe(false)
  })
})

describe('evaluateExpr', () => {
  it('follows normal precedence', () => {
    expect(run('2 + 3 * 4 ^ 2')).toBe(50)
    expect(run('(2 + 3) * 4')).toBe(20)
    expect(run('-2 ^ 2')).toBe(-4)
    expect(run('10 % 4')).toBe(2)
  })

  it('supports implicit multiplication', () => {
    expect(run('2 chest', { chest: 500 })).toBe(1000)
  })

  it('resolves symbols and point coordinates', () => {
    expect(run('chest / 4 + A.x', { chest: 1000, 'A.x': 5 })).toBe(255)
  })

  it('evaluates whitelisted functions and constants', () => {
    expect(run('hypot(3, 4)')).toBe(5)
    expect(run('min(3, 1, 2)')).toBe(1)
    expect(run('round(deg(pi))')).toBe(180)
    expect(run('cos(rad(60))')).toBeCloseTo(0.5)
    expect(run('tau / pi')).toBe(2)
  })

  it('evaluates comparisons and conditionals', () => {
    expect(run('a > b ? a : b', { a: 3, b: 7 })).toBe(7)
    expect(run('a >= 3 ? 1 : 0', { a: 3 })).toBe(1)
  })

  it('returns non-finite values for the caller to report', () => {
    expect(run('1 / 0')).toBe(Infinity)
    expect(run('sqrt(-1)')).toBeNaN()
  })
})

describe('isValidName', () => {
  it('accepts identifiers', () => {
    expect(isValidName('chest')).toBe(true)
    expect(isValidName('A1')).toBe(true)
    expect(isValidName('_tmp')).toBe(true)
  })

  it('rejects malformed and reserved names', () => {
    expect(isValidName('1A')).toBe(false)
    expect(isValidName('back length')).toBe(false)
    expect(isValidName('')).toBe(false)
    expect(isValidName('pi')).toBe(false)
    expect(isValidName('sqrt')).toBe(false)
  })
})
