// Journey for features/pieces.md. Run with:
//   node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/pieces.mjs

export default async function pieces({ window, evidence, rendererErrors }) {
  const tab = (name) => window.getByRole('tab', { name })
  const field = (label) => window.getByLabel(label, { exact: true })
  const drawn = (label) => window.locator(`[aria-label="${label}"]`)
  const rowOf = (label) => window.locator('tr', { has: field(label) })
  const table = (name) => window.getByRole('table', { name, exact: true })
  const issue = (name) => window.getByRole('button', { name, exact: true })
  const commit = async (label, value) => {
    await field(label).fill(value)
    await field(label).press('Enter')
  }
  // Geometry from the path itself, in mm, so it doesn't depend on the view.
  const coordinates = async (label) => {
    const numbers = (await drawn(label).getAttribute('d')).match(/-?[\d.]+/g).map(Number)
    return { xs: numbers.filter((_, i) => i % 2 === 0), ys: numbers.filter((_, i) => i % 2 === 1) }
  }
  const lowest = async (label) => Math.max(...(await coordinates(label)).ys)
  const leftmost = async (label) => Math.min(...(await coordinates(label)).xs)

  // pieces-canvas
  await window.getByRole('button', { name: 'Point HPS', exact: true }).waitFor()
  for (const name of ['Front', 'Back', 'Sleeve', 'Neckband']) {
    evidence.check(`pieces-canvas: ${name} has a cut line`, await drawn(`Cut line ${name}`).count(), 1)
    evidence.check(`pieces-canvas: ${name} has a grainline`, await drawn(`Grainline ${name}`).count(), 1)
  }
  evidence.check('pieces-canvas: Front is cut on the fold', await drawn('Fold Front').count(), 1)
  evidence.check('pieces-canvas: Sleeve is not', await drawn('Fold Sleeve').count(), 0)
  evidence.check('pieces-canvas: Front has a notch mark', await drawn('Notch mark Front').count(), 1)
  evidence.check('pieces-canvas: no issues', await window.getByRole('heading', { name: 'Issues (0)' }).isVisible(), true)
  await evidence.screenshot(window, 'pieces-canvas')

  // pieces-select
  await tab('Pieces').click()
  evidence.check('pieces-select: Pieces table lists every piece', (await table('Pieces').getByRole('row').count()) - 1, 4)
  evidence.check('pieces-select: no edges until one is selected', await table('Edges of Front').count(), 0)
  await field('Front name').click()
  evidence.check('pieces-select: row selected', await rowOf('Front name').getAttribute('aria-selected'), 'true')
  evidence.check('pieces-select: edges shown', await table('Edges of Front').count(), 1)
  evidence.check('pieces-select: notches shown', await table('Notches of Front').count(), 1)
  evidence.check('pieces-select: hem override shown', await field('frontHem allowance').inputValue(), '25')
  // Playwright scrolls for us, so compare positions: a person must see these without scrolling.
  const dock = await window.getByRole('tabpanel').boundingBox()
  for (const name of ['Pieces', 'Edges of Front', 'Notches of Front']) {
    const box = await table(name).boundingBox()
    evidence.check(`pieces-select: ${name} starts inside the dock`, box.y >= dock.y - 1 && box.y < dock.y + 40, true)
  }
  evidence.check(
    'pieces-select: the window does not scroll',
    await window.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth),
    true
  )
  for (const label of ['frontHem segment', 'frontRaglan segment', 'frontRaglanNotch distance']) {
    evidence.check(`pieces-select: ${label} is fully readable`, await field(label).evaluate((el) => el.scrollWidth <= el.clientWidth), true)
  }
  await evidence.screenshot(window, 'pieces-selected')
  await evidence.aria(window, 'pieces-selected')

  // pieces-allowance
  const sleeveBefore = await drawn('Cut line Sleeve').getAttribute('d')
  await commit('Sleeve allowance', '20')
  evidence.check('pieces-allowance: cut line moves', (await drawn('Cut line Sleeve').getAttribute('d')) !== sleeveBefore, true)
  await commit('Sleeve allowance', '10')
  evidence.check('pieces-allowance: restored', await drawn('Cut line Sleeve').getAttribute('d'), sleeveBefore)

  // pieces-override
  await field('Front name').click()
  evidence.check('pieces-override: hem starts at 25', await lowest('Cut line Front'), 715)
  await commit('frontHem allowance', '40')
  evidence.check('pieces-override: hem at its own width', await lowest('Cut line Front'), 730)
  await commit('frontHem allowance', '')
  evidence.check('pieces-override: blank returns to the default', await lowest('Cut line Front'), 700)
  await commit('frontHem allowance', '25')

  // pieces-fold
  evidence.check('pieces-fold: lands on the fold', await leftmost('Cut line Front'), 0)
  await commit('Front fold', '')
  evidence.check('pieces-fold: fold line gone', await drawn('Fold Front').count(), 0)
  evidence.check('pieces-fold: edge takes the default allowance', await leftmost('Cut line Front'), -10)
  await commit('Front fold', 'sleeveHem')
  evidence.check('pieces-fold: refuses an edge of another piece', await window.getByRole('alert').textContent(), "'sleeveHem' is not an edge of Front")
  await field('Front fold').press('Escape')
  await commit('Front fold', 'frontCf')
  evidence.check('pieces-fold: restored', await leftmost('Cut line Front'), 0)

  // pieces-issue
  await commit('Front allowance', 'nope')
  evidence.check('pieces-issue: no cut line', await drawn('Cut line Front').count(), 0)
  evidence.check('pieces-issue: piece still drawn', await drawn('Piece Front').count(), 1)
  await tab('Measurements').click()
  await issue("'nope' is not defined").click()
  evidence.check('pieces-issue: issue opens Pieces', await tab('Pieces').getAttribute('aria-selected'), 'true')
  evidence.check('pieces-issue: piece selected', await rowOf('Front name').getAttribute('aria-selected'), 'true')
  await commit('Front allowance', '10')
  evidence.check('pieces-issue: cut line back', await drawn('Cut line Front').count(), 1)

  // pieces-failure
  await commit('Front allowance', '1e6')
  evidence.check('pieces-failure: says why', await issue("Piece 'Front' is too large for a cut line: the limit is 100 m").count(), 1)
  evidence.check('pieces-failure: piece still drawn', await drawn('Piece Front').count(), 1)
  await evidence.screenshot(window, 'pieces-failure')
  await commit('Front allowance', '10')
  evidence.check('pieces-failure: no issues after restoring', await window.getByRole('heading', { name: 'Issues (0)' }).isVisible(), true)

  // pieces-notch
  const markBefore = await drawn('Notch mark Front').getAttribute('y1')
  await commit('frontRaglanNotch distance', '150')
  evidence.check('pieces-notch: mark moves', (await drawn('Notch mark Front').getAttribute('y1')) !== markBefore, true)
  await commit('frontRaglanNotch distance', '100')
  await window.getByRole('button', { name: '+ Add notch' }).click()
  evidence.check('pieces-notch: added', await drawn('Notch mark Front').count(), 2)
  await window.getByRole('button', { name: 'Delete n1', exact: true }).click()
  evidence.check('pieces-notch: deleted', await drawn('Notch mark Front').count(), 1)

  // pieces-segment
  await tab('Segments').click()
  evidence.check('pieces-segment: points by name', await field('frontNeck c1').inputValue(), 'NeckC1')
  await commit('frontHem from', 'Nope')
  evidence.check('pieces-segment: refuses an unknown point', await window.getByRole('alert').textContent(), "No point named 'Nope'")
  await field('frontHem from').press('Escape')
  evidence.check('pieces-segment: a line has no controls', await field('frontCf c1').textContent(), '—')
  await commit('frontCf kind', 'bezier')
  evidence.check('pieces-segment: a bezier does', await field('frontCf c1').inputValue(), 'CFNeck')
  await commit('frontCf kind', 'line')
  evidence.check('pieces-segment: restored without issues', await window.getByRole('heading', { name: 'Issues (0)' }).isVisible(), true)

  // pieces-add
  await tab('Pieces').click()
  await window.getByRole('button', { name: '+ Add piece' }).click()
  evidence.check('pieces-add: new row selected', await rowOf('Piece 1 name').getAttribute('aria-selected'), 'true')
  evidence.check('pieces-add: reports no outline', await window.getByText("Piece 'Piece 1' has no outline").count(), 1)
  await window.getByRole('button', { name: 'Delete Piece 1', exact: true }).click()
  evidence.check('pieces-add: deleted', await window.getByRole('heading', { name: 'Issues (0)' }).isVisible(), true)

  // pieces-delete: the row isn't selected first, so selecting it must not move the button from under the click.
  await field('Back name').evaluate((el) => el.blur())
  evidence.check('pieces-delete: nothing selected yet', await table('Edges of Back').count(), 0)
  await window.getByRole('button', { name: 'Delete Neckband', exact: true }).click()
  evidence.check('pieces-delete: an unselected piece is deleted', (await table('Pieces').getByRole('row').count()) - 1, 3)
  evidence.check('pieces-delete: its drawing is gone', await drawn('Piece Neckband').count(), 0)

  evidence.check('pieces-console: no renderer errors', rendererErrors, (errors) => errors.length === 0)
}
