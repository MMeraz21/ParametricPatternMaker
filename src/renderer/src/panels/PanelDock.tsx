import type { ItemKey, ItemKind, PatternEdit } from '@core'
import { EditableTable } from './EditableTable'
import type { TableModel } from './tables'

const TABS: readonly { kind: ItemKind; label: string }[] = [
  { kind: 'measurement', label: 'Measurements' },
  { kind: 'variable', label: 'Variables' },
  { kind: 'point', label: 'Points' }
]

interface PanelDockProps {
  table: TableModel
  onShowPanel: (kind: ItemKind) => void
  onEdit: (edit: PatternEdit) => void
  onSelect: (key: ItemKey) => void
}

export function PanelDock({ table, onShowPanel, onEdit, onSelect }: PanelDockProps) {
  return (
    <section aria-label="Editor panels" className="flex h-full flex-col bg-white">
      <div role="tablist" aria-label="Editor panels" className="flex gap-1 border-b border-neutral-200 px-2 pt-1">
        {TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={tab.kind === table.kind}
            onClick={() => onShowPanel(tab.kind)}
            className={`rounded-t px-3 py-1 text-sm ${
              tab.kind === table.kind ? 'border border-b-white border-neutral-200 bg-white font-medium -mb-px' : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={table.title} className="min-h-0 flex-1">
        <EditableTable table={table} onEdit={onEdit} onSelect={onSelect} />
      </div>
    </section>
  )
}
