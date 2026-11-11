import { applyEdit, type PatternEdit } from '../edit'
import { CURRENT_SCHEMA_VERSION, type Pattern } from '../model'

/**
 * Raglan baseball tee, shared by tests across the core and the MVP acceptance test: front, back, sleeve
 * and neckband in sizes S to XXL. New items are appended so existing indices stay valid.
 *
 * Coordinates are in mm with y pointing down (SVG convention). x = 0 is the centre front and centre back
 * (cut on fold). The back shares the front's hem and side seam. The sleeve raglans are point reflections
 * of the body raglans, so each pair of raglan seams has exactly the same length in every size.
 */
export const raglanTee: Pattern = {
  version: CURRENT_SCHEMA_VERSION,
  units: 'cm',
  sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  measurements: [
    { name: 'chest', values: { S: 920, M: 1000, L: 1080, XL: 1160, XXL: 1260 } },
    { name: 'neck', values: { S: 370, M: 390, L: 410, XL: 430, XXL: 450 } },
    { name: 'shoulder_width', values: { S: 430, M: 450, L: 470, XL: 490, XXL: 510 } },
    { name: 'back_length', values: { S: 690, M: 710, L: 730, XL: 750, XXL: 770 } },
    { name: 'armhole_depth', values: { S: 210, M: 220, L: 230, XL: 240, XXL: 250 } }
  ],
  variables: [
    { name: 'chest_ease', formula: '100' },
    { name: 'body_width', formula: '(chest + chest_ease) / 4' },
    { name: 'neck_width', formula: 'neck / 6 + 5' },
    { name: 'front_neck_depth', formula: 'neck / 6 + 25' },
    { name: 'hem_length', formula: 'back_length - 20' },
    { name: 'back_neck_depth', formula: 'neck_width * 0.35' },
    { name: 'sleeve_centre', formula: 'body_width * 2 + 200' },
    { name: 'sleeve_top_half', formula: 'neck_width * 0.6' },
    { name: 'sleeve_length', formula: '240' },
    { name: 'sleeve_hem_half', formula: 'chest / 8 + 10' },
    { name: 'band_length', formula: '(neck_width - 5) * 5.5' },
    { name: 'band_width', formula: '60' },
    { name: 'band_top', formula: 'hem_length + 150' }
  ],
  points: [
    { id: 'hps', name: 'HPS', x: 'neck_width', y: '0' },
    { id: 'cfNeck', name: 'CFNeck', x: '0', y: 'front_neck_depth' },
    { id: 'underarm', name: 'Underarm', x: 'body_width', y: 'armhole_depth + 30' },
    { id: 'sideHem', name: 'SideHem', x: 'Underarm.x', y: 'hem_length' },
    { id: 'cfHem', name: 'CFHem', x: '0', y: 'hem_length' },
    // Control points are relative to their anchors so the curves keep their shape under grading.
    { id: 'neckC1', name: 'NeckC1', x: 'HPS.x * 0.9', y: 'CFNeck.y * 0.6' },
    { id: 'neckC2', name: 'NeckC2', x: 'HPS.x * 0.5', y: 'CFNeck.y' },
    { id: 'raglanC1', name: 'RaglanC1', x: 'HPS.x + (Underarm.x - HPS.x) * 0.55', y: 'Underarm.y * 0.4' },
    { id: 'raglanC2', name: 'RaglanC2', x: 'Underarm.x - 15', y: 'Underarm.y * 0.85' },
    // Back.
    { id: 'cbNeck', name: 'CBNeck', x: '0', y: 'back_neck_depth' },
    { id: 'backNeckC1', name: 'BackNeckC1', x: 'HPS.x * 0.8', y: 'CBNeck.y * 0.9' },
    { id: 'backNeckC2', name: 'BackNeckC2', x: 'HPS.x * 0.4', y: 'CBNeck.y' },
    { id: 'backRaglanC1', name: 'BackRaglanC1', x: 'Underarm.x - 25', y: 'Underarm.y * 0.8' },
    { id: 'backRaglanC2', name: 'BackRaglanC2', x: 'HPS.x + (Underarm.x - HPS.x) * 0.5', y: 'Underarm.y * 0.35' },
    // Sleeve, drafted flat to the right of the body. Its raglan controls mirror the body's through the chord.
    { id: 'sleeveTopFront', name: 'SleeveTopFront', x: 'sleeve_centre + sleeve_top_half', y: '0' },
    { id: 'sleeveTopBack', name: 'SleeveTopBack', x: 'sleeve_centre - sleeve_top_half', y: '0' },
    { id: 'sleeveNeckC', name: 'SleeveNeckC', x: 'sleeve_centre', y: '-12' },
    { id: 'sleeveUnderFront', name: 'SleeveUnderFront', x: 'SleeveTopFront.x + (Underarm.x - HPS.x)', y: 'Underarm.y' },
    { id: 'sleeveFrontC1', name: 'SleeveFrontC1', x: 'SleeveTopFront.x + (Underarm.x - RaglanC2.x)', y: 'Underarm.y - RaglanC2.y' },
    { id: 'sleeveFrontC2', name: 'SleeveFrontC2', x: 'SleeveTopFront.x + (Underarm.x - RaglanC1.x)', y: 'Underarm.y - RaglanC1.y' },
    { id: 'sleeveUnderBack', name: 'SleeveUnderBack', x: 'SleeveTopBack.x - (Underarm.x - HPS.x)', y: 'Underarm.y' },
    { id: 'sleeveBackC1', name: 'SleeveBackC1', x: 'SleeveTopBack.x - (Underarm.x - BackRaglanC2.x)', y: 'Underarm.y - BackRaglanC2.y' },
    { id: 'sleeveBackC2', name: 'SleeveBackC2', x: 'SleeveTopBack.x - (Underarm.x - BackRaglanC1.x)', y: 'Underarm.y - BackRaglanC1.y' },
    { id: 'sleeveHemFront', name: 'SleeveHemFront', x: 'sleeve_centre + sleeve_hem_half', y: 'Underarm.y + sleeve_length' },
    { id: 'sleeveHemBack', name: 'SleeveHemBack', x: 'sleeve_centre - sleeve_hem_half', y: 'Underarm.y + sleeve_length' },
    // Neckband, a plain strip below the body. Its outline winds the other way from the body pieces.
    { id: 'bandA', name: 'BandA', x: '0', y: 'band_top' },
    { id: 'bandB', name: 'BandB', x: 'band_length', y: 'band_top' },
    { id: 'bandC', name: 'BandC', x: 'band_length', y: 'band_top + band_width' },
    { id: 'bandD', name: 'BandD', x: '0', y: 'band_top + band_width' }
  ],
  segments: [
    { id: 'frontNeck', kind: 'bezier', from: 'hps', c1: 'neckC1', c2: 'neckC2', to: 'cfNeck' },
    { id: 'frontCf', kind: 'line', from: 'cfNeck', to: 'cfHem' },
    { id: 'frontHem', kind: 'line', from: 'cfHem', to: 'sideHem' },
    { id: 'frontSide', kind: 'line', from: 'sideHem', to: 'underarm' },
    { id: 'frontRaglan', kind: 'bezier', from: 'underarm', c1: 'raglanC2', c2: 'raglanC1', to: 'hps' },
    { id: 'backNeck', kind: 'bezier', from: 'hps', c1: 'backNeckC1', c2: 'backNeckC2', to: 'cbNeck' },
    { id: 'backCb', kind: 'line', from: 'cbNeck', to: 'cfHem' },
    { id: 'backRaglan', kind: 'bezier', from: 'underarm', c1: 'backRaglanC1', c2: 'backRaglanC2', to: 'hps' },
    { id: 'sleeveNeck', kind: 'bezier', from: 'sleeveTopBack', c1: 'sleeveNeckC', c2: 'sleeveNeckC', to: 'sleeveTopFront' },
    { id: 'sleeveFrontRaglan', kind: 'bezier', from: 'sleeveTopFront', c1: 'sleeveFrontC1', c2: 'sleeveFrontC2', to: 'sleeveUnderFront' },
    { id: 'sleeveFrontSeam', kind: 'line', from: 'sleeveUnderFront', to: 'sleeveHemFront' },
    { id: 'sleeveHem', kind: 'line', from: 'sleeveHemFront', to: 'sleeveHemBack' },
    { id: 'sleeveBackSeam', kind: 'line', from: 'sleeveHemBack', to: 'sleeveUnderBack' },
    { id: 'sleeveBackRaglan', kind: 'bezier', from: 'sleeveUnderBack', c1: 'sleeveBackC1', c2: 'sleeveBackC2', to: 'sleeveTopBack' },
    { id: 'bandTop', kind: 'line', from: 'bandA', to: 'bandB' },
    { id: 'bandRight', kind: 'line', from: 'bandB', to: 'bandC' },
    { id: 'bandBottom', kind: 'line', from: 'bandC', to: 'bandD' },
    { id: 'bandLeft', kind: 'line', from: 'bandD', to: 'bandA' }
  ],
  pieces: [
    {
      id: 'front',
      name: 'Front',
      outline: [
        { segmentId: 'frontNeck' },
        { segmentId: 'frontCf' },
        { segmentId: 'frontHem' },
        { segmentId: 'frontSide' },
        { segmentId: 'frontRaglan' }
      ],
      seamAllowance: { default: '10', perEdge: { frontHem: '25' } },
      notches: [{ id: 'frontRaglanNotch', segmentId: 'frontRaglan', distance: '100' }],
      grainline: ['cfNeck', 'cfHem'],
      cutCount: 1,
      fold: 'frontCf'
    },
    {
      id: 'back',
      name: 'Back',
      outline: [
        { segmentId: 'backNeck' },
        { segmentId: 'backCb' },
        { segmentId: 'frontHem' },
        { segmentId: 'frontSide' },
        { segmentId: 'backRaglan' }
      ],
      seamAllowance: { default: '10', perEdge: { frontHem: '25' } },
      notches: [{ id: 'backRaglanNotch', segmentId: 'backRaglan', distance: '100' }],
      grainline: ['cbNeck', 'cfHem'],
      cutCount: 1,
      fold: 'backCb'
    },
    {
      id: 'sleeve',
      name: 'Sleeve',
      outline: [
        { segmentId: 'sleeveNeck' },
        { segmentId: 'sleeveFrontRaglan' },
        { segmentId: 'sleeveFrontSeam' },
        { segmentId: 'sleeveHem' },
        { segmentId: 'sleeveBackSeam' },
        { segmentId: 'sleeveBackRaglan' }
      ],
      seamAllowance: { default: '10', perEdge: { sleeveHem: '25' } },
      notches: [],
      grainline: ['sleeveNeckC', 'sleeveHemFront'],
      cutCount: 2,
      stackPoint: 'sleeveNeckC'
    },
    {
      id: 'neckband',
      name: 'Neckband',
      outline: [
        { segmentId: 'bandTop' },
        { segmentId: 'bandRight' },
        { segmentId: 'bandBottom' },
        { segmentId: 'bandLeft' }
      ],
      seamAllowance: { default: '10' },
      notches: [],
      grainline: ['bandA', 'bandB'],
      cutCount: 1,
      stackPoint: 'bandA'
    }
  ]
}

