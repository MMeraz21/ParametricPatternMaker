import { applyEdit, type Id, type Pattern, type PatternEdit } from '@core'

/**
 * The editor's document state, held in one useReducer at the App root. This reducer is the only
 * writer of the pattern; everything drawn is derived from it.
 */

/** Refers to the pattern by id, never to the resolved pattern, so a broken point stays selectable. */
export type Selection = { readonly kind: 'point'; readonly id: Id }

export interface EditorState {
  /** The document: what gets saved (M8) and snapshotted for undo. */
  readonly pattern: Pattern
  readonly selection: Selection | null
}

export type EditorAction =
  | { readonly type: 'select'; readonly selection: Selection | null }
  | { readonly type: 'edit'; readonly edit: PatternEdit }

export function initEditorState(pattern: Pattern): EditorState {
  return { pattern, selection: null }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select': {
      const same = state.selection?.id === action.selection?.id && state.selection?.kind === action.selection?.kind
      return same ? state : { ...state, selection: action.selection }
    }
    case 'edit': {
      // The single place the pattern changes: undo history and dirty tracking hook in here.
      const pattern = applyEdit(state.pattern, action.edit)
      return pattern === state.pattern ? state : { ...state, pattern }
    }
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}
