// Journey for features/sizes.md. Run with:
//   node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/sizes.mjs

export default async function sizes({ window, evidence, rendererErrors }) {
  const tab = (name) => window.getByRole('tab', { name })
  const field = (label) => window.getByLabel(label, { exact: true })
  const drawn = (label) => window.locator(`[aria-label="${label}"]`)
  const sizeSelect = field('Size')
  const nest = window.getByLabel('All sizes')
  const legend = window.getByRole('list', { name: 'Size legend' })
  const commit = async (label, value) => {
    await field(label).fill(value)
    await field(label).press('Enter')
  }
  const lowest = async (label) => {
    const numbers = (await drawn(label).getAttribute('d')).match(/-?[\d.]+/g).map(Number)
    return Math.max(...numbers.filter((_, i) => i % 2 === 1))
  }
  const worldTransform = () => window.locator('svg[aria-label="Pattern canvas"] > g').first().getAttribute('transform')
  const zoom = () => window.getByRole('status', { name: 'Zoom level' }).textContent()
  const options = async () => (await sizeSelect.locator('option').allTextContents()).join(', ')
  const graded = () => window.locator('[aria-label^="Graded "]:not([aria-label^="Graded cut line"])')
  const gradedCuts = () => window.locator('[aria-label^="Graded cut line"]')
  const issuesHeading = (n) => window.getByRole('heading', { name: `Issues (${n})` })

  // sizes-switch
  await window.getByRole('button', { name: 'Point HPS', exact: true }).waitFor()
  evidence.check('sizes-switch: opens at M', await sizeSelect.inputValue(), 'M')
  evidence.check('sizes-switch: every size listed', await options(), 'S, M, L, XL, XXL')
  evidence.check('sizes-switch: Front cut line at M', await lowest('Cut line Front'), 715)
  const transformBefore = await worldTransform()
  const zoomBefore = await zoom()
  await window.getByRole('button', { name: 'Point Underarm', exact: true }).focus()
  await window.keyboard.press('Enter')
  const underarmAtM = await window.getByLabel('Underarm.x value').textContent()
  await sizeSelect.selectOption('XXL')
  evidence.check('sizes-switch: Front cut line follows', await lowest('Cut line Front'), 775)
  evidence.check('sizes-switch: inspector value follows', (await window.getByLabel('Underarm.x value').textContent()) !== underarmAtM, true)
  await tab('Measurements').click()
  const emphasised = await window.getByRole('columnheader', { name: 'XXL', exact: true }).getAttribute('class')
  evidence.check('sizes-switch: column emphasis moves', emphasised.includes('text-sky-700'), true)
  await evidence.screenshot(window, 'sizes-switched')

  // sizes-camera
  evidence.check('sizes-camera: switching keeps the view', await worldTransform(), transformBefore)
  evidence.check('sizes-camera: switching keeps the zoom', await zoom(), zoomBefore)
  await sizeSelect.selectOption('M')

  // sizes-edit
  const atMBefore = await drawn('Cut line Front').getAttribute('d')
  await commit('chest L', '112')
  evidence.check('sizes-edit: editing L leaves M as drawn', await drawn('Cut line Front').getAttribute('d'), atMBefore)
  await sizeSelect.selectOption('L')
  const widened = await drawn('Cut line Front').getAttribute('d')
  evidence.check('sizes-edit: L shows the edit', widened !== atMBefore, true)
  await field('chest L').fill('108')
  await sizeSelect.focus()
  evidence.check('sizes-edit: a half-typed cell commits when the dropdown takes focus', (await drawn('Cut line Front').getAttribute('d')) !== widened, true)
  await sizeSelect.selectOption('M')

  // sizes-nest, sizes-perf, sizes-camera on a fit view
  await window.getByRole('button', { name: 'Fit', exact: true }).click()
  const markers = await window.locator('[aria-label^="Point "]').count()
  const paintMs = await window.evaluate(async () => {
    const box = [...document.querySelectorAll('input[type=checkbox]')][0]
    const start = performance.now()
    box.click()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return performance.now() - start
  })
  evidence.check('sizes-perf: toggle to painted frame under 100 ms', paintMs, (ms) => ms < 100)
  await evidence.json('sizes-perf', { paintMs })
  evidence.check('sizes-nest: 16 graded outlines at M', await graded().count(), 16)
  evidence.check('sizes-nest: 16 graded cut lines at M', await gradedCuts().count(), 16)
  evidence.check('sizes-nest: stacked on the shown sleeve', await drawn('Graded S Sleeve').getAttribute('transform'), 'translate(40 0)')
  evidence.check('sizes-nest: no extra markers', await window.locator('[aria-label^="Point "]').count(), markers)
  const canvasBox = await window.getByRole('group', { name: 'Pattern canvas' }).boundingBox()
  const inside = async (label) => {
    const box = await drawn(label).boundingBox()
    return box.x >= canvasBox.x && box.y >= canvasBox.y && box.x + box.width <= canvasBox.x + canvasBox.width && box.y + box.height <= canvasBox.y + canvasBox.height
  }
  for (const label of ['Graded XXL Sleeve', 'Graded XXL Front', 'Graded XXL Neckband']) evidence.check(`sizes-camera: ${label} stays on screen`, await inside(label), true)
  await evidence.screenshot(window, 'sizes-nest')
  await evidence.aria(window, 'sizes-nest')
  await nest.uncheck()
  evidence.check('sizes-nest: off again', await graded().count(), 0)

  // sizes-camera from a zoomed-in view
  for (let i = 0; i < 3; i++) await window.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const zoomedIn = await worldTransform()
  await nest.check()
  evidence.check('sizes-camera: zoomed in, the nest changes nothing', await worldTransform(), zoomedIn)
  await nest.uncheck()
  await window.getByRole('button', { name: 'Fit', exact: true }).click()

  // sizes-nest-failure and sizes-issue
  await tab('Variables').click()
  await commit('band_width formula', 'chest > 1200 ? 0 : 60')
  await tab('Pieces').click()
  await field('Front name').click()
  await commit('frontNeck allowance', 'chest / 21')
  evidence.check('sizes-issue: dropdown counts the problems', (await options()).split(', ').at(-1), 'XXL (2 issues)')
  evidence.check('sizes-issue: other sizes have none', (await options()).split(', ').slice(0, 4).join(), 'S,M,L,XL')
  evidence.check('sizes-issue: heading counts findings', await issuesHeading(2).isVisible(), true)
  await nest.check()
  evidence.check('sizes-nest-failure: 15 outlines', await graded().count(), 15)
  evidence.check('sizes-nest-failure: 14 cut lines', await gradedCuts().count(), 14)
  const legendText = await legend.textContent()
  evidence.check('sizes-nest-failure: legend names the missing outline', legendText.includes('Neckband: no outline'), true)
  evidence.check('sizes-nest-failure: legend names the missing cut line', legendText.includes('Front: no cut line'), true)
  evidence.check('sizes-nest-failure: M keeps its cut line', await drawn('Cut line Front').count(), 1)
  await evidence.screenshot(window, 'sizes-nest-failure')
  await nest.uncheck()

  const neckbandIssue = window.locator('li', { hasText: "Neckband" }).filter({ has: window.getByRole('button') }).last()
  evidence.check('sizes-issue: row has a badge naming the size', await neckbandIssue.locator('span').textContent(), 'XXL')
  await neckbandIssue.getByRole('button').click()
  evidence.check('sizes-issue: clicking switches to the size that has it', await sizeSelect.inputValue(), 'XXL')
  evidence.check('sizes-issue: and selects the piece', await field('Neckband name').locator('xpath=ancestor::tr').getAttribute('aria-selected'), 'true')
  await evidence.screenshot(window, 'sizes-issue')

  // Put the fixture back, so the size edits start clean.
  await field('Front name').click()
  await commit('frontNeck allowance', '')
  await tab('Variables').click()
  await commit('band_width formula', '60')
  await sizeSelect.selectOption('M')
  evidence.check('sizes-issue: clean again', await issuesHeading(0).isVisible(), true)

  // sizes-add
  await tab('Measurements').click()
  const chestAtM = await field('chest M').inputValue()
  await tab('Sizes').click()
  await window.getByRole('button', { name: '+ Add size', exact: true }).click()
  evidence.check('sizes-add: the new size is shown', await sizeSelect.inputValue(), 'Size 1')
  evidence.check('sizes-add: placed after the one it copied', await options(), 'S, M, Size 1, L, XL, XXL')
  evidence.check('sizes-add: no new issues', await issuesHeading(0).isVisible(), true)
  await tab('Measurements').click()
  evidence.check('sizes-add: copies its values', await field('chest Size 1').inputValue(), chestAtM)

  // sizes-rename
  await tab('Sizes').click()
  await commit('Size 1 name', 'XS')
  evidence.check('sizes-rename: dropdown follows', await sizeSelect.inputValue(), 'XS')
  await commit('XS name', '__proto__')
  evidence.check('sizes-rename: a reserved word is refused', await window.getByRole('alert').first().isVisible(), true)
  await field('XS name').press('Escape')
  await commit('XS name', 'xl')
  evidence.check('sizes-rename: a name taken in another case is refused', (await window.getByRole('alert').first().textContent()).includes("'XL'"), true)
  await field('XS name').press('Escape')
  await evidence.screenshot(window, 'sizes-tab')
  await evidence.aria(window, 'sizes-tab')

  // sizes-remove
  await window.getByRole('button', { name: 'Delete XS', exact: true }).click()
  evidence.check('sizes-remove: moves to a neighbour', await sizeSelect.inputValue(), 'L')
  for (const size of ['S', 'M', 'XL', 'XXL']) await window.getByRole('button', { name: `Delete ${size}`, exact: true }).click()
  evidence.check('sizes-remove: one size left', await options(), 'L')
  evidence.check('sizes-remove: the last size has no delete', await window.getByRole('button', { name: 'Delete L', exact: true }).count(), 0)

  // sizes-console
  evidence.check('sizes-console: no renderer errors', rendererErrors.length, 0)
}
