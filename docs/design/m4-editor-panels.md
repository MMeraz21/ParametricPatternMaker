# Milestone 4: editor panels

## Problem

M4 adds a measurement table with sizes as columns, a variables list and a point list, and redraws the canvas on
every edit. Building them raises four questions:

- **Rename.** Measurements, variables and points share one name namespace and formulas refer to them by name, so
  renaming an item has to rewrite every formula that uses it without reformatting the user's text.
- **Delete.** Deleting something that other items use must not quietly corrupt the pattern.
- **Point ids.** New points need ids, but core is pure, so it can't generate random ones.
- **Selection.** Selection and issue navigation have to reach measurements and variables, not just points.

## Usage (caller's view)

```tsx
const table = useMemo(() => tableFor(panel, pattern, resolved, selection), [panel, pattern, resolved, selection])
<PanelDock table={table} onEdit={(edit) => dispatch({ type: 'edit', edit })} onSelect={...} onShowPanel={...} />
```

Every cell commits through the table model, so the component has no code specific to one kind of item:

```ts
text(table, 'chest', 'M').commit('1040') // { ok: true, edit: { kind: 'setMeasurement', name: 'chest', size: 'M', value: 1040 } }
text(table, 'neck', 'name').commit('chest') // { ok: false, message: "'chest' is already used by a measurement" }
```

Core edits, used by the panels, the inspector, and later by undo and MCP:

```ts
applyEdit(pattern, { kind: 'rename', item: { kind: 'measurement', name: 'neck' }, to: 'neck_circ' })
// neck_width's formula becomes 'neck_circ / 6 + 5'
applyEdit(pattern, { kind: 'add', item: newItem(pattern, 'point') }) // id p1, name P_1
```

## Shape

**Core (`edit.ts`, `formula.ts`).** There are five edit variants, each generic over the kind of item: `add`,
`remove`, `rename`, `setFormula` and `setMeasurement`. `ItemKey` identifies an item (a measurement or variable by
name, a point by id), and the renderer uses the same type for selection.

- `checkName` is the single name rule. The UI calls it to show a message and `applyEdit` calls it again, so the
  two can't disagree.
- `newItem` picks a unique name and a fresh `p<N>` id. The edit carries them, so replaying an edit gives the same
  result.
- `renameReferences` is a text scanner. It renames whole names, and leaves alone axes after a `.`, function calls,
  numbers, strings and comments. It then recompiles the formula, and the whole rename is refused if the references
  don't map exactly from the old name to the new one.
- `remove` doesn't cascade. Dependents become `undefined-reference` or `missing-point` issues, which the issues list
  already shows and navigates to.

`isReservedName` now also rejects words mathjs treats as operators or literals: `not` doesn't parse at all,
`NaN` and `true` become constants, and `a mod b` is an operator.

**Renderer.**

- `panels/tables.ts` turns `(pattern, resolved, selection)` into a `TableModel` of columns, rows and cells. Each
  text cell has a `commit(draft)` that returns either an edit or a rejection message, along with its label and its
  own issues.
- One `EditableTable` renders any model, and one `EditableCell` holds the editing behaviour: a draft while typing,
  committed on Enter or blur, Escape to revert, and a rejection keeps the draft with an alert.
- The reducer gained a `panel` tab and `showPanel`. Selecting an item switches to its tab. Adding an item selects
  it, renaming keeps it selected, and removing clears the selection.
- `selectionForIssue` now reaches measurements and variables.

Size columns come from `pattern.sizes`, so the size switcher in M6 needs no change to the table.

## Synthesis decision

There were two candidates:

- **Twelve specific edit variants** with a purpose-built component per panel, `checkEdit`, and a refactor of
  evaluate's name binding.
- **Five generic edit variants** with one declarative table (the base).

They agreed on a lot: a tabbed dock under the canvas, commit on Enter or blur, deletes allowed with issues and no
cascade, rename in core through a scanner that keeps the user's text, ids chosen before dispatch, sizes left to M6,
and values shown in mm.

The generic table won on interface depth. The same table description renders three panels and is unit-tested
through `commit`, so adding a fourth kind means adding a builder, not a component.

Taken from the specific-variants candidate:

- The rename safety check (recompile and compare references, and refuse the whole rename on a mismatch).
- Reserving mathjs keywords. I verified this bug before fixing it.

Rejected:

- The `bindNames` refactor of `evaluate`, because it carried blast radius for a duplicate-name edge case.
- `occurrence`-addressed duplicate names.
- A "used by N" usage index, deferred to the open questions.
- Spreadsheet arrow-key navigation, since Tab already moves between cells.
- Replacing the Inspector with a generic row-detail view.

## Tradeoffs accepted

- We accept that deleting a used item breaks its dependents (and the issues list says so), in exchange for no hidden
  cascades and no confirmation dialogs.
- We accept that point formulas can be edited in two places, the inspector and the Points table. Both commit the
  same `setFormula` edit, so they can't diverge.
- We accept selecting a canvas point switching the dock to Points, in exchange for one rule: selection shows its
  row.
- We accept that a missing measurement value is flagged only on the active size's cell, because `evaluate` reports
  it for that size only.

## Open questions and risks

These are recorded with their defaults in `docs/open-questions.md`:

- confirming before a delete that leaves issues;
- showing a "used by" count;
- adding and removing sizes, which is M6;
- reordering rows.
