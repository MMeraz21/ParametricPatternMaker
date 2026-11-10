// Journey for features/canvas.md. Run with:
//   node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/canvas.mjs

export default async function canvas({ window, evidence, rendererErrors }) {
  const canvasEl = window.getByRole('group', { name: 'Pattern canvas' })
  const marker = (name) => window.getByRole('button', { name: `Point ${name}`, exact: true })
  const centre = async (name) => {
    const box = await marker(name).locator('circle').boundingBox()
    return box && { x: box.x + box.width / 2, y: box.y + box.height / 2, size: box.width }
  }
  const zoomLevel = async () => Number.parseInt((await window.getByLabel('Zoom level').textContent()) ?? '', 10)
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const near = (a, b, tol = 1) => Math.abs(a - b) <= tol

  // canvas-render
  await marker('HPS').waitFor()
  evidence.check('canvas-render: canvas visible', await canvasEl.isVisible(), true)
  evidence.check('canvas-render: 29 point markers', await window.getByRole('button', { name: /^Point / }).count(), 29)
  evidence.check('canvas-render: front piece drawn', await window.getByLabel('Piece Front').count(), 1)
  evidence.check('canvas-render: no issues', await window.getByRole('heading', { name: 'Issues (0)' }).isVisible(), true)
  await evidence.screenshot(window, 'canvas-render')
  await evidence.aria(window, 'canvas-render')

  // canvas-fit
  const box = await canvasEl.boundingBox()
  const names = ['HPS', 'CFNeck', 'Underarm', 'SideHem', 'CFHem', 'NeckC1', 'NeckC2', 'RaglanC1', 'RaglanC2']
  const inside = async () => {
    for (const name of names) {
      const c = await centre(name)
      if (!c || c.x < box.x || c.x > box.x + box.width || c.y < box.y || c.y > box.y + box.height) return name
    }
    return 'all inside'
  }
  evidence.check('canvas-fit: every point inside the canvas on launch', await inside(), 'all inside')

  // canvas-zoom (buttons)
  const beforeZoom = { hps: await centre('HPS'), hem: await centre('CFHem'), level: await zoomLevel() }
  await window.getByRole('button', { name: 'Zoom in' }).click()
  const afterZoom = { hps: await centre('HPS'), hem: await centre('CFHem'), level: await zoomLevel() }
  evidence.check(
    'canvas-zoom: Zoom in scales distances by 1.25',
    dist(afterZoom.hps, afterZoom.hem) / dist(beforeZoom.hps, beforeZoom.hem),
    (r) => near(r, 1.25, 0.01)
  )
  evidence.check('canvas-zoom: readout goes up', afterZoom.level > beforeZoom.level, true)

  // canvas-constant-size
  evidence.check('canvas-constant-size: marker size unchanged by zoom', afterZoom.hps.size, (s) => near(s, beforeZoom.hps.size, 0.5))

  // canvas-zoom (ctrl+wheel about the cursor)
  const anchor = await centre('CFNeck')
  await window.mouse.move(anchor.x, anchor.y)
  const levelBeforeWheel = await zoomLevel()
  await window.keyboard.down('Control')
  await window.mouse.wheel(0, -100)
  await window.keyboard.up('Control')
  await window.waitForTimeout(100)
  const anchorAfter = await centre('CFNeck')
  evidence.check('canvas-zoom: ctrl+wheel zooms in', (await zoomLevel()) > levelBeforeWheel, true)
  evidence.check('canvas-zoom: point under the cursor stays put', dist(anchor, anchorAfter), (d) => d <= 1)

  // canvas-fit (button)
  await window.getByRole('button', { name: 'Fit' }).click()
  evidence.check('canvas-fit: Fit brings every point back inside', await inside(), 'all inside')

  // canvas-pan (drag empty canvas, then plain wheel)
  const empty = { x: box.x + box.width - 30, y: box.y + box.height - 30 }
  const hpsBeforePan = await centre('HPS')
  await window.mouse.move(empty.x, empty.y)
  await window.mouse.down()
  await window.mouse.move(empty.x - 60, empty.y - 40, { steps: 5 })
  await window.mouse.up()
  const hpsAfterDrag = await centre('HPS')
  evidence.check('canvas-pan: drag moves content with the pointer', { dx: hpsAfterDrag.x - hpsBeforePan.x, dy: hpsAfterDrag.y - hpsBeforePan.y }, (d) => near(d.dx, -60) && near(d.dy, -40))
  evidence.check('canvas-pan: dragging empty canvas selects nothing', await window.getByText('Select a point on the canvas to see its formulas.').isVisible(), true)
  await window.mouse.move(empty.x, empty.y)
  await window.mouse.wheel(0, 50)
  await window.waitForTimeout(100)
  const hpsAfterWheel = await centre('HPS')
  evidence.check('canvas-pan: plain wheel pans up', hpsAfterWheel.y - hpsAfterDrag.y, (dy) => near(dy, -50))

  // canvas-pan: a move reporting no button held ends the drag (the release was lost, e.g. Cmd-Tab mid-drag).
  await window.mouse.move(empty.x, empty.y)
  await window.mouse.down()
  await window.mouse.move(empty.x - 20, empty.y, { steps: 2 })
  const hpsMidDrag = await centre('HPS')
  await canvasEl.evaluate((svg, at) => {
    svg.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: at.x, clientY: at.y, bubbles: true }))
  }, { x: 200, y: 200 })
  await window.mouse.move(empty.x - 80, empty.y, { steps: 3 })
  await window.mouse.up()
  evidence.check('canvas-pan: a move with no button held ends the drag', dist(await centre('HPS'), hpsMidDrag), (d) => d <= 1)
  await window.getByRole('button', { name: 'Fit' }).click()

  // canvas-select
  await marker('Underarm').locator('circle').click()
  const inspector = window.getByRole('region', { name: 'Point inspector' })
  evidence.check('canvas-select: inspector heading', await inspector.getByRole('heading', { level: 2 }).textContent(), 'Underarm')
  evidence.check('canvas-select: x formula', await window.getByLabel('Underarm x formula').inputValue(), 'body_width')
  evidence.check('canvas-select: x value', await window.getByLabel('Underarm.x value').textContent(), '27.5 cm')
  evidence.check('canvas-select: marker pressed', await marker('Underarm').getAttribute('aria-pressed'), 'true')
  await evidence.screenshot(window, 'canvas-select')
  await marker('RaglanC1').locator('circle').click()
  evidence.check('canvas-select: control point badge', await inspector.getByText('Control point').isVisible(), true)

  // canvas-edit. The CBNeck label overlaps HPS at this zoom. The canvas picks the nearest marker by position,
  // so a real click works; force skips Playwright's check for what is on top.
  await marker('HPS').locator('circle').click({ force: true })
  const hpsBeforeEdit = await centre('HPS')
  const neckC1BeforeEdit = await centre('NeckC1')
  const hpsX = window.getByLabel('HPS x formula')
  await hpsX.fill('neck_width + 30')
  await hpsX.press('Enter')
  evidence.check('canvas-edit: value updates on Enter', await window.getByLabel('HPS.x value').textContent(), '10 cm')
  evidence.check('canvas-edit: HPS moves right', (await centre('HPS')).x > hpsBeforeEdit.x + 5, true)
  evidence.check('canvas-edit: dependent NeckC1 moves right', (await centre('NeckC1')).x > neckC1BeforeEdit.x + 5, true)
  await hpsX.fill('something else')
  await hpsX.press('Escape')
  evidence.check('canvas-edit: Escape reverts the draft', await hpsX.inputValue(), 'neck_width + 30')

  // canvas-broken
  await hpsX.fill('nope')
  await hpsX.press('Enter')
  evidence.check('canvas-broken: alert shown', await window.getByRole('alert').isVisible(), true)
  evidence.check('canvas-broken: HPS marker gone', await marker('HPS').count(), 0)
  evidence.check('canvas-broken: issues listed', await window.getByRole('heading', { name: 'Issues (0)' }).count(), 0)
  evidence.check('canvas-broken: still selected and editable', await hpsX.inputValue(), 'nope')
  await evidence.screenshot(window, 'canvas-broken')
  await evidence.aria(window, 'canvas-broken')
  await marker('Underarm').locator('circle').click()
  await window.getByRole('button', { name: "'nope' is not defined" }).click()
  evidence.check('canvas-broken: issue reselects HPS', await inspector.getByRole('heading', { level: 2 }).textContent(), 'HPS')
  await hpsX.fill('neck_width')
  await hpsX.press('Enter')
  evidence.check('canvas-broken: fixing brings HPS back', await marker('HPS').count(), 1)
  evidence.check('canvas-broken: issues cleared', await window.getByRole('heading', { name: 'Issues (0)' }).isVisible(), true)

  // canvas-select (clear)
  await window.mouse.click(empty.x, empty.y)
  evidence.check('canvas-select: empty click clears selection', await window.getByText('Select a point on the canvas to see its formulas.').isVisible(), true)

  evidence.check('canvas-console: no renderer errors', rendererErrors, (errors) => errors.length === 0)
}
