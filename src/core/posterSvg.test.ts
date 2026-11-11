import { describe, expect, it } from 'vitest'
import { raglanPrintHazards, raglanTee } from './fixtures/raglan'
import { evaluateGraded } from './graded'
import type { Pattern } from './model'
import { planPoster, type PosterPlan } from './poster'
import { writePosterSvg } from './posterSvg'

const planOf = (pattern: Pattern, sizes: readonly string[]): PosterPlan => {
  const outcome = planPoster(pattern, evaluateGraded(pattern), { sizes, paper: 'letter', title: 'Raglan & <friends>' })
  if (outcome.kind !== 'planned') throw new Error('nothing to print')
  return outcome.plan
}

describe('writePosterSvg', () => {
  it('is sized in mm, with one user unit per mm', () => {
    const plan = planOf(raglanTee, ['M'])
    const svg = writePosterSvg(plan)
    const [sheet] = plan.sheets
    const match = /<svg [^>]*width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
    expect(match?.slice(1).map(Number)).toEqual([sheet.width, sheet.height, sheet.width, sheet.height].map((n) => Math.round(n * 1e6) / 1e6))
  })

  it('stacks every size, each in its own group, with a 50 mm gap', () => {
    const plan = planOf(raglanTee, ['S', 'M', 'L'])
    const svg = writePosterSvg(plan)
    const tops = [...svg.matchAll(/<g data-size="(\w+)" transform="translate\(0 ([\d.]+)\)">/g)].map((m) => [m[1], Number(m[2])])
    const [s, m] = plan.sheets
    const expected = [0, s.height + 50, s.height + 50 + (m?.height ?? 0) + 50]
    expect(tops.map(([size]) => size)).toEqual(['S', 'M', 'L'])
    tops.forEach(([, top], i) => expect(top).toBeCloseTo(expected[i] ?? NaN, 5))
  })

  it('escapes names and keeps text the PDF font cannot show', () => {
    const svg = writePosterSvg(planOf(raglanPrintHazards, ['M']))
    expect(svg).toContain('>Sleeve &lt;袖&gt; &amp; &quot;cuff&quot;</text>')
    expect(svg).toContain('<title>Raglan &amp; &lt;friends&gt;</title>')
    expect(svg).not.toMatch(/<[^/!?a-z]/)
  })

  it('draws no page guides', () => {
    const svg = writePosterSvg(planOf(raglanTee, ['M']))
    expect(svg).not.toContain(' | ')
    expect(svg).not.toContain('stroke-dasharray="2 2"')
    expect(svg).toContain('stroke-dasharray="8 2 1.5 2"')
  })

  it('names fonts that exist on Linux, macOS and Windows', () => {
    expect(writePosterSvg(planOf(raglanTee, ['M']))).toContain('font-family="Helvetica, Arial, sans-serif"')
  })
})
