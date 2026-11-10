export * from './model'
export * from './formula'
export * from './graph'
// evaluate() itself stays internal: the app reads every size through evaluateGraded and viewAt.
export type { EvaluationIssue, ItemRef, LocatedIssue, PiecePointRole, ResolvedPattern, ResolvedPoint } from './evaluate'
export * from './graded'
// Named, not `export *`: the offset functions belong to the cut line code and stay out of the public API.
export {
  DEGENERATE_LENGTH,
  LENGTH_TOLERANCE,
  MIN_FLATTEN_TOLERANCE,
  add,
  cross,
  curveLength,
  curvePoints,
  derivativeAt,
  distance,
  dot,
  flatten,
  norm,
  pathData,
  pointAt,
  polygonPathData,
  reverseCurve,
  sampleAtLength,
  sampleAtParameter,
  scale,
  signedArea,
  sub,
  vec,
  type CubicCurve,
  type Curve,
  type CurveSample,
  type LineCurve,
  type SampleResult,
  type Vec2
} from './geometry'
// resolveGeometry is internal to evaluate(); only the resolved shapes and flattening are public.
export {
  flattenOutline,
  type FlatEdge,
  type FlatOutline,
  type Orientation,
  type OutlineEdge,
  type ResolvedFold,
  type ResolvedGrainline,
  type ResolvedNotch,
  type ResolvedPiece,
  type ResolvedSegment
} from './outline'
export type { CutLine, CutLineFailure, CutNotch, CutSpan } from './cutLine'
export * from './edit'
export * from './units'
