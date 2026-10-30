// Journey for features/editor-panels.md. Run with:
//   node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/editor-panels.mjs

export default async function editorPanels({ window, evidence, rendererErrors }) {
  const tab = (name) => window.getByRole('tab', { name })
  const field = (label) => window.getByLabel(label, { exact: true })
  const marker = (name) => window.getByRole('button', { name: `Point ${name}`, exact: true })
  const centre = async (name) => {
    const box = await marker(name).locator('circle').boundingBox()
    return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const rowOf = (label) => window.locator('tr', { has: field(label) })
  const commit = async (label, value) => {
    await field(label).fill(value)
    await field(label).press('Enter')
  }

  // panels-tabs
  await marker('HPS').waitFor()
  evidence.check('panels-tabs: three tabs', (await window.getByRole('tab').allTextContents()).join(' | '), 'Measurements | Variables | Points')
  evidence.check('panels-tabs: measurements first', await tab('Measurements').getAttribute('aria-selected'), 'true')
  const headers = await window.getByRole('table', { name: 'Measurements (cm)' }).getByRole('columnheader').allTextContents()
  evidence.check('panels-tabs: a column per size', headers.slice(0, 6).join(' | '), 'Name | S | M | L | XL | XXL')
  await evidence.screenshot(window, 'panels-measurements')
  await evidence.aria(window, 'panels-measurements')

  // panels-measure
  const underarmBefore = await centre('Underarm')
  await commit('chest M', '104')
  evidence.check('panels-measure: canvas redraws (Underarm moves right)', (await centre('Underarm')).x > underarmBefore.x + 2, true)
  await commit('chest M', 'wide')
  evidence.check('panels-measure: rejects a non-number', await window.getByRole('alert').textContent(), "'wide' is not a number")
  await field('chest M').press('Escape')
  evidence.check('panels-measure: Escape restores the value', await field('chest M').inputValue(), '104')

  // panels-variable
  await tab('Variables').click()
  evidence.check('panels-variable: body_width follows the new chest', await field('body_width value').textContent(), '28.5')
  await commit('chest_ease formula', '12cm')
  evidence.check('panels-variable: body_width recomputed (formula with a unit)', await field('body_width value').textContent(), '29')

  // panels-units
  const units = window.getByLabel('Units')
  await units.selectOption('in')
  evidence.check('panels-units: values shown in inches', await field('body_width value').textContent(), '11.42')
  await tab('Measurements').click()
  evidence.check('panels-units: table in inches', await window.getByRole('table', { name: 'Measurements (in)' }).count(), 1)
  evidence.check('panels-units: chest M in inches', await field('chest M').inputValue(), '40.94')
  const underarmInches = await centre('Underarm')
  await commit('chest M', '42')
  evidence.check('panels-units: typed inches redraw the pattern', (await centre('Underarm')).x > underarmInches.x + 2, true)
  await commit('chest M', '40.94')
  await units.selectOption('cm')
  evidence.check('panels-units: back to cm', await field('chest M').inputValue(), '104')
  await evidence.screenshot(window, 'panels-units')

  // panels-rename
  await tab('Measurements').click()
  await commit('neck name', 'neck_circ')
  evidence.check('panels-rename: renamed row', await field('neck_circ name').inputValue(), 'neck_circ')
  await commit('chest name', 'neck_circ')
  evidence.check('panels-rename: refuses a taken name', await window.getByRole('alert').textContent(), "'neck_circ' is already used by a measurement")
  await field('chest name').press('Escape')
  await tab('Variables').click()
  evidence.check('panels-rename: formulas rewritten', await field('neck_width formula').inputValue(), 'neck_circ / 6 + 5')
  evidence.check('panels-rename: no issues', await window.getByRole('heading', { name: 'Issues (0)' }).isVisible(), true)

  // panels-add
  await window.getByRole('button', { name: '+ Add variable' }).click()
  evidence.check('panels-add: new row selected', await rowOf('variable_1 name').getAttribute('aria-selected'), 'true')
  await commit('variable_1 name', 'ease')
  evidence.check('panels-add: renamed', await field('ease name').inputValue(), 'ease')

  // panels-delete
  await window.getByRole('button', { name: 'Delete chest_ease' }).click()
  const issue = window.getByRole('button', { name: "'chest_ease' is not defined" })
  evidence.check('panels-delete: dependents report the missing name', await issue.count(), 1)
  await evidence.screenshot(window, 'panels-delete-issues')
  await tab('Points').click()
  await issue.click()
  evidence.check('panels-delete: issue opens Variables', await tab('Variables').getAttribute('aria-selected'), 'true')
  evidence.check('panels-delete: dependent row selected', await rowOf('body_width name').getAttribute('aria-selected'), 'true')

  // Defining the missing name again clears the issues that depended on it.
  await commit('ease name', 'chest_ease')
  evidence.check('panels-delete: defining the name again clears issues', await window.getByRole('heading', { name: 'Issues (0)' }).isVisible(), true)

  // panels-points
  await tab('Points').click()
  await window.getByRole('button', { name: '+ Add point' }).click()
  evidence.check('panels-points: new point on the canvas', await marker('P_1').count(), 1)
  const p1Before = await centre('P_1')
  await commit('P_1 x', 'Underarm.x + 50')
  evidence.check('panels-points: moves by formula', (await centre('P_1')).x > p1Before.x + 5, true)
  await commit('P_1 name', 'Extra')
  evidence.check('panels-points: renamed on the canvas', await marker('Extra').count(), 1)
  await evidence.screenshot(window, 'panels-points')
  await window.getByRole('button', { name: 'Delete Extra' }).click()
  evidence.check('panels-points: deleted from the canvas', await marker('Extra').count(), 0)

  // panels-canvas-sync
  await tab('Measurements').click()
  await marker('Underarm').locator('circle').click()
  evidence.check('panels-canvas-sync: Points tab opens', await tab('Points').getAttribute('aria-selected'), 'true')
  evidence.check('panels-canvas-sync: row selected', await rowOf('Underarm name').getAttribute('aria-selected'), 'true')

  evidence.check('panels-console: no renderer errors', rendererErrors, (errors) => errors.length === 0)
}
