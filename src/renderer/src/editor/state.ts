import { applyEdit, keyOf, sameItem, type ItemKey, type ItemKind, type Pattern, type PatternEdit, type SizeName } from '@core'
import type { DocumentFile, DocumentStatus } from '../file/bridge'

/**
 * The editor's document state, held in one useReducer at the App root. This reducer is the only
 * writer of the pattern; everything drawn is derived from it.
 */

/** Refers to the pattern, never to the resolved pattern, so a broken item stays selectable. */
export type Selection = ItemKey

/** A tab in the panel dock: one per item kind, and the sizes. */
export type PanelKind = ItemKind | 'size'

/** A file problem or remark, shown until dismissed or the next file command. */
export interface Notice {
  readonly tone: 'error' | 'info'
  readonly text: string
}

export interface EditorState {
  /** The document: what gets saved and, later, snapshotted for undo. */
  readonly pattern: Pattern
  /** The pattern as last opened or saved, by reference. Unsaved is `pattern !== saved`, so undoing back to it reads as saved. */
  readonly saved: Pattern
  /** Where the document is on disk. null is Untitled. */
  readonly file: DocumentFile | null
  /** View state, never saved or undone. */
  readonly notice: Notice | null
  readonly selection: Selection | null
  /** The tab shown in the panel dock. Selecting an item switches to its tab. */
  readonly panel: PanelKind
  /** What the user asked to see. May be stale; only `viewAt` reads it. Never saved or undone. */
  readonly wantedSize: SizeName
  /** Whether every other size is drawn nested around the shown one. */
  readonly nestShown: boolean
}

export type EditorAction =
  /** `size` also switches to that size, so an issue opens where it can be seen. */
  | { readonly type: 'select'; readonly selection: Selection | null; readonly size?: SizeName }
  | { readonly type: 'showPanel'; readonly panel: PanelKind }
  | { readonly type: 'edit'; readonly edit: PatternEdit }
  | { readonly type: 'showSize'; readonly size: SizeName }
  | { readonly type: 'showNest'; readonly shown: boolean }
  /** Open or New: a whole new document, saved as it is. Selection, panel and size start over, and so will undo history. */
  | { readonly type: 'replace'; readonly pattern: Pattern; readonly file: DocumentFile | null; readonly notice: Notice | null }
  /** `pattern` is what was written, captured before the write, so an edit made during the save stays unsaved. History is untouched. */
  | { readonly type: 'saved'; readonly pattern: Pattern; readonly file: DocumentFile }
  | { readonly type: 'notice'; readonly notice: Notice | null }

/** `size` defaults to the first size. The document starts saved. */
export function initEditorState(pattern: Pattern, size?: SizeName, file: DocumentFile | null = null): EditorState {
  return { pattern, saved: pattern, file, notice: null, selection: null, panel: 'measurement', wantedSize: size ?? pattern.sizes[0], nestShown: false }
}

export const isDirty = (state: EditorState): boolean => state.pattern !== state.saved

export const documentName = (state: EditorState): string => state.file?.name ?? 'Untitled'

export const documentStatus = (state: EditorState): DocumentStatus => ({ name: documentName(state), path: state.file?.path ?? null, dirty: isDirty(state) })

function select(state: EditorState, selection: Selection | null): EditorState {
  const same = selection && state.selection ? sameItem(selection, state.selection) : selection === state.selection
  const panel = selection?.kind ?? state.panel
  return same && panel === state.panel ? state : { ...state, selection, panel }
}

const showSize = (state: EditorState, size: SizeName): EditorState => (size === state.wantedSize ? state : { ...state, wantedSize: size })

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select':
      return showSize(select(state, action.selection), action.size ?? state.wantedSize)
    case 'showPanel':
      return action.panel === state.panel ? state : { ...state, panel: action.panel }
    case 'edit': {
      // The single place the pattern changes: undo history and dirty tracking hook in here.
      const pattern = applyEdit(state.pattern, action.edit)
      if (pattern === state.pattern) return state
      const selection = selectionAfter(state.selection, action.edit)
      // Only a new selection moves the tab: an edit made on another tab must not pull the dock back to the selected item's.
      const selected = selection === state.selection ? state : select(state, selection)
      return { ...showSize(selected, wantedSizeAfter(state.wantedSize, state.pattern, action.edit)), pattern }
    }
    case 'showSize':
      return showSize(state, action.size)
    case 'showNest':
      return action.shown === state.nestShown ? state : { ...state, nestShown: action.shown }
    case 'replace':
      return { ...initEditorState(action.pattern, undefined, action.file), notice: action.notice }
    case 'saved':
      return action.pattern === state.saved && action.file === state.file ? state : { ...state, saved: action.pattern, file: action.file }
    case 'notice':
      return action.notice === state.notice ? state : { ...state, notice: action.notice }
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
    case 'addSize':
    case 'removeSize':
    case 'renameSize':
      return selection
    default: {
      const _exhaustive: never = edit
      return _exhaustive
    }
  }
}

/** Adding shows the new size, renaming follows, removing the shown size moves to a neighbour. */
function wantedSizeAfter(wanted: SizeName, before: Pattern, edit: PatternEdit): SizeName {
  switch (edit.kind) {
    case 'addSize':
      return edit.name
    case 'renameSize':
      return wanted === edit.from ? edit.to : wanted
    case 'removeSize': {
      if (wanted !== edit.name) return wanted
      const index = before.sizes.indexOf(wanted)
      return before.sizes[index + 1] ?? before.sizes[index - 1] ?? wanted
    }
    case 'add':
    case 'remove':
    case 'rename':
    case 'setFormula':
    case 'setMeasurement':
    case 'setUnits':
    case 'setSegment':
    case 'setPiece':
    case 'retargetEdge':
    case 'removeEdge':
      return wanted
    default: {
      const _exhaustive: never = edit
      return _exhaustive
    }
  }
}
