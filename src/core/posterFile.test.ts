import { describe, expect, it } from 'vitest'
import { raglanTee } from './fixtures/raglan'
import { evaluateGraded } from './graded'
import { planPoster, type PosterPlan } from './poster'
import { safeFileBase, writePosterFile } from './posterFile'

const planOf = (title: string, sizes: readonly string[]): PosterPlan => {
  const outcome = planPoster(raglanTee, evaluateGraded(raglanTee), { sizes, paper: 'letter', title })
  if (outcome.kind !== 'planned') throw new Error('nothing to print')
  return outcome.plan
}

describe('writePosterFile', () => {
  it('names a PDF by title, sizes and paper, and starts it with a PDF header', async () => {
    const file = await writePosterFile(planOf('Raglan', ['M']), 'pdf')
    expect(file.fileName).toBe('Raglan-M-letter.pdf')
    expect(new TextDecoder().decode(file.data.slice(0, 5))).toBe('%PDF-')
  })

  it('names an SVG by title and sizes, and writes UTF-8 text', async () => {
    const file = await writePosterFile(planOf('Raglan', ['S', 'XL']), 'svg')
    expect(file.fileName).toBe('Raglan-S-XL.svg')
    expect(new TextDecoder().decode(file.data)).toMatch(/^<\?xml/)
  })

  it('never lets a title name a directory', async () => {
    expect((await writePosterFile(planOf('../../etc/passwd', ['M']), 'pdf')).fileName).toBe('-..-etc-passwd-M-letter.pdf')
    expect((await writePosterFile(planOf('..\\..\\Windows', ['M']), 'svg')).fileName).toBe('-..-Windows-M.svg')
  })
})

describe('safeFileBase', () => {
  it.each([
    ['Raglan tee', 'Raglan tee'],
    ['a<b>c:d"e/f\\g|h?i*j', 'a-b-c-d-e-f-g-h-i-j'],
    ['tab\there\u0000', 'tab-here-'],
    ['trailing dots...', 'trailing dots'],
    ['trailing space   ', 'trailing space'],
    ['.hidden', 'hidden'],
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['com1', '_com1'],
    ['CONSOLE', 'CONSOLE'],
    ['', 'Pattern'],
    ['...', 'Pattern'],
    ['袖', '袖']
  ])('makes %j safe as %j', (name, safe) => {
    expect(safeFileBase(name)).toBe(safe)
  })

  it('keeps names short', () => {
    expect(safeFileBase('x'.repeat(500))).toHaveLength(120)
  })
})
