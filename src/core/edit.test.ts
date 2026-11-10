import { describe, expect, it } from 'vitest'
import { applyEdit, checkName, keyOf, newItem, sameItem, type PatternEdit, type PiecePatch } from './edit'
import { evaluate } from './evaluate'
import { raglanTee } from './fixtures/raglan'
import type { Pattern, Piece } from './model'

const hpsX = (formula: string) => ({ kind: 'setFormula', owner: { kind: 'point', id: 'hps', axis: 'x' }, formula }) as const

describe('setFormula', () => {
  it('replaces one point formula and shares everything else', () => {
    const next = applyEdit(raglanTee, hpsX('neck_width + 10'))
    expect(next.points[0]).toEqual({ id: 'hps', name: 'HPS', x: 'neck_width + 10', y: '0' })
    expect(next.points[1]).toBe(raglanTee.points[1])
    expect(next.segments).toBe(raglanTee.segments)
    expect(raglanTee.points[0]?.x).toBe('neck_width')
  })

  it('moves dependent points when re-evaluated', () => {
    const before = evaluate(raglanTee, 'M').points
    const after = evaluate(applyEdit(raglanTee, hpsX('neck_width + 10')), 'M').points
    expect(after['hps']?.x).toBe((before['hps']?.x ?? 0) + 10)
    expect(after['neckC1']?.x).toBeCloseTo((before['neckC1']?.x ?? 0) + 9, 9)
  })

  it('sets variable formulas', () => {
    const next = applyEdit(raglanTee, { kind: 'setFormula', owner: { kind: 'variable', name: 'chest_ease' }, formula: '120' })
    expect(evaluate(next, 'M').variables['body_width']).toBe(280)
  })

  it('returns the same reference for no-ops', () => {
    expect(applyEdit(raglanTee, { kind: 'setFormula', owner: { kind: 'point', id: 'ghost', axis: 'x' }, formula: '1' })).toBe(raglanTee)
    expect(applyEdit(raglanTee, hpsX('neck_width'))).toBe(raglanTee)
  })

  it('accepts broken formulas, which evaluate reports as issues', () => {
    expect(evaluate(applyEdit(raglanTee, hpsX('1 +')), 'M').issues[0]).toMatchObject({
      kind: 'parse-error',
      item: { kind: 'pointCoord', id: 'hps', axis: 'x' }
    })
  })
})

describe('setMeasurement', () => {
  it('sets one size and redraws', () => {
    const next = applyEdit(raglanTee, { kind: 'setMeasurement', name: 'chest', size: 'M', value: 1040 })
    expect(next.measurements[0]?.values).toEqual({ S: 920, M: 1040, L: 1080, XL: 1160, XXL: 1260 })
    expect(evaluate(next, 'M').points['underarm']?.x).toBe(285)
  })

  it('refuses unknown sizes, non-finite values and unknown names', () => {
    expect(applyEdit(raglanTee, { kind: 'setMeasurement', name: 'chest', size: 'Q', value: 1 })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'setMeasurement', name: 'chest', size: 'M', value: Number.NaN })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'setMeasurement', name: 'ghost', size: 'M', value: 1 })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'setMeasurement', name: 'chest', size: 'M', value: 1000 })).toBe(raglanTee)
  })
})

