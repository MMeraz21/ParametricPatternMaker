#!/usr/bin/env node
// Launch the built Parametric Pattern Maker app under Playwright, run the doctor, optionally drive a
// journey, capture evidence, then tear down only what this run started.
//
//   run.mjs doctor                    launch, health-check, clean up
//   run.mjs <journey.mjs> [...]       launch, health-check, drive the journey, clean up
//
// Options:
//   --no-build      skip `npm run build` (only when out/ is known to match src/)
//   --out <dir>     evidence directory (default: verification-artifacts/<timestamp>-<name>/)
//   --keep-profile  keep the throwaway Electron user-data dir for inspection

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const require = createRequire(join(repo, 'package.json'))
const { _electron } = require('playwright-core')

const argv = process.argv.slice(2)
const target = argv.find((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--out')
const flag = (name) => argv.includes(name)
const option = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}

if (!target) {
  console.error('usage: run.mjs doctor | <journey.mjs> [--no-build] [--out <dir>] [--keep-profile]')
  process.exit(2)
}

const runName = target === 'doctor' ? 'doctor' : basename(target, '.mjs')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const out = resolve(option('--out') ?? join(repo, 'verification-artifacts', `${stamp}-${runName}`))
mkdirSync(out, { recursive: true })

const checks = []
const evidence = {
  dir: out,
  /** Record an observable fact. Failing checks fail the run but later checks still execute. */
  check(name, actual, expected) {
    const pass = typeof expected === 'function' ? Boolean(expected(actual)) : Object.is(actual, expected)
    checks.push({ name, pass, actual, ...(typeof expected === 'function' ? {} : { expected }) })
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`)
    return pass
  },
  async screenshot(page, name) {
    const path = join(out, `${name}.png`)
    await page.screenshot({ path })
    return path
  },
  async aria(page, name) {
    const path = join(out, `${name}.aria.yml`)
    writeFileSync(path, await page.locator('body').ariaSnapshot())
    return path
  },
  json(name, data) {
    const path = join(out, `${name}.json`)
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
    return path
  }
}

function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs)
  }
  return newest
}

const electronPath = require('electron')
const mainEntry = join(repo, 'out/main/index.js')
const packageVersion = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version

if (!existsSync(electronPath)) {
  console.error(`Electron binary missing at ${electronPath}. Run: node node_modules/electron/install.js`)
  process.exit(1)
}

if (!flag('--no-build')) {
  console.log('Building (npm run build)...')
  const build = spawnSync('npm', ['run', 'build'], { cwd: repo, encoding: 'utf8' })
  writeFileSync(join(out, 'build.log'), `${build.stdout}\n${build.stderr}`)
  if (build.status !== 0) {
    console.error(`Build failed; see ${join(out, 'build.log')}`)
    process.exit(1)
  }
}

const profile = realpathSync(mkdtempSync(join(tmpdir(), 'ppm-verify-')))
// The agent shell exports ELECTRON_RUN_AS_NODE=1, which would start Electron as plain Node.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const mainLog = createWriteStream(join(out, 'main.log'))
const rendererLog = createWriteStream(join(out, 'renderer-console.log'))
const rendererErrors = []

let app
let status = 'pass'
let error
try {
  app = await _electron.launch({
    executablePath: electronPath,
    // Launch the app directory (package.json "main"), as electron-vite does, so app name/version are real.
    args: [repo, `--user-data-dir=${profile}`],
    cwd: repo,
    env,
    timeout: 30_000
  })
  app.process().stdout?.pipe(mainLog)
  app.process().stderr?.pipe(mainLog)

  const window = await app.firstWindow()
  // The window is on screen, so the real cursor would send mouse events alongside Playwright's and
  // disturb drags. Injected input doesn't go through the OS, so it still reaches the page.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((win) => win.setIgnoreMouseEvents(true)))
  window.on('console', (msg) => {
    rendererLog.write(`[${msg.type()}] ${msg.text()}\n`)
    if (msg.type() === 'error') rendererErrors.push(msg.text())
  })
  window.on('pageerror', (err) => {
    rendererLog.write(`[pageerror] ${err.message}\n`)
    rendererErrors.push(err.message)
  })

  // Ready = React has rendered into #root, not merely that a window exists.
  await window.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, {
    timeout: 15_000
  })

  const live = await app.evaluate(({ app: electronApp }) => ({
    appVersion: electronApp.getVersion(),
    electronVersion: process.versions.electron,
    userData: electronApp.getPath('userData'),
    isPackaged: electronApp.isPackaged
  }))
  const doctor = {
    pid: app.process().pid,
    ...live,
    packageVersion,
    profile,
    windowTitle: await window.title(),
    bridge: await window.evaluate(() => typeof window.api?.getVersion),
    buildFresh: statSync(mainEntry).mtimeMs >= newestMtime(join(repo, 'src'))
  }
  evidence.json('doctor', doctor)
  evidence.check('doctor: launched app version matches package.json', doctor.appVersion, packageVersion)
  evidence.check('doctor: running on our throwaway profile', doctor.userData, (p) => realpathSync(p) === profile)
  evidence.check('doctor: preload bridge exposed', doctor.bridge, 'function')
  evidence.check('doctor: out/ is at least as new as src/', doctor.buildFresh, true)

  if (target !== 'doctor') {
    const journey = await import(pathToFileURL(resolve(target)).href)
    await journey.default({ app, window, evidence, rendererErrors, repo, packageVersion })
  }
} catch (err) {
  status = 'error'
  error = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error(error)
  const page = app?.windows()[0]
  if (page) await evidence.screenshot(page, 'failure').catch(() => {})
} finally {
  // Tear down only the instance this run launched.
  const pid = app?.process().pid
  // Every journey edits, so a window would ask about unsaved changes on close. destroy() skips that question.
  await app
    ?.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.destroy()
    })
    .catch(() => {})
  await app?.close().catch(() => {})
  if (pid) {
    try {
      process.kill(pid, 0)
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already exited.
    }
  }
  mainLog.end()
  rendererLog.end()
  if (!flag('--keep-profile')) rmSync(profile, { recursive: true, force: true })
}

if (status === 'pass' && checks.some((c) => !c.pass)) status = 'fail'
evidence.json('result', { run: runName, status, error, checks, profileKept: flag('--keep-profile') ? profile : null })
console.log(`\n${status.toUpperCase()} (${checks.filter((c) => c.pass).length}/${checks.length} checks)`)
console.log(`Evidence: ${relative(process.cwd(), out) || '.'}`)
process.exit(status === 'pass' ? 0 : 1)