const XXL_ONLY_FAILURES: readonly PatternEdit[] = [
  // The neckband has no height once the chest passes 1200 mm, so it has no outline.
  { kind: 'setFormula', owner: { kind: 'variable', name: 'band_width' }, formula: 'chest > 1200 ? 0 : 60' },
  // The neckline allowance grows with the chest, until in XXL the cut line passes the fold.
  { kind: 'setPiece', pieceId: 'front', patch: { seamAllowance: { default: '10', perEdge: { frontHem: '25', frontNeck: 'chest / 21' } } } }
]

/**
 * The raglan with two failures that only happen in the largest size: Neckband loses its outline and Front loses
 * its cut line. The milestone 6 acceptance fixture; docs/design/m6-size-switcher.md says what it proves.
 */
export const raglanFailingInXXL: Pattern = XXL_ONLY_FAILURES.reduce<Pattern>(applyEdit, raglanTee)

const PRINT_HAZARDS: readonly PatternEdit[] = [
  { kind: 'setUnits', units: 'in' },
  // Not encodable in the PDF's standard font, and unsafe in XML unless escaped.
  { kind: 'setPiece', pieceId: 'sleeve', patch: { name: 'Sleeve <袖> & "cuff"' } },
  // A grainline with no length in S only. Its points are used by nothing else, so S keeps its outline and cut line.
  { kind: 'add', item: { kind: 'point', point: { id: 'sleeveGrainTop', name: 'SleeveGrainTop', x: 'sleeve_centre', y: '100' } } },
  { kind: 'add', item: { kind: 'point', point: { id: 'sleeveGrainEnd', name: 'SleeveGrainEnd', x: 'sleeve_centre', y: 'chest < 1000 ? 100 : 300' } } },
  { kind: 'setPiece', pieceId: 'sleeve', patch: { grainline: ['sleeveGrainTop', 'sleeveGrainEnd'] } },
  // A notch past the end of its edge in L only.
  {
    kind: 'setPiece',
    pieceId: 'back',
    patch: { notches: [{ id: 'backRaglanNotch', segmentId: 'backRaglan', distance: 'chest > 1100 ? 100 : chest > 1050 ? 99999 : 100' }] }
  }
]

/**
 * The raglan in inches with what only printing cares about: a piece name a PDF font can't encode and XML must escape,
 * a grainline lost in S and a notch lost in L. M, XL and XXL are clean. One of the milestone 7 acceptance fixtures;
 * docs/design/m7-export.md says what it proves.
 */
export const raglanPrintHazards: Pattern = PRINT_HAZARDS.reduce<Pattern>(applyEdit, raglanTee)
