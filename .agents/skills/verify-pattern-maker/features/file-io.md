# File I/O

The File menu opens and saves a pattern as a `.json` file. New, Open…, Open Recent, Save and Save As… have the usual shortcuts
(Ctrl or Cmd with N, O, S and Shift+S). The header names the document (`Untitled` until it's saved) and adds `— Edited` while there are
unsaved edits, and so does the window title. A file that can't be opened says why under the header and changes nothing. Before Open,
New or closing the window throws away unsaved edits, the app asks Save, Don't Save or Cancel. Saving over a file another program changed
asks first.

## Sub-features

- `file-title` launch is `Untitled` and saved; an edit shows `— Edited` in the header and the title bar (the macOS edited dot).
- `file-save-as` Save on an untitled document asks where, writes LF-only JSON ending in a newline, and names the document.
- `file-save` Save on a known file writes in place with no dialog.
- `file-draft` a formula typed but not committed with Enter is what gets saved.
- `file-recents` Open Recent lists each file once, newest first; one that was renamed or deleted says so and leaves the list.
- `file-open-hazards` a damaged, newer-version or invalid file shows its reason in an alert, leaves the document as it was, and isn't listed.
- `file-unsaved-open` with unsaved edits, Open asks; Cancel keeps the edits, Don't Save opens the other file.
- `file-changed-on-disk` saving over a file changed elsewhere asks; Cancel writes nothing, Replace writes the user's version.
- `file-close` closing with unsaved edits asks; Cancel keeps the window, Save writes and the app quits.
- `file-console` produces no renderer errors.

## How to get to it (user POV)

- The native File menu: `New`, `Open…`, `Open Recent ▸` (file name, then folder; `Clear Menu`), `Save`, `Save As…`, then `Close Window` on macOS or `Exit` elsewhere.
- The header's document name has the accessible name `Document`. A file problem is an `alert` under the header with a `Dismiss` button.
- The questions are native message boxes: `Save` / `Don't Save` / `Cancel`, and `Replace` / `Save As…` / `Cancel`.
- The window's close button, Cmd+W, Alt+F4 and Cmd+Q all ask the same question.

## Driving it with run.mjs

Preconditions:

- `run.mjs doctor` passes.
- The app opens on an untitled raglan at size M, with the throwaway profile's empty recent list.

- **Run.** `node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/file-io.mjs`.
- **Edit.** On the `Variables` tab, `getByLabel('chest_ease formula', { exact: true })`, `fill('120')`, `press('Enter')`. The `Document` text becomes `Untitled — Edited`.
- **Menu.** Native menus can't be clicked by Playwright. `app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id)` runs the item's own handler. Ids: `file-new`, `file-open`, `file-save`, `file-save-as`, `file-recent-<i>`, `file-recent-clear`.
- **Dialogs.** Before each action that shows one, replace `dialog.showSaveDialog`, `showOpenDialog` or `showMessageBox` in main with `app.evaluate`. The message box stub answers by button label (`options.buttons.indexOf('Cancel')`), so platform button order doesn't matter.
- **Proof.** Read the saved file back with `node:fs`. Read recent files from the `file-recent` submenu's item labels, and the title bar from `BrowserWindow.getTitle()`.
- **Close.** `BrowserWindow.getAllWindows()[0].close()` is what the close button does. After Save, the last window closes and the app quits; wait for `app.waitForEvent('close')`.

## Gotchas

- Opening a file resets the panel to `Measurements` and the size to the first one. Click `Variables` again before reading a formula.
- `evidence.check` compares with `===`. Compare lists as joined text.
- Make a changed-on-disk test change the size or set a later modified time, or the stamp can look unchanged.
- Once the app quits, `app.evaluate` and `app.process()` throw. Teardown in `run.mjs` copes; a journey must not call them afterwards.
- Every journey that edits ends with unsaved edits. Teardown destroys the windows first, so no question can hang it.
