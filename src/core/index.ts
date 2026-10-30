export * from './model'
export * from './formula'
export * from './graph'
export * from './evaluate'
export * from './geometry'
// resolveGeometry is internal to evaluate(); only the resolved shapes and flattening are public.
export {
  flattenOutline,
  type FlatEdge,
  type FlatOutline,
  type Orientation,
  type OutlineEdge,
  type ResolvedNotch,
  type ResolvedPiece,
  type ResolvedSegment
} from './outline'
export * from './edit'
