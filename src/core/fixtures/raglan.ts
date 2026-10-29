import { CURRENT_SCHEMA_VERSION, type Pattern } from '../model'

/**
 * Raglan baseball tee, shared by tests across the core. Currently drafts the front body only;
 * back, sleeve and neckband are added as the geometry milestones land.
 *
 * Coordinates are in mm with y pointing down (SVG convention). x = 0 is centre front (cut on fold).
 */
export const raglanTee: Pattern = {
  version: CURRENT_SCHEMA_VERSION,
  units: 'cm',
  sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  activeSize: 'M',
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
    { name: 'hem_length', formula: 'back_length - 20' }
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
    { id: 'raglanC2', name: 'RaglanC2', x: 'Underarm.x - 15', y: 'Underarm.y * 0.85' }
  ],
  segments: [
    { id: 'frontNeck', kind: 'bezier', from: 'hps', c1: 'neckC1', c2: 'neckC2', to: 'cfNeck' },
    { id: 'frontCf', kind: 'line', from: 'cfNeck', to: 'cfHem' },
    { id: 'frontHem', kind: 'line', from: 'cfHem', to: 'sideHem' },
    { id: 'frontSide', kind: 'line', from: 'sideHem', to: 'underarm' },
    { id: 'frontRaglan', kind: 'bezier', from: 'underarm', c1: 'raglanC2', c2: 'raglanC1', to: 'hps' }
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
      seamAllowance: { default: 10, perEdge: { frontHem: 25, frontCf: 0 } },
      notches: [{ id: 'frontRaglanNotch', segmentId: 'frontRaglan', distance: '100' }],
      grainline: ['cfNeck', 'cfHem'],
      cutCount: 1,
      mirror: true
    }
  ]
}
