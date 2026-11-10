import { applyEdit, keyOf, sameItem, type ItemKey, type ItemKind, type Pattern, type PatternEdit } from '@core'

/**
 * The editor's document state, held in one useReducer at the App root. This reducer is the only
 * writer of the pattern; everything drawn is derived from it.
 */

/** Refers to the pattern, never to the resolved pattern, so a broken item stays selectable. */
export type Selection = ItemKey

export interface EditorState {
  /** The document: what gets saved (M8) and snapshotted for undo. */
  readonly pattern: Pattern
  readonly selection: Selection | null
  /** The tab shown in the panel dock. Selecting an item switches to its tab. */
  readonly panel: ItemKind
}

export type EditorAction =
  | { readonly type: 'select'; readonly selection: Selection | null }
  | { readonly type: 'showPanel'; readonly panel: ItemKind }
  | { readonly type: 'edit'; readonly edit: PatternEdit }

export function initEditorState(pattern: Pattern): EditorState {
  return { pattern, selection: null, panel: 'measurement' }
}

function select(state: EditorState, selection: Selection | null): EditorState {
  const same = selection && state.selection ? sameItem(selection, state.selection) : selection === state.selection
  const panel = selection?.kind ?? state.panel
  return same && panel === state.panel ? state : { ...state, selection, panel }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select':
      return select(state, action.selection)
    case 'showPanel':
      return action.panel === state.panel ? state : { ...state, panel: action.panel }
    case 'edit': {
      // The single place the pattern changes: undo history and dirty tracking hook in here.
      const pattern = applyEdit(state.pattern, action.edit)
      if (pattern === state.pattern) return state
      return { ...select(state, selectionAfter(state.selection, action.edit)), pattern }
    }
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}

/** Adding selects the new item; renaming follows it; removing clears it. */
function selectionAfter(selection: Selection | null, edit: PatternEdit): Selection | null {
  switch (edit.kind) {
    case 'add':
      return keyOf(edit.item)
    case 'rename':
      if (!selection || !sameItem(selection, edit.item)) return selection
      return edit.item.kind === 'point' ? selection : { kind: edit.item.kind, name: edit.to }
    case 'remove':
      return selection && sameItem(selection, edit.item) ? null : selection
    case 'setFormula':
    case 'setMeasurement':
    case 'setUnits':
    case 'setSegment':
    case 'setPiece':
    case 'retargetEdge':
    case 'removeEdge':
      return selection
    default: {
      const _exhaustive: never = edit
      return _exhaustive
    }
  }
}
