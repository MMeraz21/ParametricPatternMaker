import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { evaluateGraded, viewAt } from '@core'
import { raglanTee } from '@core/fixtures/raglan'
import { Canvas } from './canvas/Canvas'
import { buildScene } from './canvas/scene'
import { Inspector } from './editor/Inspector'
import { IssuesPanel } from './editor/IssuesPanel'
import { ExportDialog } from './export/ExportDialog'
import { inspectPoint, selectionForIssue } from './editor/inspect'
import { documentStatus, initEditorState } from './editor/state'
import { createEditorStore } from './editor/store'
import { createFileCommands } from './file/commands'
import { NoticeBar } from './file/NoticeBar'
import { PanelDock } from './panels/PanelDock'
import { tablesFor } from './panels/tables'

/** Ends a cell edit, so its draft commits through onBlur before a file command reads the document. */
function blurActiveElement(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

export function App() {
  const [version, setVersion] = useState<string>()
  useEffect(() => {
    void window.api.getVersion().then(setVersion)
  }, [])

  // An untitled raglan at M seeds the document until templates (M9) exist. Any opened file starts at its first size.
  const [store] = useState(() => createEditorStore(initEditorState(raglanTee, 'M')))
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const { pattern, selection, panel, wantedSize, nestShown, notice } = state
  const dispatch = store.dispatch
  const [files] = useState(() => createFileCommands(store, { api: window.api, commitDraft: blurActiveElement }))
  // Menu clicks, shortcuts and close requests all run through the one command runner.
  useEffect(() => window.api.onFileCommand((command) => void files.run(command)), [files])
  const status = documentStatus(state)
  // Main shows this in the title bar and the recent list. Sent after the listener exists, so main knows the renderer can answer.
  useEffect(() => window.api.setDocumentStatus({ name: status.name, path: status.path, dirty: status.dirty }), [status.name, status.path, status.dirty])
  const graded = useMemo(() => evaluateGraded(pattern), [pattern])
  const view = useMemo(() => viewAt(graded, wantedSize), [graded, wantedSize])
  const scene = useMemo(() => buildScene(pattern, view, selection, nestShown), [pattern, view, selection, nestShown])
  const tables = useMemo(() => tablesFor(panel, pattern, view, selection), [panel, pattern, view, selection])
  const inspection = selection?.kind === 'point' ? inspectPoint(pattern, view, selection.id) : null
  // View state: never saved or undone.
  const [exportOpen, setExportOpen] = useState(false)

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-800">
      <header className="flex items-baseline gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <h1 className="text-base font-semibold">Parametric Pattern Maker</h1>
        <p className="text-xs text-neutral-500">v{version ?? '…'}</p>
        <p aria-label="Document" className="text-sm text-neutral-700">
          {status.name}
          {status.dirty && <span className="text-neutral-500"> — Edited</span>}
        </p>
        <label className="ml-auto flex items-center gap-1 text-sm text-neutral-600">
          Size
          <select
            aria-label="Size"
            value={view.size}
            onChange={(e) => dispatch({ type: 'showSize', size: e.target.value })}
            className="rounded border border-neutral-300 bg-white px-1 py-0.5"
          >
            {view.sizes.map(({ name, issueCount }) => (
              <option key={name} value={name}>
                {issueCount === 0 ? name : `${name} (${issueCount} ${issueCount === 1 ? 'issue' : 'issues'})`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm text-neutral-600">
          <input type="checkbox" checked={nestShown} onChange={(e) => dispatch({ type: 'showNest', shown: e.target.checked })} />
          All sizes
        </label>
        <label className="flex items-center gap-1 text-sm text-neutral-600">
          Units
          <select
            value={pattern.units}
            onChange={(e) => {
              const units = e.target.value
              if (units === 'cm' || units === 'in') dispatch({ type: 'edit', edit: { kind: 'setUnits', units } })
            }}
            className="rounded border border-neutral-300 bg-white px-1 py-0.5"
          >
            <option value="cm">cm</option>
            <option value="in">inches</option>
          </select>
        </label>
        <button type="button" onClick={() => setExportOpen(true)} className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-sm text-neutral-700 hover:bg-neutral-100">
          Export…
        </button>
      </header>
      {notice && <NoticeBar notice={notice} onDismiss={() => dispatch({ type: 'notice', notice: null })} />}
      <main className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Canvas scene={scene} onSelect={(id) => dispatch({ type: 'select', selection: id ? { kind: 'point', id } : null })} />
          </div>
          <div className="h-64 shrink-0 border-t border-neutral-200">
            <PanelDock
              tables={tables}
              onShowPanel={(kind) => dispatch({ type: 'showPanel', panel: kind })}
              onEdit={(edit) => dispatch({ type: 'edit', edit })}
              onSelect={(key) => dispatch({ type: 'select', selection: key })}
            />
          </div>
        </div>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 bg-white">
          <Inspector inspection={inspection} units={pattern.units} onEdit={(edit) => dispatch({ type: 'edit', edit })} />
          <IssuesPanel issues={view.issues} onOpen={(issue) => dispatch({ type: 'select', selection: selectionForIssue(issue), size: issue.openAt })} />
        </aside>
      </main>
      {exportOpen && <ExportDialog pattern={pattern} graded={graded} shownSize={view.size} defaultTitle={state.file?.name ?? 'Pattern'} onClose={() => setExportOpen(false)} />}
    </div>
  )
}
