// Journey for features/app-shell.md. Run with:
//   node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/app-shell.mjs

export default async function appShell({ app, window, evidence, rendererErrors, packageVersion }) {
  // shell-window: the window opens with the app's identity.
  evidence.check('shell-window: window title', await window.title(), 'Parametric Pattern Maker')
  const heading = window.getByRole('heading', { name: 'Parametric Pattern Maker', level: 1 })
  evidence.check('shell-window: heading visible', await heading.isVisible(), true)
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds())
  evidence.check('shell-window: opens at 1280x800', `${bounds?.width}x${bounds?.height}`, '1280x800')

  // shell-version: the version comes from the main process through the preload bridge.
  const version = window.getByText(`v${packageVersion}`, { exact: true })
  await version.waitFor({ timeout: 5_000 })
  evidence.check('shell-version: shows package version via bridge', await version.textContent(), `v${packageVersion}`)

  // shell-styles: Tailwind CSS is loaded (the layout centers content in a flex container).
  const layout = await window.locator('main').evaluate((el) => {
    const style = getComputedStyle(el)
    return { display: style.display, justifyContent: style.justifyContent, height: el.getBoundingClientRect().height }
  })
  evidence.check('shell-styles: main is a centered flex container', `${layout.display}/${layout.justifyContent}`, 'flex/center')
  evidence.check('shell-styles: main fills the window height', layout.height, (h) => h >= 700)

  // shell-isolation: renderer has no Node access.
  const nodeGlobals = await window.evaluate(() => ({ require: typeof globalThis.require, process: typeof globalThis.process }))
  evidence.check('shell-isolation: no require/process in renderer', `${nodeGlobals.require}/${nodeGlobals.process}`, 'undefined/undefined')

  evidence.check('shell-console: no renderer errors', rendererErrors, (errors) => errors.length === 0)

  await evidence.aria(window, 'app-shell')
  await evidence.screenshot(window, 'app-shell')
}
