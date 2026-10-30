import type { DisplayUnits } from './model'

/**
 * Display units. Lengths are stored and computed in mm; `pattern.units` only changes how they are
 * shown and how typed measurement values are read. Numbers inside formulas stay mm, and formulas can
 * name a unit explicitly with the `mm`, `cm` and `inch` constants (`10cm`, `4inch`).
 */
export const MM_PER_UNIT: Readonly<Record<DisplayUnits, number>> = { cm: 10, in: 25.4 }

export const UNIT_LABEL: Readonly<Record<DisplayUnits, string>> = { cm: 'cm', in: 'in' }

/** Decimal places shown: millimetre precision in cm, hundredths in inches. */
const DECIMALS: Readonly<Record<DisplayUnits, number>> = { cm: 1, in: 2 }

/** A length in mm as a plain number in `units`, rounded for display, e.g. 275 mm -> "27.5" (cm). */
export function formatLength(mm: number, units: DisplayUnits): string {
  const scale = 10 ** DECIMALS[units]
  const rounded = Math.round((mm / MM_PER_UNIT[units]) * scale) / scale
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/** A value typed in `units`, converted to mm. */
export function toMm(value: number, units: DisplayUnits): number {
  return value * MM_PER_UNIT[units]
}
