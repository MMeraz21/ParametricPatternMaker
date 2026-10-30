import { useState } from 'react'
import type { Axis, PatternEdit } from '@core'
import type { AxisInspection, PointInspection } from './inspect'

interface InspectorProps {
  inspection: PointInspection | null
  onEdit: (edit: PatternEdit) => void
}

export function Inspector({ inspection, onEdit }: InspectorProps) {
  if (!inspection) {
    return (
      <section aria-label="Point inspector" className="p-4 text-sm text-neutral-500">
        Select a point on the canvas to see its formulas.
      </section>
    )
  }
  return (
    <section aria-label="Point inspector" className="space-y-4 p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{inspection.name}</h2>
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
          {inspection.role === 'anchor' ? 'Point' : 'Control point'}
        </span>
      </header>
      {!inspection.placed && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          This point can't be drawn until its formulas resolve.
        </p>
      )}
      {inspection.pointIssues.map((issue, i) => (
        <p key={i} className="text-sm text-red-700">
          {issue.message}
        </p>
      ))}
      {(['x', 'y'] as const).map((axis) => (
        <AxisField
          key={`${inspection.id}:${axis}:${inspection.axes[axis].formula}`}
          name={inspection.name}
          axis={axis}
          inspection={inspection.axes[axis]}
          onCommit={(formula) => onEdit({ kind: 'setFormula', owner: { kind: 'point', id: inspection.id, axis }, formula })}
        />
      ))}
    </section>
  )
}

interface AxisFieldProps {
  name: string
  axis: Axis
  inspection: AxisInspection
  onCommit: (formula: string) => void
}

/**
 * A formula field with a local draft, committed on Enter or blur and reverted with Escape. The parent
 * keys it on the committed formula, so an outside change (undo, another panel) resets the draft.
 */
function AxisField({ name, axis, inspection, onCommit }: AxisFieldProps) {
  const [draft, setDraft] = useState(inspection.formula)
  const id = `formula-${axis}`
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="font-mono text-sm font-medium">
          {name}.{axis}
        </label>
        <output aria-label={`${name}.${axis} value`} className="text-sm tabular-nums text-neutral-600">
          {inspection.value === null ? '—' : `${formatMm(inspection.value)} mm`}
        </output>
      </div>
      <input
        id={id}
        aria-label={`${name} ${axis} formula`}
        aria-invalid={inspection.issues.length > 0}
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDraft(inspection.formula)
        }}
        className={`w-full rounded border px-2 py-1 font-mono text-sm outline-none focus:ring-2 ${
          inspection.issues.length > 0 ? 'border-red-400 focus:ring-red-200' : 'border-neutral-300 focus:ring-sky-200'
        }`}
      />
      {inspection.issues.map((issue, i) => (
        <p key={i} className="text-xs text-red-700">
          {issue.message}
        </p>
      ))}
    </div>
  )
}

const formatMm = (value: number): string => String(Math.round(value * 10) / 10)
