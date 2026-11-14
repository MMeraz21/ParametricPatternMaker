import { CURRENT_SCHEMA_VERSION, type Pattern } from '../model'
import { raglanTee } from './raglan'

/**
 * Pattern files as bytes, for the milestone 8 reader. Each hazard is derived from the raglan, so it follows the
 * raglan as it grows. docs/design/m8-file-io.md, decision 16, says what `readPatternFile` must answer for each.
 *
 * The clean text is `JSON.stringify` with 2 spaces and a final newline. Once `writePatternFile` exists, it
 * replaces `fileText` here, and every hazard follows.
 */

const fileText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** Little-endian UTF-16 with a byte order mark, as an older Windows Notepad saves "Unicode". */
function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2)
  out[0] = 0xff
  out[1] = 0xfe
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    out[2 + i * 2] = unit & 0xff
    out[3 + i * 2] = unit >> 8
  }
  return out
}

/** Replaces exactly one occurrence, so a fixture can't silently turn back into the clean file. */
function replaceOnce(source: string, search: string, replacement: string): string {
  const at = source.indexOf(search)
  if (at < 0 || source.indexOf(search, at + search.length) >= 0) throw new Error(`Expected exactly one ${JSON.stringify(search)} in the raglan file`)
  return `${source.slice(0, at)}${replacement}${source.slice(at + search.length)}`
}

/** The raglan with one extra field on the sleeve: a field some future version might add. */
const withLiningOnSleeve = (pattern: Pattern): unknown => ({
  ...pattern,
  pieces: pattern.pieces.map((piece) => (piece.id === 'sleeve' ? { ...piece, lining: true } : piece))
})

export const raglanFileText = fileText(raglanTee)

export const PATTERN_FILE_HAZARDS = {
  /** The raglan, as saved. Opens equal to `raglanTee`. */
  clean: utf8(raglanFileText),
  /** Zero bytes. */
  empty: new Uint8Array(),
  /** Malformed JSON: cut off halfway, as a copy or a sync that stopped early leaves it. */
  truncated: utf8(raglanFileText.slice(0, Math.floor(raglanFileText.length / 2))),
  /** Malformed JSON in the middle of a whole file: a hand edit gone wrong. */
  doubleComma: utf8(replaceOnce(raglanFileText, '"units": "cm",', '"units": "cm",,')),
  /** Valid JSON that fails parsePattern: the sleeve's cutCount is the string "2". */
  wrongType: utf8(fileText({ ...raglanTee, pieces: raglanTee.pieces.map((piece) => (piece.id === 'sleeve' ? { ...piece, cutCount: '2' } : piece)) })),
  /** This version's format with a field it doesn't know. Today's parsePattern drops `lining` without a word. */
  unknownField: utf8(fileText(withLiningOnSleeve(raglanTee))),
  /** From a newer format version, which added `lining`. Today's parsePattern accepts it and drops `lining`. */
  newerVersion: utf8(fileText({ ...(withLiningOnSleeve(raglanTee) as object), version: CURRENT_SCHEMA_VERSION + 1 })),
  /** Some other program's JSON. */
  notAPattern: utf8(fileText({ name: 'my-app', version: '1.0.0' })),
  /** A PDF picked by mistake: `%PDF-1.7`, then bytes that aren't UTF-8. */
  notText: Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xe2, 0xe3, 0xcf, 0xd3),
  /** The raglan re-saved as UTF-16. Refused with words that say to save it as UTF-8. */
  utf16: utf16le(raglanFileText),
  /** The raglan with a UTF-8 byte order mark and Windows line ends. Opens equal to `raglanTee`. */
  bomCrlf: utf8(`﻿${raglanFileText.replaceAll('\n', '\r\n')}`)
} as const satisfies Readonly<Record<string, Uint8Array>>

export type PatternFileHazard = keyof typeof PATTERN_FILE_HAZARDS
