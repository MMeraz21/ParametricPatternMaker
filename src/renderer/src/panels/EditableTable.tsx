import { useState } from 'react'
import type { ItemKey, PatternEdit } from '@core'
import type { TableModel, TextCell } from './tables'

interface EditableTableProps {
  table: TableModel
  onEdit: (edit: PatternEdit) => void
  onSelect: (key: ItemKey) => void
}

/** Renders any TableModel. Knows nothing about what its rows are. */
export function EditableTable({ table, onEdit, onSelect }: EditableTableProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table aria-label={table.title} className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
            <tr>
              {table.columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={`px-2 py-1 font-medium ${column.numeric ? 'text-right' : 'text-left'} ${column.emphasis ? 'text-sky-700' : ''}`}
                >
                  {column.header}
                </th>
              ))}
              <th scope="col" className="w-8">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr
                key={row.id}
                aria-selected={row.selected}
                onFocus={() => onSelect(row.key)}
                onClick={() => onSelect(row.key)}
                className={`border-t border-neutral-100 ${row.selected ? 'bg-amber-50' : ''}`}
              >
                {row.cells.map((cell) => {
                  const column = table.columns.find((c) => c.id === cell.columnId)
                  return (
                    <td key={cell.columnId} className={`px-1 py-0.5 align-top ${column?.emphasis ? 'bg-sky-50/50' : ''}`}>
                      {cell.kind === 'text' ? (
                        <EditableCell cell={cell} numeric={column?.numeric ?? false} onEdit={onEdit} />
                      ) : (
                        <output aria-label={cell.label} className="block px-1 py-0.5 text-right tabular-nums text-neutral-600">
                          {cell.text ?? '—'}
                        </output>
                      )}
                    </td>
                  )
                })}
                <td className="px-1 py-0.5 text-center align-top">
                  <button
                    type="button"
                    aria-label={`Delete ${row.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(row.remove)
                    }}
                    className="rounded px-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-neutral-200 p-1">
        <button type="button" onClick={() => onEdit(table.add.edit)} className="rounded px-2 py-0.5 text-sm text-sky-700 hover:bg-sky-50">
          + {table.add.label}
        </button>
      </div>
    </div>
  )
}

const MIN_INPUT_CHARS = 4
/** Room for the input's own padding and border. */
const INPUT_PADDING_CHARS = 2

interface EditableCellProps {
  cell: TextCell
  numeric: boolean
  onEdit: (edit: PatternEdit) => void
}

/**
 * One editing behaviour for every cell: a draft while typing, committed on Enter or blur, reverted with
 * Escape. A rejected commit keeps the draft and shows why. `draft === null` means "show the pattern's text".
 */
function EditableCell({ cell, numeric, onEdit }: EditableCellProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const commit = (): void => {
    if (draft === null) return
    const result = cell.commit(draft)
    if (!result.ok) {
      setError(result.message)
      return
    }
    if (result.edit) onEdit(result.edit)
    setDraft(null)
    setError(null)
  }

  const problems = [...(error ? [error] : []), ...cell.issues.map((issue) => issue.message)]
  return (
    <div>
      <input
        aria-label={cell.label}
        aria-invalid={problems.length > 0}
        title={problems.join('\n') || undefined}
        spellCheck={false}
        // Never narrower than its text: a long name is readable, and a tight table scrolls sideways instead.
        style={{ minWidth: `${Math.max(cell.text.length, MIN_INPUT_CHARS) + INPUT_PADDING_CHARS}ch` }}
        value={draft ?? cell.text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(null)
            setError(null)
          }
        }}
        className={`w-full rounded border bg-transparent px-1 py-0.5 font-mono outline-none focus:bg-white focus:ring-2 ${
          numeric ? 'text-right tabular-nums' : ''
        } ${problems.length > 0 ? 'border-red-400 focus:ring-red-200' : 'border-transparent hover:border-neutral-200 focus:ring-sky-200'}`}
      />
      {error && (
        <p role="alert" className="px-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
