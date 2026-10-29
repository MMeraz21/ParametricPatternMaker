# App shell

Opening the app shows one window titled `Parametric Pattern Maker` with a centered heading of the
same name and the app version (for example `v0.1.0`) underneath. The version comes from the main
process, so seeing it proves the renderer can talk to the app through its bridge.

## Sub-features

- `shell-window` opens a 1280x800 window titled and headed `Parametric Pattern Maker`.
- `shell-version` shows `v<package.json version>` under the heading.
- `shell-styles` renders with Tailwind styles: content centered in a full-height layout.
- `shell-isolation` gives the page no Node access (`require` and `process` are undefined).
- `shell-console` loads with no renderer console errors or uncaught exceptions.

## How to get to it (user POV)

- Launch the app (`npm run dev` for the user, `run.mjs` for verification). The window opens on its
  own; there are no menus or controls yet.

## Driving it with run.mjs

Preconditions:

- `run.mjs doctor` passes.

- **Open the app.** Launch it. Run `node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/app-shell.mjs`. The doctor passes and a window opens.
- **Window identity.** Read the title and heading. `window.title()` and `window.getByRole('heading', { name: 'Parametric Pattern Maker', level: 1 })`. The title is `Parametric Pattern Maker` and the heading is visible.
- **Window size.** Read the bounds. `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())`. Width and height are `1280` and `800`.
- **Version.** Wait for the version text. `window.getByText('v' + packageVersion, { exact: true }).waitFor()`. It shows `v0.1.0` (the current `package.json` version), not a placeholder.
- **Styling.** Read the layout of `main`. Computed `display` is `flex`, `justify-content` is `center`, and it fills the window height.
- **Isolation.** Read `typeof require` and `typeof process` in the page. Both are `undefined`.
- **Proof.** `evidence.aria(window, 'app-shell')` and `evidence.screenshot(window, 'app-shell')`. The ARIA snapshot reads `main > heading "Parametric Pattern Maker" [level=1]` and `paragraph: v0.1.0`; the screenshot shows both centered on a light background.

## Gotchas

- While the bridge call is pending the version reads `v…`. Wait for the exact version text, not a fixed delay.
- Launching `out/main/index.js` directly instead of the repo directory makes Electron report its own version (e.g. `45.1.0`). The runner launches the repo directory; keep it that way.
- On macOS, closing the window does not quit the app (standard Mac behavior). Don't treat a live process after closing the window as a leak; the runner's teardown closes the app itself.
- Screenshots are at the display's pixel ratio (2x on Retina), so the image is larger than 1280x800.
