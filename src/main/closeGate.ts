import type { MessageBoxOptions } from 'electron'
import type { DocumentStatus, SaveChoice } from '../preload/api'

/**
 * The window's close decision, its title, and the native prompts' wording, all pure. documentWindow.ts applies them.
 * Design: docs/design/m8-file-io.md, decisions 7 and 11.
 */

export interface CloseGate {
  /** The renderer has registered its listener and pushed a status. A renderer that isn't there can't be asked. */
  readonly ready: boolean
  readonly phase: 'open' | 'asking' | 'approved'
  /** A quit is waiting on this close. */
  readonly quitting: boolean
}

export const START_GATE: CloseGate = { ready: false, phase: 'open', quitting: false }

export type CloseGateEvent =
  | { readonly kind: 'close-requested' }
  | { readonly kind: 'before-quit' }
  | { readonly kind: 'answered'; readonly proceed: boolean }
  | { readonly kind: 'renderer-ready' }
  /** A main-frame navigation (reload) or a renderer that's gone: an answer will never come. */
  | { readonly kind: 'renderer-reset' }

export type CloseGateEffect =
  /** Let this close happen. */
  | 'allow'
  /** Stop this close. A question is already out. */
  | 'prevent'
  /** Stop this close and ask the renderer. */
  | 'prevent-and-ask'
  /** Close the window now. */
  | 'close'
  /** Close the window, then quit again, because the prevented close cancelled the first quit. */
  | 'close-and-quit'
  | 'none'

export function stepCloseGate(gate: CloseGate, event: CloseGateEvent): { readonly gate: CloseGate; readonly effect: CloseGateEffect } {
  switch (event.kind) {
    case 'close-requested':
      if (!gate.ready || gate.phase === 'approved') return { gate, effect: 'allow' }
      if (gate.phase === 'asking') return { gate, effect: 'prevent' }
      return { gate: { ...gate, phase: 'asking' }, effect: 'prevent-and-ask' }
    case 'before-quit':
      return { gate: { ...gate, quitting: true }, effect: 'none' }
    case 'answered':
      if (gate.phase !== 'asking') return { gate, effect: 'none' }
      if (!event.proceed) return { gate: { ...gate, phase: 'open', quitting: false }, effect: 'none' }
      return { gate: { ...gate, phase: 'approved' }, effect: gate.quitting ? 'close-and-quit' : 'close' }
    case 'renderer-ready':
      return { gate: { ...gate, ready: true }, effect: 'none' }
    case 'renderer-reset':
      return { gate: { ready: false, phase: 'open', quitting: false }, effect: 'none' }
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

export const APP_NAME = 'Parametric Pattern Maker'

/** macOS shows the name alone, with the edited dot set separately. Elsewhere the app name follows, with `*` when unsaved. */
export function windowTitle(status: DocumentStatus, platform: NodeJS.Platform): string {
  if (platform === 'darwin') return status.name
  return `${status.dirty ? '*' : ''}${status.name} - ${APP_NAME}`
}

/** What the renderer pushed, if it has the right shape. */
export function parseDocumentStatus(raw: unknown): DocumentStatus | null {
  if (typeof raw !== 'object' || raw === null || !('name' in raw) || !('path' in raw) || !('dirty' in raw)) return null
  const { name, path, dirty } = raw
  if (typeof name !== 'string' || name === '' || (path !== null && typeof path !== 'string') || typeof dirty !== 'boolean') return null
  return { name, path, dirty }
}

/** A native message box and what each of its buttons means, kept together so they can't disagree. */
export interface Prompt<Answer> {
  readonly options: MessageBoxOptions
  readonly answers: readonly Answer[]
}

/** The answer for a button index. Anything unexpected is the prompt's cancel answer. */
export function answerOf<Answer>(prompt: Prompt<Answer>, response: number): Answer {
  const answer = prompt.answers[response] ?? prompt.answers[prompt.options.cancelId ?? -1]
  if (answer === undefined) throw new Error('A prompt needs a cancel answer')
  return answer
}

export function askToSavePrompt(name: string): Prompt<SaveChoice> {
  return {
    options: {
      type: 'warning',
      message: `Do you want to save the changes you made to ${name}?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    },
    answers: ['save', 'discard', 'cancel']
  }
}

export function conflictPrompt(fileName: string): Prompt<'replace' | 'save-as' | 'cancel'> {
  return {
    options: {
      type: 'warning',
      message: `${fileName} was changed by another program since you opened it.`,
      detail: 'Replace it with your version, or save yours somewhere else?',
      buttons: ['Replace', 'Save As…', 'Cancel'],
      defaultId: 2,
      cancelId: 2,
      noLink: true
    },
    answers: ['replace', 'save-as', 'cancel']
  }
}
