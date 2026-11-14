import { editorReducer, type EditorAction, type EditorState } from './state'

/**
 * The editor state behind a synchronous `getState`, read in React with useSyncExternalStore. The file commands work across
 * awaits and must see a cell's draft the moment it commits, which useReducer only shows on the next render.
 * editorReducer is still the only writer. Design: docs/design/m8-file-io.md, decision 4.
 */
export interface EditorStore {
  getState(): EditorState
  /** Runs editorReducer synchronously. Notifies only when the state changed. */
  dispatch(action: EditorAction): void
  subscribe(listener: () => void): () => void
}

export function createEditorStore(initial: EditorState): EditorStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    dispatch(action) {
      const next = editorReducer(state, action)
      if (next === state) return
      state = next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
