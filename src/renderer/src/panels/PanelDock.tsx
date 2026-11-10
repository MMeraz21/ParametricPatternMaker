import type { ItemKey, PatternEdit } from '@core'
import type { PanelKind } from '../editor/state'
import { EditableTable } from './EditableTable'
import type { TableModel } from './tables'

const TABS: readonly { kind: PanelKind; label: string }[] = [
  { kind: 'measurement', label: 'Measurements' },
  { kind: 'variable', label: 'Variables' },
  { kind: 'point', label: 'Points' },
  { kind: 'segment', label: 'Segments' },
  { kind: 'piece', label: 'Pieces' },
  { kind: 'size', label: 'Sizes' }
]

interface PanelDockProps {
  /** The first is the tab's own table; the Pieces tab adds more below it. */
  tables: readonly TableModel[]
  onShowPanel: (kind: PanelKind) => void
  onEdit: (edit: PatternEdit) => void
  onSelect: (key: ItemKey) => void
}

export function PanelDock({ tables, onShowPanel, onEdit, onSelect }: PanelDockProps) {
  const kind = tables[0]?.kind
  return (
    <section aria-label="Editor panels" className="flex h-full flex-col bg-white">
      <div role="tablist" aria-label="Editor panels" className="flex gap-1 border-b border-neutral-200 px-2 pt-1">
        {TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={tab.kind === kind}
            onClick={() => onShowPanel(tab.kind)}
            className={`rounded-t px-3 py-1 text-sm ${
              tab.kind === kind ? 'border border-b-white border-neutral-200 bg-white font-medium -mb-px' : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Side by side: the dock is short, and a selected piece's tables must show without scrolling. */}
      <div role="tabpanel" aria-label={tables[0]?.title} className={`min-h-0 flex-1 ${tables.length > 1 ? 'grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,2fr)] grid-rows-[minmax(0,1fr)] divide-x divide-neutral-200' : ''}`}>
        {/* Keyed by id so a draft in one table can't reappear in a row of another. */}
        {tables.map((table) => (
          <EditableTable key={table.id} table={table} onEdit={onEdit} onSelect={onSelect} />
        ))}
      </div>
    </section>
  )
}
