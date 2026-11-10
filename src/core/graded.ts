import { evaluate, type EvaluationIssue, type LocatedIssue, type ResolvedPattern } from './evaluate'
import { sub, vec, type Vec2 } from './geometry'
import type { Id, Pattern, SizeName } from './model'
import type { ResolvedPiece } from './outline'

/**
 * Every size of a pattern at once, and one size on screen in the context of the others. All multi-size
 * policy is here, so the renderer, export and later checks read the same answers.
 * Design: docs/design/m6-size-switcher.md.
 */

export interface SizeResult {
  readonly size: SizeName
  readonly resolved: ResolvedPattern
}

/** How one problem spreads across sizes. */
export interface IssueSpread {
  /** Stable across sizes and renders: kind, item, the discriminating field and a per-size ordinal. */
  readonly key: string
  /** In pattern order. */
  readonly sizes: readonly [SizeName, ...SizeName[]]
  readonly inEverySize: boolean
  /** Each size's own report. Messages differ when they carry values. */
  readonly instances: readonly { readonly size: SizeName; readonly issue: LocatedIssue }[]
}

/** One problem, reported once. Reads as the first affected size's report. */
export type GradedIssue = LocatedIssue & IssueSpread

export type PieceAtSize =
  /** `stackAt` is null only when the piece declares no stack point. */
  | { readonly kind: 'placed'; readonly size: SizeName; readonly piece: ResolvedPiece; readonly stackAt: Vec2 | null }
  | { readonly kind: 'no-outline'; readonly size: SizeName }
  /** The outline resolved but the declared stack point did not, so there is nowhere to put it. */
  | { readonly kind: 'no-stack-point'; readonly size: SizeName }

export interface GradedPiece {
  readonly id: Id
  readonly name: string
  /** One entry per size, in pattern order. */
  readonly atSizes: readonly PieceAtSize[]
}

export interface GradedPattern {
  /** One per size in pattern order. */
  readonly bySize: readonly [SizeResult, ...SizeResult[]]
  /** First-seen order, walking sizes in pattern order. */
  readonly issues: readonly GradedIssue[]
  /** Author order. A duplicated piece id appears once, as evaluate resolves it. */
  readonly pieces: readonly GradedPiece[]
}

/** A graded issue that reads as the shown size's own report when it has one. */
export type ShownIssue = GradedIssue & {
  /** The shown size has this problem. */
  readonly here: boolean
  /** The size to show when the issue is opened: the shown size if `here`, else the first affected. */
  readonly openAt: SizeName
  /** 'XXL' or 'L, XL'. Null when every size has it. */
  readonly scope: string | null
  /** `message`, led by the sizes it is literally true for. */
  readonly text: string
}

export interface NestGhost {
  readonly size: SizeName
  /** Position in `sizes`, for a colour ramp. */
  readonly sizeIndex: number
  readonly piece: ResolvedPiece
  /** Add to this piece's geometry to stack it on the shown size. */
  readonly offset: Vec2
}

export interface NestGap {
  readonly size: SizeName
  readonly pieceId: Id
  readonly pieceName: string
  readonly reason: 'no-outline' | 'no-stack-point' | 'no-cut-line'
}

export interface Nest {
  /** Every other size's pieces. The shown size is drawn normally and is not a ghost. */
  readonly ghosts: readonly NestGhost[]
  /** What the nest cannot show, for every size including the shown one. */
  readonly gaps: readonly NestGap[]
}

/** One size on screen, in the context of all of them. */
export interface SizeView {
  readonly size: SizeName
  /** Every size in pattern order, with the number of distinct problems it has. */
  readonly sizes: readonly { readonly name: SizeName; readonly issueCount: number }[]
  readonly resolved: ResolvedPattern
  /** Problems the shown size has first, then the rest; first-seen order within each. */
  readonly issues: readonly ShownIssue[]
  readonly nest: Nest
}

/** What makes two reports the same problem. Leaves out `message`, `dependency` and values such as `distance`, which change per size. */
function issueIdentity(issue: LocatedIssue): string {
  const of = (...detail: readonly (string | number)[]): string => JSON.stringify([issue.kind, issue.item, ...detail])
  switch (issue.kind) {
    case 'invalid-name':
    case 'duplicate-name':
    case 'duplicate-id':
    case 'missing-measurement-value':
    case 'parse-error':
    case 'cycle':
    case 'dependency-failed':
    case 'not-finite':
    case 'outline-empty':
    case 'degenerate-outline':
    case 'notch-out-of-range':
    case 'notch-on-degenerate-segment':
    case 'negative-seam-allowance':
    case 'degenerate-grainline':
      return of()
    case 'undefined-reference':
    case 'invalid-reference':
      return of(issue.reference)
    case 'missing-point':
      return of(issue.pointId)
    case 'missing-segment':
    case 'duplicate-outline-segment':
    case 'notch-off-outline':
    case 'unknown-seam-allowance-edge':
    case 'fold-edge-has-allowance':
      return of(issue.segmentId)
    case 'outline-gap':
      return of(issue.after, issue.before)
    case 'invalid-fold-edge':
      return of(issue.segmentId, issue.reason)
    case 'cut-line-failed':
      return of(issue.failure.kind)
    default: {
      const _exhaustive: never = issue
      return _exhaustive
    }
  }
}

const isLocated = (issue: EvaluationIssue): issue is LocatedIssue => issue.kind !== 'unknown-size'

