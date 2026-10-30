import { useEffect, useMemo, useReducer, useState } from 'react'
import { evaluate } from '@core'
import { raglanTee } from '@core/fixtures/raglan'
import { Canvas } from './canvas/Canvas'
import { buildScene } from './canvas/scene'
import { Inspector } from './editor/Inspector'
import { IssuesPanel } from './editor/IssuesPanel'
import { inspectPoint } from './editor/inspect'
import { editorReducer, initEditorState } from './editor/state'

export function App() {
  const [version, setVersion] = useState<string>()
  useEffect(() => {
    void window.api.getVersion().then(setVersion)
  }, [])

  // The raglan fixture seeds the document until file I/O (M8) and templates (M9) exist.
  const [{ pattern, selection }, dispatch] = useReducer(editorReducer, raglanTee, initEditorState)
  const resolved = useMemo(() => evaluate(pattern, pattern.activeSize), [pattern])
  const scene = useMemo(() => buildScene(pattern, resolved, selection), [pattern, resolved, selection])
  const inspection = selection ? inspectPoint(pattern, resolved, selection.id) : null

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-800">
      <header className="flex items-baseline gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <h1 className="text-base font-semibold">Parametric Pattern Maker</h1>
        <p className="text-xs text-neutral-500">v{version ?? '…'}</p>
        <p className="ml-auto text-sm text-neutral-600">Size {resolved.size}</p>
      </header>
      <main className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Canvas scene={scene} onSelect={(id) => dispatch({ type: 'select', selection: id ? { kind: 'point', id } : null })} />
        </div>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 bg-white">
          <Inspector inspection={inspection} onEdit={(edit) => dispatch({ type: 'edit', edit })} />
          <IssuesPanel issues={resolved.issues} onSelect={(next) => dispatch({ type: 'select', selection: next })} />
        </aside>
      </main>
    </div>
  )
}
