import { z } from 'zod'

/**
 * Pattern data model. The zod schemas are the single source of truth: types are inferred from them,
 * and the same schemas validate files on load and (mirrored) documents in Convex.
 *
 * All lengths are stored in millimetres. `units` only controls display.
 */

export const CURRENT_SCHEMA_VERSION = 1

export const SizeNameSchema = z.string().min(1)
export type SizeName = z.infer<typeof SizeNameSchema>

export const IdSchema = z.string().min(1)
export type Id = z.infer<typeof IdSchema>

/** A body measurement with one value (mm) per size, e.g. chest. */
export const MeasurementSchema = z.object({
  name: z.string(),
  values: z.record(SizeNameSchema, z.number())
})
export type Measurement = z.infer<typeof MeasurementSchema>

/** A named formula, e.g. `ease = 10` or `body_width = chest / 4 + ease`. */
export const VariableSchema = z.object({
  name: z.string(),
  formula: z.string()
})
export type Variable = z.infer<typeof VariableSchema>

/** A point whose coordinates are formulas. Formulas may reference other points as `A.x` / `A.y`. */
export const PointSchema = z.object({
  id: IdSchema,
  name: z.string(),
  x: z.string(),
  y: z.string()
})
export type Point = z.infer<typeof PointSchema>

export const LineSegmentSchema = z.object({
  id: IdSchema,
  kind: z.literal('line'),
  from: IdSchema,
  to: IdSchema
})
export type LineSegment = z.infer<typeof LineSegmentSchema>

/** Cubic bezier. Control points are ordinary Points so they can be formula-driven relative to anchors. */
export const BezierSegmentSchema = z.object({
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
export const SegmentRefSchema = z.object({
  segmentId: IdSchema,
  reversed: z.boolean().optional()
})
export type SegmentRef = z.infer<typeof SegmentRefSchema>

/** A notch on a segment. `distance` is a formula (mm along the segment from its start). */
export const NotchDefSchema = z.object({
  id: IdSchema,
  segmentId: IdSchema,
  distance: z.string()
})
export type NotchDef = z.infer<typeof NotchDefSchema>

export const SeamAllowanceSchema = z.object({
  default: z.number().nonnegative(),
  perEdge: z.record(IdSchema, z.number().nonnegative()).optional()
})
export type SeamAllowance = z.infer<typeof SeamAllowanceSchema>

export const PieceSchema = z.object({
  id: IdSchema,
  name: z.string(),
  outline: z.array(SegmentRefSchema),
  seamAllowance: SeamAllowanceSchema,
  notches: z.array(NotchDefSchema),
  grainline: z.tuple([IdSchema, IdSchema]),
  cutCount: z.number().int().positive(),
  mirror: z.boolean().optional()
})
export type Piece = z.infer<typeof PieceSchema>

export const DisplayUnitsSchema = z.enum(['cm', 'in'])
export type DisplayUnits = z.infer<typeof DisplayUnitsSchema>

export const PatternSchema = z.object({
  /** Schema version, used by migrations. */
  version: z.number().int().positive(),
  units: DisplayUnitsSchema,
  sizes: z.array(SizeNameSchema).min(1),
  activeSize: SizeNameSchema,
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