describe('rename', () => {
  it('renames a measurement and every formula that uses it, keeping the text', () => {
    const next = applyEdit(raglanTee, { kind: 'rename', item: { kind: 'measurement', name: 'neck' }, to: 'neck_circ' })
    expect(next.measurements.map((m) => m.name)).toContain('neck_circ')
    expect(next.variables.find((v) => v.name === 'neck_width')?.formula).toBe('neck_circ / 6 + 5')
    expect(evaluate(next, 'M').issues).toEqual([])
    expect(next.points).toBe(raglanTee.points)
  })

  it('renames a point and its Name.x references, keeping its id', () => {
    const next = applyEdit(raglanTee, { kind: 'rename', item: { kind: 'point', id: 'hps' }, to: 'Shoulder' })
    expect(next.points[0]).toEqual({ id: 'hps', name: 'Shoulder', x: 'neck_width', y: '0' })
    expect(next.points.find((p) => p.id === 'raglanC1')?.x).toBe('Shoulder.x + (Underarm.x - Shoulder.x) * 0.55')
    expect(evaluate(next, 'M').issues).toEqual([])
  })

  it('rewrites notch distances', () => {
    const withNotch: Pattern = {
      ...raglanTee,
      pieces: raglanTee.pieces.map((p) => ({ ...p, notches: [{ id: 'n', segmentId: 'frontRaglan', distance: 'chest_ease' }] }))
    }
    const next = applyEdit(withNotch, { kind: 'rename', item: { kind: 'variable', name: 'chest_ease' }, to: 'ease' })
    expect(next.pieces[0]?.notches[0]?.distance).toBe('ease')
  })

  it('rewrites seam allowance formulas, keeping the text', () => {
    const withAllowances: Pattern = {
      ...raglanTee,
      pieces: raglanTee.pieces.map((p) =>
        p.outline.some(({ segmentId }) => segmentId === 'frontHem')
          ? { ...p, seamAllowance: { default: 'chest_ease / 10', perEdge: { frontHem: ' chest_ease/4 ' } } }
          : p
      )
    }
    const next = applyEdit(withAllowances, { kind: 'rename', item: { kind: 'variable', name: 'chest_ease' }, to: 'ease' })
    expect(next.pieces[0]?.seamAllowance).toEqual({ default: 'ease / 10', perEdge: { frontHem: ' ease/4 ' } })
    expect(evaluate(next, 'M').issues).toEqual([])
  })

  it('shares the pieces when no piece formula uses the name', () => {
    const next = applyEdit(raglanTee, { kind: 'rename', item: { kind: 'measurement', name: 'neck' }, to: 'neck_circ' })
    expect(next.pieces).toBe(raglanTee.pieces)
  })

  it('refuses invalid or taken names', () => {
    const neck = { kind: 'measurement', name: 'neck' } as const
    expect(applyEdit(raglanTee, { kind: 'rename', item: neck, to: 'chest' })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'rename', item: neck, to: '2neck' })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'rename', item: neck, to: 'HPS' })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'rename', item: neck, to: 'neck' })).toBe(raglanTee)
  })
})

