// Journey for features/export.md. Run with:
//   node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/export.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Where the test square sits on page A1, in mm from the page's top-left: margin 10, key inset 5, square 22 down the key. */
const INSIDE_TEST_SQUARE = { x: 20, y: 47 }

export default async function exportJourney({ app, window, evidence, rendererErrors, repo }) {
  const { PDFDocument } = createRequire(join(repo, 'package.json'))('pdf-lib')
  const folder = mkdtempSync(join(tmpdir(), 'ppm-export-'))
  const dialog = window.getByRole('dialog', { name: 'Export' })
  const footer = () => dialog.getByText(/pages of|Nothing to export/).textContent()
  /** Replaces the native save dialog for the next save, the only thing a journey can't click. */
  const answerSaveDialog = (answer) =>
    app.evaluate(({ dialog: electronDialog }, reply) => {
      electronDialog.showSaveDialog = async () => reply
    }, answer)

  try {
    // export-pdf
    await window.getByRole('button', { name: 'Point HPS', exact: true }).waitFor()
    await window.getByRole('button', { name: 'Export…' }).click()
    await dialog.waitFor()
    evidence.check('export-pdf: the shown size is ticked', await dialog.getByLabel('Size M').isChecked(), true)
    await dialog.getByLabel('Paper').selectOption('letter')
    await dialog.getByLabel('Title').fill('Raglan')
    evidence.check('export-pdf: footer counts pages', await footer(), '21 pages of Letter')
    evidence.check('export-pdf: says how to print', await dialog.getByText('Print at 100%').count(), 1)
    await evidence.aria(window, 'export-dialog')
    await evidence.screenshot(window, 'export-dialog')
    const pdfPath = join(folder, 'Raglan-M-letter.pdf')
    await answerSaveDialog({ canceled: false, filePath: pdfPath })
    await dialog.getByRole('button', { name: 'Save PDF' }).click()
    await dialog.getByRole('status').waitFor()
    evidence.check('export-pdf: says where it saved', await dialog.getByRole('status').textContent(), `Saved to ${pdfPath}`)
    const pdf = await PDFDocument.load(readFileSync(pdfPath))
    evidence.check('export-pdf: file has the planned page count', pdf.getPageCount(), 21)
    evidence.check('export-pdf: page is Letter in points', JSON.stringify(pdf.getPage(0).getSize()), JSON.stringify({ width: 612, height: 792 }))
    if (process.platform === 'darwin') {
      const run = spawnSync('swift', [join(repo, '.agents/skills/verify-pattern-maker/scripts/measure-pdf.swift'), pdfPath, '0', '600', String(INSIDE_TEST_SQUARE.x), String(INSIDE_TEST_SQUARE.y)], { encoding: 'utf8' })
      const measured = run.status === 0 ? JSON.parse(run.stdout) : { error: run.stderr || run.stdout }
      await evidence.json('export-pdf-square', measured)
      evidence.check('export-pdf: PDFKit measures the square 50 mm wide', measured.width, (mm) => Math.abs(mm - 50) <= 0.1)
      evidence.check('export-pdf: PDFKit measures the square 50 mm high', measured.height, (mm) => Math.abs(mm - 50) <= 0.1)
    } else {
      await evidence.json('export-pdf-square', { skipped: 'macOS only. The vitest scale proof in posterPdf.test.ts covers every OS.' })
    }

    // export-svg
    const svgPath = join(folder, 'Raglan-M.svg')
    await answerSaveDialog({ canceled: false, filePath: svgPath })
    await dialog.getByRole('button', { name: 'Save SVG' }).click()
    await dialog.getByText(`Saved to ${svgPath}`).waitFor()
    const svg = readFileSync(svgPath, 'utf8')
    evidence.check('export-svg: sized in mm', /<svg [^>]*width="[\d.]+mm" height="[\d.]+mm"/.test(svg), true)
    evidence.check('export-svg: one size group', (svg.match(/<g data-size=/g) ?? []).length, 1)

    // export-sizes
    await dialog.getByLabel('Size S').check()
    evidence.check('export-sizes: ticking S adds its pages', await footer(), '39 pages of Letter')
    await dialog.getByLabel('Size S').uncheck()
    await dialog.getByLabel('Size M').uncheck()
    evidence.check('export-sizes: nothing ticked, nothing to export', await footer(), 'Nothing to export. Tick a size that can be printed.')
    evidence.check('export-sizes: Save PDF disabled', await dialog.getByRole('button', { name: 'Save PDF' }).isDisabled(), true)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await window.getByRole('tab', { name: 'Variables' }).click()
    await window.getByLabel('band_width formula', { exact: true }).fill('chest > 1200 ? 0 : 60')
    await window.getByLabel('band_width formula', { exact: true }).press('Enter')
    await window.getByRole('button', { name: 'Export…' }).click()
    evidence.check('export-sizes: XXL cannot be ticked', await dialog.getByLabel('Size XXL').isDisabled(), true)
    evidence.check('export-sizes: XXL says why', await dialog.getByText("XXL can't be printed: Neckband has no outline.").count(), 1)
    await evidence.screenshot(window, 'export-refused')

    // export-cancel
    await answerSaveDialog({ canceled: true })
    await dialog.getByRole('button', { name: 'Save PDF' }).click()
    await window.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
    await dialog.getByRole('button', { name: 'Save PDF' }).waitFor()
    evidence.check('export-cancel: dialog stays open', await dialog.isVisible(), true)
    evidence.check('export-cancel: no error shown', await dialog.getByRole('alert').count(), 0)

    // export-failure
    const missing = join(folder, 'missing', 'Raglan.pdf')
    await answerSaveDialog({ canceled: false, filePath: missing })
    await dialog.getByRole('button', { name: 'Save PDF' }).click()
    await dialog.getByRole('alert').waitFor()
    evidence.check('export-failure: says the folder is gone', await dialog.getByRole('alert').textContent(), "That folder doesn't exist any more.")
    evidence.check('export-failure: dialog stays open', await dialog.isVisible(), true)
    evidence.check('export-failure: nothing written', existsSync(missing), false)
    await evidence.screenshot(window, 'export-failure')

    // export-console
    evidence.check('export-console: no renderer errors', rendererErrors.length, 0)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
