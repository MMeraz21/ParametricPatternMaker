/**
 * Steps that bring an older pattern file up to the current format, on raw JSON, before parsePattern. Internal to the file
 * format: readPatternFile is the only caller. Design: docs/design/m8-file-io.md, decision 2.
 */

export type JsonObject = { readonly [key: string]: unknown }

/** MIGRATIONS[i] turns a version i+1 file into version i+2, and sets its version. Empty while the format is at version 1. */
export const MIGRATIONS: readonly ((file: JsonObject) => JsonObject)[] = []

/** Runs every step from `from` up to the newest. The result still goes through parsePattern. */
export function upgrade(file: JsonObject, from: number, migrations: readonly ((file: JsonObject) => JsonObject)[] = MIGRATIONS): JsonObject {
  return migrations.slice(from - 1).reduce((current, step) => step(current), file)
}
