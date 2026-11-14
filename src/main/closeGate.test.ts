import { describe, expect, it } from 'vitest'
import { answerOf, askToSavePrompt, conflictPrompt, parseDocumentStatus, START_GATE, stepCloseGate, windowTitle, type CloseGate, type CloseGateEvent } from './closeGate'

const ready: CloseGate = { ...START_GATE, ready: true }
const asking: CloseGate = { ...ready, phase: 'asking' }
const step = (gate: CloseGate, event: CloseGateEvent) => stepCloseGate(gate, event)

describe('stepCloseGate', () => {
  it.each<[string, CloseGate, CloseGateEvent, CloseGate, string]>([
    ['a renderer that never got ready closes', START_GATE, { kind: 'close-requested' }, START_GATE, 'allow'],
    ['a ready renderer is asked', ready, { kind: 'close-requested' }, asking, 'prevent-and-ask'],
    ['a second close while asking waits for the one question', asking, { kind: 'close-requested' }, asking, 'prevent'],
    ['an approved window closes', { ...ready, phase: 'approved' }, { kind: 'close-requested' }, { ...ready, phase: 'approved' }, 'allow'],
    ['a quit is remembered', ready, { kind: 'before-quit' }, { ...ready, quitting: true }, 'none'],
    ['yes closes the window', asking, { kind: 'answered', proceed: true }, { ...ready, phase: 'approved' }, 'close'],
    ['yes during a quit closes and quits again', { ...asking, quitting: true }, { kind: 'answered', proceed: true }, { ...ready, phase: 'approved', quitting: true }, 'close-and-quit'],
    ['no keeps the window and cancels the quit', { ...asking, quitting: true }, { kind: 'answered', proceed: false }, ready, 'none'],
    ['an answer nobody asked for does nothing', ready, { kind: 'answered', proceed: true }, ready, 'none'],
    ['the renderer says it is ready', START_GATE, { kind: 'renderer-ready' }, ready, 'none'],
    ['a reload or crash starts over', { ...asking, quitting: true }, { kind: 'renderer-reset' }, START_GATE, 'none']
  ])('%s', (_name, gate, event, next, effect) => {
    expect(step(gate, event)).toEqual({ gate: next, effect })
  })
})

describe('windowTitle', () => {
  it.each<[NodeJS.Platform, boolean, string]>([
    ['darwin', false, 'Raglan'],
    ['darwin', true, 'Raglan'],
    ['win32', false, 'Raglan - Parametric Pattern Maker'],
    ['win32', true, '*Raglan - Parametric Pattern Maker'],
    ['linux', true, '*Raglan - Parametric Pattern Maker']
  ])('on %s with unsaved %s is %s', (platform, dirty, title) => {
    expect(windowTitle({ name: 'Raglan', path: null, dirty }, platform)).toBe(title)
  })
})

describe('parseDocumentStatus', () => {
  it('keeps a good status and refuses anything else', () => {
    expect(parseDocumentStatus({ name: 'Raglan', path: '/a.json', dirty: true })).toEqual({ name: 'Raglan', path: '/a.json', dirty: true })
    expect(parseDocumentStatus({ name: 'Untitled', path: null, dirty: false })).toEqual({ name: 'Untitled', path: null, dirty: false })
    for (const raw of [null, 'x', {}, { name: '', path: null, dirty: false }, { name: 'a', path: 3, dirty: false }, { name: 'a', path: null, dirty: 'yes' }]) {
      expect(parseDocumentStatus(raw)).toBeNull()
    }
  })
})

describe('prompts', () => {
  it('maps each button of the unsaved-changes prompt to its answer, and anything else to Cancel', () => {
    const prompt = askToSavePrompt('Raglan')
    expect(prompt.options.message).toBe('Do you want to save the changes you made to Raglan?')
    expect(prompt.options.buttons?.map((_label, i) => answerOf(prompt, i))).toEqual(['save', 'discard', 'cancel'])
    expect(answerOf(prompt, 99)).toBe('cancel')
  })

  it('defaults the changed-on-disk prompt to Cancel', () => {
    const prompt = conflictPrompt('Raglan.json')
    expect(prompt.options.buttons).toEqual(['Replace', 'Save As…', 'Cancel'])
    expect(answerOf(prompt, prompt.options.defaultId ?? -1)).toBe('cancel')
    expect(answerOf(prompt, 1)).toBe('save-as')
  })
})