function groupIssues(bySize: readonly SizeResult[]): GradedIssue[] {
  const instancesByKey = new Map<string, { size: SizeName; issue: LocatedIssue }[]>()
  for (const { size, resolved } of bySize) {
    const seen = new Map<string, number>()
    for (const issue of resolved.issues.filter(isLocated)) {
      const identity = issueIdentity(issue)
      const ordinal = seen.get(identity) ?? 0
      seen.set(identity, ordinal + 1)
      const key = `${identity}#${ordinal}`
      const instances = instancesByKey.get(key)
      if (instances) instances.push({ size, issue })
      else instancesByKey.set(key, [{ size, issue }])
    }
  }
  return [...instancesByKey].flatMap(([key, instances]): GradedIssue[] => {
    const [first, ...rest] = instances
    if (!first) return []
    return [{ ...first.issue, key, sizes: [first.size, ...rest.map(({ size }) => size)], inEverySize: instances.length === bySize.length, instances }]
  })
}

function gradePieces(pattern: Pattern, bySize: readonly SizeResult[]): GradedPiece[] {
  const seen = new Set<Id>()
  const pieces: GradedPiece[] = []
  for (const { id, name, stackPoint } of pattern.pieces) {
    if (seen.has(id)) continue
    seen.add(id)
    const atSizes = bySize.map(({ size, resolved }): PieceAtSize => {
      const piece = Object.hasOwn(resolved.pieces, id) ? resolved.pieces[id] : undefined
      if (!piece) return { kind: 'no-outline', size }
      if (stackPoint === undefined) return { kind: 'placed', size, piece, stackAt: null }
      return piece.stackPoint ? { kind: 'placed', size, piece, stackAt: piece.stackPoint } : { kind: 'no-stack-point', size }
    })
    pieces.push({ id, name, atSizes })
  }
  return pieces
}

/** Evaluate every size. Pure, and never throws on bad pattern content. For each size, the issues in `issues` for that size are exactly what `evaluate` reports. */
export function evaluateGraded(pattern: Pattern): GradedPattern {
  const resultFor = (size: SizeName): SizeResult => ({ size, resolved: evaluate(pattern, size) })
  const [first, ...rest] = pattern.sizes
  const bySize: [SizeResult, ...SizeResult[]] = [resultFor(first), ...rest.map(resultFor)]
  return { bySize, issues: groupIssues(bySize), pieces: gradePieces(pattern, bySize) }
}

function showIssue(issue: GradedIssue, size: SizeName): ShownIssue {
  const own = issue.instances.find((instance) => instance.size === size)
  const report = own?.issue ?? issue
  const sameWording = issue.instances.filter((instance) => instance.issue.message === report.message).map((instance) => instance.size)
  const otherWording = issue.instances.filter((instance) => instance.issue.message !== report.message).map((instance) => instance.size)
  const text =
    issue.inEverySize && otherWording.length === 0
      ? report.message
      : `${sameWording.join(', ')}: ${report.message}${otherWording.length > 0 ? ` (also in ${otherWording.join(', ')})` : ''}`
  const spread: IssueSpread = { key: issue.key, sizes: issue.sizes, inEverySize: issue.inEverySize, instances: issue.instances }
  return { ...report, ...spread, here: own !== undefined, openAt: own ? size : issue.sizes[0], scope: issue.inEverySize ? null : issue.sizes.join(', '), text }
}

function nestAt(pieces: readonly GradedPiece[], shown: SizeName, sizeOrder: readonly SizeName[]): Nest {
  const ghosts: NestGhost[] = []
  const gaps: NestGap[] = []
  for (const { id, name, atSizes } of pieces) {
    const isPlaced = (at: PieceAtSize): at is Extract<PieceAtSize, { kind: 'placed' }> => at.kind === 'placed'
    const reference = atSizes.find((at) => isPlaced(at) && at.size === shown) ?? atSizes.find(isPlaced)
    const anchor = reference && isPlaced(reference) ? reference.stackAt : null
    for (const at of atSizes) {
      const gap = (reason: NestGap['reason']): void => void gaps.push({ size: at.size, pieceId: id, pieceName: name, reason })
      if (at.kind !== 'placed') {
        gap(at.kind)
        continue
      }
      if (!at.piece.cutLine) gap('no-cut-line')
      if (at.size === shown) continue
      ghosts.push({ size: at.size, sizeIndex: sizeOrder.indexOf(at.size), piece: at.piece, offset: anchor && at.stackAt ? sub(anchor, at.stackAt) : vec(0, 0) })
    }
  }
  return { ghosts, gaps }
}

/** The size to show: `wanted` if it exists, else the first size. Total, so a stale size (a removed size, a future undo, an opened file) can never reach the UI as an unknown size. */
export function viewAt(graded: GradedPattern, wanted: SizeName): SizeView {
  const { size, resolved } = graded.bySize.find((result) => result.size === wanted) ?? graded.bySize[0]
  const shown = graded.issues.map((issue) => showIssue(issue, size))
  return {
    size,
    sizes: graded.bySize.map((result) => ({ name: result.size, issueCount: result.resolved.issues.length })),
    resolved,
    issues: [...shown.filter((issue) => issue.here), ...shown.filter((issue) => !issue.here)],
    nest: nestAt(
      graded.pieces,
      size,
      graded.bySize.map((result) => result.size)
    )
  }
}
