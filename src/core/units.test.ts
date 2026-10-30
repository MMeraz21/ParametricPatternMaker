import { describe, expect, it } from 'vitest'
import { formatLength, toMm } from './units'

describe('formatLength', () => {
  it('shows cm to the millimetre and inches to the hundredth', () => {
    expect(formatLength(275, 'cm')).toBe('27.5')
    expect(formatLength(1000, 'cm')).toBe('100')
    expect(formatLength(1000, 'in')).toBe('39.37')
    expect(formatLength(25.4, 'in')).toBe('1')
    expect(formatLength(-0.01, 'cm')).toBe('0')
  })
})

describe('toMm', () => {
  it('converts typed values to mm', () => {
    expect(toMm(27.5, 'cm')).toBe(275)
    expect(toMm(2, 'in')).toBe(50.8)
  })
})
