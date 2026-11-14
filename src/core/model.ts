import { z } from 'zod'

/**
 * Pattern data model. The zod schemas are the single source of truth: types are inferred from them,
 * and the same schemas validate files on load and (mirrored) documents in Convex.
 *
 * All lengths are stored in millimetres. `units` only controls display.
 */

export const CURRENT_SCHEMA_VERSION = 1

/** Not empty, no surrounding spaces, and not a name every object inherits (__proto__, constructor, toString...). */
export function isSizeName(name: string): boolean {
  return name !== '' && name === name.trim() && !(name in Object.prototype)
}

export const SizeNameSchema = z.string().refine(isSizeName, 'Not a valid size name')
export type SizeName = z.infer<typeof SizeNameSchema>

export const IdSchema = z.string().min(1)
export type Id = z.infer<typeof IdSchema>

/** A body measurement with one value (mm) per size, e.g. chest. */
export const MeasurementSchema = z.strictObject({
  name: z.string(),
  values: z.record(SizeNameSchema, z.number())
})
export type Measurement = z.infer<typeof MeasurementSchema>

/** A named formula, e.g. `ease = 10` or `body_width = chest / 4 + ease`. */
export const VariableSchema = z.strictObject({
  name: z.string(),
  formula: z.string()
})
export type Variable = z.infer<typeof VariableSchema>

/** A point whose coordinates are formulas. Formulas may reference other points as `A.x` / `A.y`. */
export const PointSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  x: z.string(),
  y: z.string()
})
export type Point = z.infer<typeof PointSchema>

export const LineSegmentSchema = z.strictObject({
  id: IdSchema,
  kind: z.literal('line'),
  from: IdSchema,
  to: IdSchema
})
export type LineSegment = z.infer<typeof LineSegmentSchema>

/** Cubic bezier. Control points are ordinary Points so they can be formula-driven relative to anchors. */
export const BezierSegmentSchema = z.strictObject({
  id: IdSchema,
  kind: z.literal('bezier'),
  from: IdSchema,
  c1: IdSchema,
  c2: IdSchema,
  to: IdSchema
})
export type BezierSegment = z.infer<typeof BezierSegmentSchema>

export const SegmentSchema = z.discriminatedUnion('kind', [LineSegmentSchema, BezierSegmentSchema])
export type Segment = z.infer<typeof SegmentSchema>

/** Every point a segment uses, in drawing order: from, [c1, c2,] to. */
export function segmentPointIds(segment: Segment): Id[] {
  switch (segment.kind) {
    case 'line':
      return [segment.from, segment.to]
    case 'bezier':
      return [segment.from, segment.c1, segment.c2, segment.to]
    default: {
      const _exhaustive: never = segment
      return _exhaustive
    }
  }
}

/** A segment used in a piece outline, optionally traversed backwards. */
export const SegmentRefSchema = z.strictObject({
  segmentId: IdSchema,
  reversed: z.boolean().optional()
})
export type SegmentRef = z.infer<typeof SegmentRefSchema>

/** A notch on a segment. `distance` is a formula (mm along the segment from its start). */
export const NotchDefSchema = z.strictObject({
  id: IdSchema,
  segmentId: IdSchema,
  distance: z.string()
})
export type NotchDef = z.infer<typeof NotchDefSchema>

/** Allowance widths are formulas (mm). `perEdge` overrides `default` for the segments it names. */
export const SeamAllowanceSchema = z.strictObject({
  default: z.string(),
  perEdge: z.record(IdSchema, z.string()).optional()
})
export type SeamAllowance = z.infer<typeof SeamAllowanceSchema>

export const PieceSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  outline: z.array(SegmentRefSchema),
  seamAllowance: SeamAllowanceSchema,
  notches: z.array(NotchDefSchema),
  grainline: z.tuple([IdSchema, IdSchema]),
  cutCount: z.number().int().positive(),
  /** The outline segment this piece is cut on the fold along. */
  fold: IdSchema.optional(),
  /** The point held fixed across sizes in the nested view. Absent means draft coordinates already nest. */
  stackPoint: IdSchema.optional()
})
export type Piece = z.infer<typeof PieceSchema>

/** Which of a piece's formulas is being visited. A `segmentId` of null is the default allowance. */
export type PieceFormulaOwner =
  | { readonly kind: 'notch'; readonly id: Id }
  | { readonly kind: 'seamAllowance'; readonly segmentId: Id | null }

/**
 * The one list of every formula a piece owns: evaluate and rename both go through it, so they can't
 * disagree. Replaces each formula with what `visit` returns, and returns the same piece if none changed.
 */
export function visitPieceFormulas(piece: Piece, visit: (owner: PieceFormulaOwner, formula: string) => string): Piece {
  const notches = piece.notches.map((notch) => {
    const distance = visit({ kind: 'notch', id: notch.id }, notch.distance)
    return distance === notch.distance ? notch : { ...notch, distance }
  })
  const { default: defaultWidth, perEdge } = piece.seamAllowance
  const nextDefault = visit({ kind: 'seamAllowance', segmentId: null }, defaultWidth)
  const edges = Object.entries(perEdge ?? {})
  const nextEdges = edges.map(([segmentId, formula]): [Id, string] => [segmentId, visit({ kind: 'seamAllowance', segmentId }, formula)])

  const notchesSame = notches.every((notch, i) => notch === piece.notches[i])
  const allowanceSame = nextDefault === defaultWidth && nextEdges.every(([, formula], i) => formula === edges[i]?.[1])
  if (notchesSame && allowanceSame) return piece
  return {
    ...piece,
    notches: notchesSame ? piece.notches : notches,
    seamAllowance: allowanceSame
      ? piece.seamAllowance
      : { default: nextDefault, ...(perEdge ? { perEdge: Object.fromEntries(nextEdges) } : {}) }
  }
}

export const DisplayUnitsSchema = z.enum(['cm', 'in'])
export type DisplayUnits = z.infer<typeof DisplayUnitsSchema>

export const PatternSchema = z.strictObject({
  /** Schema version, used by migrations. */
  version: z.literal(CURRENT_SCHEMA_VERSION),
  units: DisplayUnitsSchema,
  sizes: z
    .tuple([SizeNameSchema])
    .rest(SizeNameSchema)
    .refine((sizes) => new Set(sizes.map((size) => size.toLowerCase())).size === sizes.length, 'Two sizes have the same name'),
  measurements: z.array(MeasurementSchema),
  variables: z.array(VariableSchema),
  points: z.array(PointSchema),
  segments: z.array(SegmentSchema),
  pieces: z.array(PieceSchema)
})
export type Pattern = z.infer<typeof PatternSchema>

export type ParsePatternResult =
  | { ok: true; pattern: Pattern }
  | { ok: false; error: z.ZodError }

/** Validate untrusted JSON (a file or a cloud document) as a Pattern. */
export function parsePattern(input: unknown): ParsePatternResult {
  const result = PatternSchema.safeParse(input)
  return result.success ? { ok: true, pattern: result.data } : { ok: false, error: result.error }
}