describe('segments and pieces', () => {
  const segment = { id: 'extra', kind: 'line', from: 'hps', to: 'cfHem' } as const
  const front = raglanTee.pieces[0]
  if (!front) throw new Error('raglan has a front')
  const piece = { ...front, id: 'extraPiece', name: 'Extra' }

  describe('add and remove', () => {
    it('adds a segment and a piece', () => {
      const next = applyEdit(applyEdit(raglanTee, { kind: 'add', item: { kind: 'segment', segment } }), { kind: 'add', item: { kind: 'piece', piece } })
      expect(next.segments.at(-1)).toEqual(segment)
      expect(next.pieces.at(-1)).toEqual(piece)
      expect(keyOf({ kind: 'segment', segment })).toEqual({ kind: 'segment', id: 'extra' })
      expect(keyOf({ kind: 'piece', piece })).toEqual({ kind: 'piece', id: 'extraPiece' })
    })

    it('refuses an id already in use', () => {
      expect(applyEdit(raglanTee, { kind: 'add', item: { kind: 'segment', segment: { ...segment, id: 'frontCf' } } })).toBe(raglanTee)
      expect(applyEdit(raglanTee, { kind: 'add', item: { kind: 'piece', piece: { ...piece, id: 'front' } } })).toBe(raglanTee)
    })

    it('removes without cascading, leaving issues for what used it', () => {
      const next = applyEdit(raglanTee, { kind: 'remove', item: { kind: 'segment', id: 'frontCf' } })
      expect(next.segments.map((s) => s.id)).not.toContain('frontCf')
      expect(next.pieces).toBe(raglanTee.pieces)
      expect(evaluate(next, 'M').issues[0]).toMatchObject({ kind: 'missing-segment', segmentId: 'frontCf' })
      expect(applyEdit(raglanTee, { kind: 'remove', item: { kind: 'piece', id: 'front' } }).pieces.map((p) => p.id)).toEqual(['back', 'sleeve', 'neckband'])
    })

    it('returns the same pattern when removing an unknown id', () => {
      expect(applyEdit(raglanTee, { kind: 'remove', item: { kind: 'segment', id: 'ghost' } })).toBe(raglanTee)
      expect(applyEdit(raglanTee, { kind: 'remove', item: { kind: 'piece', id: 'ghost' } })).toBe(raglanTee)
    })

    it('makes new items with fresh ids that resolve to something usable', () => {
      const newSegment = newItem(raglanTee, 'segment')
      expect(newSegment).toEqual({ kind: 'segment', segment: { id: 's1', kind: 'line', from: 'hps', to: 'cfNeck' } })
      expect(newItem(applyEdit(raglanTee, { kind: 'add', item: newSegment }), 'segment')).toMatchObject({ segment: { id: 's2' } })
      expect(newItem(raglanTee, 'piece')).toEqual({
        kind: 'piece',
        piece: { id: 'piece1', name: 'Piece 1', outline: [], seamAllowance: { default: '10' }, notches: [], grainline: ['hps', 'cfNeck'], cutCount: 1 }
      })
    })
  })

  it('tells items of different kinds apart', () => {
    expect(sameItem({ kind: 'segment', id: 'a' }, { kind: 'segment', id: 'a' })).toBe(true)
    expect(sameItem({ kind: 'segment', id: 'a' }, { kind: 'piece', id: 'a' })).toBe(false)
    expect(sameItem({ kind: 'segment', id: 'a' }, { kind: 'segment', id: 'b' })).toBe(false)
    expect(sameItem({ kind: 'point', id: 'a' }, { kind: 'variable', name: 'a' })).toBe(false)
    expect(sameItem({ kind: 'variable', name: 'a' }, { kind: 'variable', name: 'a' })).toBe(true)
  })

  it('renames only named items', () => {
    // @ts-expect-error segments have ids, not names. Typecheck is what proves this one.
    const edit: PatternEdit = { kind: 'rename', item: { kind: 'segment', id: 'frontCf' }, to: 'x' }
    expect(edit.kind).toBe('rename')
  })

  describe('setSegment', () => {
    it('replaces a segment by id and shares everything else', () => {
      const changed = { id: 'frontCf', kind: 'line', from: 'cfNeck', to: 'sideHem' } as const
      const next = applyEdit(raglanTee, { kind: 'setSegment', segment: changed })
      expect(next.segments.find((s) => s.id === 'frontCf')).toEqual(changed)
      expect(next.points).toBe(raglanTee.points)
      expect(next.pieces).toBe(raglanTee.pieces)
    })

    it('can change a segment kind', () => {
      const curved = { id: 'frontCf', kind: 'bezier', from: 'cfNeck', c1: 'cfNeck', c2: 'cfHem', to: 'cfHem' } as const
      expect(applyEdit(raglanTee, { kind: 'setSegment', segment: curved }).segments.find((s) => s.id === 'frontCf')).toEqual(curved)
    })

    it('refuses an unknown id and returns the same pattern for no change', () => {
      expect(applyEdit(raglanTee, { kind: 'setSegment', segment: { ...segment, id: 'ghost' } })).toBe(raglanTee)
      const [first] = raglanTee.segments
      if (!first) throw new Error('raglan has segments')
      expect(applyEdit(raglanTee, { kind: 'setSegment', segment: { ...first } })).toBe(raglanTee)
    })
  })

  describe('setPiece', () => {
    const setFront = (patch: PiecePatch): Pattern => applyEdit(raglanTee, { kind: 'setPiece', pieceId: 'front', patch })
    const nextFront = (patch: PiecePatch): Piece | undefined => setFront(patch).pieces[0]

    it('changes only the patched fields and shares the other pieces', () => {
      const next = setFront({ name: 'Bodice', cutCount: 2 })
      expect(next.pieces[0]).toEqual({ ...front, name: 'Bodice', cutCount: 2 })
      expect(next.pieces[1]).toBe(raglanTee.pieces[1])
    })

    it('replaces the seam allowance as a whole', () => {
      expect(nextFront({ seamAllowance: { default: 'seam' } })?.seamAllowance).toEqual({ default: 'seam' })
    })

    it('returns the same pattern when every patched field is unchanged', () => {
      expect(setFront({ name: front.name, seamAllowance: { ...front.seamAllowance }, outline: [...front.outline] })).toBe(raglanTee)
      expect(setFront({ fold: 'frontCf' })).toBe(raglanTee)
    })

    it('refuses an unknown piece', () => {
      expect(applyEdit(raglanTee, { kind: 'setPiece', pieceId: 'ghost', patch: { name: 'x' } })).toBe(raglanTee)
    })

    it.each([0, -1, 1.5, Number.NaN])('refuses a cut count of %d', (cutCount) => {
      expect(setFront({ cutCount })).toBe(raglanTee)
    })

    it('clears the fold with null', () => {
      const cleared = nextFront({ fold: null })
      expect(cleared).toBeDefined()
      expect(cleared && 'fold' in cleared).toBe(false)
    })

    it('deletes the override on an edge that becomes the fold', () => {
      expect(nextFront({ fold: 'frontHem' })?.seamAllowance).toEqual({ default: '10' })
      expect(nextFront({ fold: 'frontHem' })?.fold).toBe('frontHem')
    })

    it('keeps other overrides when an edge becomes the fold', () => {
      const pattern = applyEdit(raglanTee, { kind: 'setPiece', pieceId: 'front', patch: { seamAllowance: { default: '10', perEdge: { frontHem: '25', frontSide: '5' } } } })
      const next = applyEdit(pattern, { kind: 'setPiece', pieceId: 'front', patch: { fold: 'frontSide' } })
      expect(next.pieces[0]?.seamAllowance).toEqual({ default: '10', perEdge: { frontHem: '25' } })
    })

    it('gives the same result when replayed', () => {
      const edit = { kind: 'setPiece', pieceId: 'front', patch: { fold: 'frontHem', cutCount: 3 } } as const
      expect(applyEdit(raglanTee, edit)).toEqual(applyEdit(raglanTee, edit))
    })
  })
})

