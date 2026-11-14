import type { z } from 'zod'
import { upgrade, type JsonObject } from './migrations'
import { CURRENT_SCHEMA_VERSION, parsePattern, type Measurement, type Pattern } from './model'

/**
 * The pattern file format: bytes in, a Pattern or a typed problem out, and back. Pure, so the renderer, tests and a future
 * MCP server read files the same way. Design: docs/design/m8-file-io.md, decisions 1 to 3.
 */

/** One schema problem, with `path` written the way a person finds it in the file: `pieces[2].cutCount`. */
export interface FileIssue {
  readonly path: string
  readonly message: string
}

export type PatternFileProblem =
  | { readonly kind: 'empty' }
  /** Not UTF-8: a PDF or image picked by mistake, or a file re-saved as UTF-16. */
  | { readonly kind: 'not-text' }
  /** `cutShort` when the text doesn't end in `}`. `detail` is the JSON engine's own sentence, so its wording can change. */
  | { readonly kind: 'not-json'; readonly cutShort: boolean; readonly detail: string }
  /** JSON, but not an object with a positive integer `version`. */
  | { readonly kind: 'not-a-pattern' }
  /** Made by a newer app. Never parsed, so never stripped. */
  | { readonly kind: 'newer-version'; readonly version: number }
  /** Our format at a version we read, but parsePattern refuses it. Every issue, in zod's order. */
  | { readonly kind: 'invalid'; readonly issues: readonly [FileIssue, ...FileIssue[]] }

export type ReadPatternResult =
  /** `upgradedFrom` is the file's version when it was older and was upgraded in memory. */
  | { readonly ok: true; readonly pattern: Pattern; readonly upgradedFrom: number | null }
  | { readonly ok: false; readonly problem: PatternFileProblem }

export type WritePatternResult =
  | { readonly ok: true; readonly data: Uint8Array }
  /** The pattern fails its own schema: a bug. Nothing is written that this module couldn't read back. */
  | { readonly ok: false; readonly issues: readonly [FileIssue, ...FileIssue[]] }

const refuse = (problem: PatternFileProblem): ReadPatternResult => ({ ok: false, problem })

const isJsonObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Pure and total: never throws, whatever the bytes. */
export function readPatternFile(data: Uint8Array): ReadPatternResult {
  let text: string
  try {
    // A UTF-8 byte order mark is dropped by the decoder.
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return refuse({ kind: 'not-text' })
  }
  if (text.trim() === '') return refuse({ kind: 'empty' })

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return refuse({ kind: 'not-json', cutShort: !text.trimEnd().endsWith('}'), detail: error instanceof Error ? error.message : String(error) })
  }

  if (!isJsonObject(json)) return refuse({ kind: 'not-a-pattern' })
  const version = json['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return refuse({ kind: 'not-a-pattern' })
  // Before any shape check, so a newer file of any layout is refused the same way and never parsed.
  if (version > CURRENT_SCHEMA_VERSION) return refuse({ kind: 'newer-version', version })

  const parsed = parsePattern(version < CURRENT_SCHEMA_VERSION ? upgrade(json, version) : json)
  if (!parsed.ok) return refuse({ kind: 'invalid', issues: fileIssues(parsed.error) })
  return { ok: true, pattern: parsed.pattern, upgradedFrom: version < CURRENT_SCHEMA_VERSION ? version : null }
}

/** Validates, then writes 2-space JSON in canonical order, LF line ends and one final newline. Deterministic. */
export function writePatternFile(pattern: Pattern): WritePatternResult {
  // Parsing gives keys in schema order, whatever order the pattern was built in.
  const parsed = parsePattern(pattern)
  if (!parsed.ok) return { ok: false, issues: fileIssues(parsed.error) }
  const canonical: Pattern = {
    ...parsed.pattern,
    measurements: parsed.pattern.measurements.map((measurement) => ({ ...measurement, values: inSizeOrder(measurement.values, parsed.pattern.sizes) }))
  }
  return { ok: true, data: new TextEncoder().encode(`${JSON.stringify(canonical, null, 2)}\n`) }
}

/** What File > New opens: one size, M, in cm, and nothing else. */
export function blankPattern(): Pattern {
  return { version: CURRENT_SCHEMA_VERSION, units: 'cm', sizes: ['M'], measurements: [], variables: [], points: [], segments: [], pieces: [] }
}

/** The sizes' values in `sizes` order, then any others in the order they had, so nothing is lost and the same pattern gives the same bytes. */
function inSizeOrder(values: Measurement['values'], sizes: readonly string[]): Measurement['values'] {
  const ordered = sizes.flatMap((size): [string, number][] => {
    const value = values[size]
    return value === undefined ? [] : [[size, value]]
  })
  const rest = Object.entries(values).filter(([size]) => !sizes.includes(size))
  return Object.fromEntries([...ordered, ...rest])
}

function fileIssues(error: z.ZodError): readonly [FileIssue, ...FileIssue[]] {
  const [first, ...rest] = error.issues.map((issue) => ({ path: pathText(issue.path), message: issue.message }))
  // zod always reports at least one issue for a failed parse.
  return [first ?? { path: '(top level)', message: error.message }, ...rest]
}

function pathText(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(top level)'
  return path.reduce<string>((text, key) => (typeof key === 'number' ? `${text}[${key}]` : text === '' ? String(key) : `${text}.${String(key)}`), '')
}
