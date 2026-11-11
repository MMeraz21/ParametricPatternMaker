import { describe, expect, it } from 'vitest'
import { evaluateGraded, planPoster, printStatus } from '@core'
import { raglanFailingInXXL, raglanTee } from '@core/fixtures/raglan'
import { defaultPaper, defaultTicks, pagesOf, refusalText, stageAfter } from './stage'

describe('stageAfter', () => {
  it('maps every save result', () => {
    expect(stageAfter({ kind: 'saved', path: '/a.pdf' })).toEqual({ kind: 'saved', path: '/a.pdf' })
    expect(stageAfter({ kind: 'cancelled' })).toEqual({ kind: 'idle' })
    expect(stageAfter({ kind: 'failed', message: 'The disk is full.' })).toEqual({ kind: 'failed', message: 'The disk is full.' })
  })
})

describe('defaultPaper', () => {
  it.each([
    ['en-US', 'letter'],
    ['en-CA', 'letter'],
    ['es-MX', 'letter'],
    ['en-GB', 'a4'],
    ['de-DE', 'a4'],
    ['ja-JP', 'a4'],
    ['en', 'a4'],
    ['C', 'a4'],
    ['', 'a4']
  ])('gives %j %s', (locale, paper) => {
    expect(defaultPaper(locale)).toBe(paper)
  })
})

describe('the size list', () => {
  const status = printStatus(raglanFailingInXXL, evaluateGraded(raglanFailingInXXL))

  it('ticks the shown size only when it can print', () => {
    expect([...defaultTicks(status, 'M')]).toEqual(['M'])
    expect([...defaultTicks(status, 'XXL')]).toEqual([])
  })

  it('says why XXL cannot print, naming both pieces', () => {
    expect(status.map(refusalText)).toEqual([null, null, null, null, "XXL can't be printed: Front has no cut line, Neckband has no outline."])
  })

  it('counts pages across sheets', () => {
    const outcome = planPoster(raglanTee, evaluateGraded(raglanTee), { sizes: ['S', 'M'], paper: 'letter', title: 'R' })
    expect(outcome.kind === 'planned' && pagesOf(outcome.plan)).toBe(39)
  })
})