describe('add and remove', () => {
  it('adds new items with unique names and ids', () => {
    const point = newItem(raglanTee, 'point')
    expect(point).toEqual({ kind: 'point', point: { id: 'p1', name: 'P_1', x: '0', y: '0' } })
    const next = applyEdit(raglanTee, { kind: 'add', item: point })
    expect(next.points.at(-1)).toEqual({ id: 'p1', name: 'P_1', x: '0', y: '0' })
    expect(newItem(next, 'point')).toEqual({ kind: 'point', point: { id: 'p2', name: 'P_2', x: '0', y: '0' } })
    expect(keyOf(point)).toEqual({ kind: 'point', id: 'p1' })
  })

  it('gives new measurements a value of 0 for every size', () => {
    expect(newItem(raglanTee, 'measurement')).toEqual({
      kind: 'measurement',
      measurement: { name: 'measurement_1', values: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 } }
    })
  })

  it('refuses adding a taken name or id', () => {
    expect(applyEdit(raglanTee, { kind: 'add', item: { kind: 'variable', variable: { name: 'chest', formula: '1' } } })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'add', item: { kind: 'point', point: { id: 'hps', name: 'Q', x: '0', y: '0' } } })).toBe(
      raglanTee
    )
  })

  it('removes without cascading, so dependents report issues', () => {
    const next = applyEdit(raglanTee, { kind: 'remove', item: { kind: 'variable', name: 'chest_ease' } })
    expect(next.variables.map((v) => v.name)).not.toContain('chest_ease')
    expect(evaluate(next, 'M').issues[0]).toMatchObject({ kind: 'undefined-reference', reference: 'chest_ease' })
    expect(applyEdit(raglanTee, { kind: 'remove', item: { kind: 'point', id: 'ghost' } })).toBe(raglanTee)
  })
})

describe('checkName', () => {
  it('explains invalid and taken names, allowing an item to keep its own', () => {
    expect(checkName(raglanTee, 'waist')).toBeNull()
    expect(checkName(raglanTee, 'not')?.kind).toBe('invalid')
    expect(checkName(raglanTee, 'HPS')).toEqual({ kind: 'taken', message: "'HPS' is already used by a point" })
    expect(checkName(raglanTee, 'HPS', { kind: 'point', id: 'hps' })).toBeNull()
  })
})

describe('setUnits', () => {
  it('changes display units only', () => {
    const next = applyEdit(raglanTee, { kind: 'setUnits', units: 'in' })
    expect(next.units).toBe('in')
    expect(next.measurements).toBe(raglanTee.measurements)
    expect(evaluate(next, 'M').points).toEqual(evaluate(raglanTee, 'M').points)
    expect(applyEdit(raglanTee, { kind: 'setUnits', units: 'cm' })).toBe(raglanTee)
  })
})
