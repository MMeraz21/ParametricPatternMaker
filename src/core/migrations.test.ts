import { describe, expect, it } from 'vitest'
import { MIGRATIONS, upgrade } from './migrations'
import { CURRENT_SCHEMA_VERSION } from './model'

describe('migrations', () => {
  it('has exactly one step per version before the current one, so a version bump needs its migration', () => {
    expect(MIGRATIONS.length).toBe(CURRENT_SCHEMA_VERSION - 1)
  })

  it('runs the steps from `from` up, in order', () => {
    const steps = [
      (file: Record<string, unknown>) => ({ ...file, version: 2, log: [...(file['log'] as string[]), 'a'] }),
      (file: Record<string, unknown>) => ({ ...file, version: 3, log: [...(file['log'] as string[]), 'b'] }),
      (file: Record<string, unknown>) => ({ ...file, version: 4, log: [...(file['log'] as string[]), 'c'] })
    ]
    expect(upgrade({ version: 1, log: [] }, 1, steps)).toEqual({ version: 4, log: ['a', 'b', 'c'] })
    expect(upgrade({ version: 3, log: [] }, 3, steps)).toEqual({ version: 4, log: ['c'] })
    expect(upgrade({ version: 4, log: [] }, 4, steps)).toEqual({ version: 4, log: [] })
  })
})
