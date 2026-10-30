import type { Axis } from './formula'
import type { Id, Pattern } from './model'

/**
 * Pattern edits: the one way anything changes a Pattern (renderer now; panels, undo, MCP later).
 *
 * `applyEdit` never mutates its input and shares everything it doesn't touch. A no-op edit (unknown
 * id, same value as today) returns the same reference, so `next === pattern` means "nothing changed".
 * Bad formula text is a legal edit: evaluate() reports it as an issue, which is how the user fixes it.
 */
export type PatternEdit = { readonly kind: 'setPointFormula'; readonly pointId: Id; readonly axis: Axis; readonly formula: string }

export function applyEdit(pattern: Pattern, edit: PatternEdit): Pattern {
  switch (edit.kind) {
    case 'setPointFormula': {
      // Duplicate ids: edit the first, matching evaluate(), which resolves the first.
      const index = pattern.points.findIndex((point) => point.id === edit.pointId)
      const point = pattern.points[index]
      if (!point || point[edit.axis] === edit.formula) return pattern
      const points = pattern.points.with(index, { ...point, [edit.axis]: edit.formula })
      return { ...pattern, points }
    }
    default: {
      const _exhaustive: never = edit.kind
      return _exhaustive
    }
  }
}
