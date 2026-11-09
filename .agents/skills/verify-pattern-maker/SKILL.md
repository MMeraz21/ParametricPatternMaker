---
name: verify-pattern-maker
description: Drive the real Parametric Pattern Maker Electron desktop app with Playwright to prove a user-facing change works, capturing screenshots, ARIA snapshots, logs and checks. Use after changing anything in src/main, src/preload or src/renderer, before calling UI work done, or when asked to verify, screenshot or smoke-test the app.
---

# Verify Parametric Pattern Maker

The app is an Electron desktop app (React renderer, typed `window.api` preload bridge). The
harness launches the **built** app (`out/`) with Playwright's Electron driver on a throwaway
user-data dir, health-checks it, runs a journey script, saves evidence, and tears down only what it
started. Unit tests (`npm test`) cover `src/core`; this skill covers what a user sees.

Feature recipes live in [`features/`](features/README.md). Read the index before driving.

## Launch

```sh
node .agents/skills/verify-pattern-maker/scripts/run.mjs doctor
```

Every run (doctor or journey) does the same launch:

1. `npm run build` (log in `build.log`). Pass `--no-build` only if `out/` is known current.
2. Creates a profile dir `$TMPDIR/ppm-verify-*` and launches the repo directory (so `package.json`
   `main` and the real app name/version apply) with `--user-data-dir=<profile>`.
3. Strips `ELECTRON_RUN_AS_NODE` from the environment. The agent shell sets it to `1`, which makes
   Electron run as plain Node and crash with `ipcMain` undefined.
4. Ready means React rendered into `#root`, not just that a window exists.

Teardown is automatic at the end of the run (see Cleanup).

## Doctor

`run.mjs doctor` launches, then checks, writes `doctor.json`, and exits 0 only if all pass:

- launched app version equals `package.json` version (proves the real app entry, not bare Electron)
- `app.getPath('userData')` is this run's throwaway profile
- `window.api.getVersion` is a function (preload bridge loaded)
- `out/main/index.js` is at least as new as everything in `src/` (stale build guard)

Run it first whenever anything looks off. If the Electron binary is missing it says so; fix with
`node node_modules/electron/install.js`.

## Drive

Write or reuse a journey module and pass it to the runner:

```sh
S=.agents/skills/verify-pattern-maker
node $S/scripts/run.mjs $S/journeys/app-shell.mjs
node $S/scripts/run.mjs path/to/journey.mjs --no-build --out /tmp/my-proof   # options
```

A journey is `export default async ({ app, window, evidence, rendererErrors, repo, packageVersion }) => {}`:

- `window`: Playwright `Page` for the app window. Prefer roles and accessible names:
  `window.getByRole('heading', { name: 'Parametric Pattern Maker' })`, `getByText`, `getByLabel`.
  Add accessible names or `aria-label`s to new UI rather than using CSS paths or coordinates.
- `app`: Playwright `ElectronApplication`. `app.evaluate(({ app, BrowserWindow }) => ...)` runs in
  the main process; use it to observe side effects (window bounds, paths), not to drive features.
- `evidence.check(name, actual, expected | predicate)`: records a check; a failure fails the run
  but later checks still run. Prefix names with the sub-feature ID from the feature file.
- `evidence.screenshot(page, name)`, `evidence.aria(page, name)`, `evidence.json(name, data)`.
- `rendererErrors`: console errors and uncaught exceptions from the renderer so far.

Existing journeys are in `journeys/`, one per feature file. Add a new journey when you add a
feature file.

## Evidence

Each run writes `verification-artifacts/<timestamp>-<journey>/` at the repo root (gitignored):
`result.json` (status and every check), `doctor.json`, `build.log`, `main.log` (main process
stdout/stderr), `renderer-console.log`, plus the journey's screenshots and `*.aria.yml`. A failed
run also saves `failure.png`. Exit code is 0 only when every check passed.

Proof standards:

- Drive the path a user takes (click, type, menu). Never call internal setters or seed state
  through `app.evaluate` to make a journey pass.
- Capture the action and the resulting state: check before and after, plus a screenshot or ARIA
  snapshot of the result.
- Verify side effects, not just pixels: once file I/O exists, read the written file back from
  disk; once sync exists, read the stored record from a second view.
- Report the run directory and the `result.json` status. A journey that skipped an entry point
  listed in its feature file is not proof of that entry point.

## Cleanup

Automatic in the runner's `finally`: it closes the Electron app it launched, SIGKILLs that PID
only if it is still alive, and deletes its profile dir (`--keep-profile` keeps it and records the
path in `result.json`). It never kills by process name. Evidence directories are never deleted by
cleanup; remove old ones by hand from `verification-artifacts/` if they pile up.

To check for strays after an interrupted run, find the PID in that run's `doctor.json` and kill
only that PID. Leftover profiles are `$TMPDIR/ppm-verify-*`.

## Isolation

Each run uses its own profile and launches from `out/`, with no dev server or port, so it can run
while the user has `npm run dev` open, and two runs can go side by side. `npm run build` rewrites
`out/`, so don't start a build while another run is launching; use `--no-build` for the second.
The app window appears on screen while a run is in progress and may take focus briefly. The runner makes the window
ignore the real mouse (`setIgnoreMouseEvents`), which makes interference from your cursor much less likely.
