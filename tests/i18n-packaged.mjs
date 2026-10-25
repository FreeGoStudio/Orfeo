import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

// Attach only to the renderer: Electron's Node debugger can interfere with
// sandboxed preload startup when Playwright relaunches a packaged executable.
assert.ok(process.env.ORFEO_TEST_EXE, 'Set ORFEO_TEST_EXE to the packaged executable')
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'orfeo-i18n-packaged-'))
const data = path.join(profile, 'Orfeo-Data')
await fs.mkdir(data)
const prefs = path.join(data, 'orfeo-prefs.json')
await fs.writeFile(prefs, JSON.stringify({ localePreference: 'en', hideDemoFolder: true, audioEngine: 'gm', samplesIntroduced: true }))

for (const [initial, next] of [['en', 'zh-CN'], ['zh-CN', 'en']]) {
  const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(process.env.ORFEO_TEST_EXE, ['--remote-debugging-port=0'], { env, windowsHide: true, stdio: 'pipe' })
  let browser
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('Timed out starting packaged app')), 30000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.stderr.on('data', chunk => {
        output += String(chunk)
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) { clearTimeout(timer); resolve(match[1]) }
      })
    })
    // Let the real startup finish before attaching DevTools to the sandbox.
    await new Promise(resolve => setTimeout(resolve, 1500))
    browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page')
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.waitForSelector('button', { timeout: 30000 })
    assert.equal(await page.locator('html').getAttribute('lang'), initial)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+,')
    await page.getByPlaceholder(initial === 'en' ? 'Search settings…' : '搜索设置…').fill('language')
    await page.getByRole('combobox', { name: initial === 'en' ? 'Language' : '语言' }).selectOption(next)
    await page.waitForFunction(locale => document.documentElement.lang === locale, next)
    assert.equal(JSON.parse(await fs.readFile(prefs, 'utf8')).localePreference, next)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: path.join(profile, `${next}.png`) })
    console.log(`Verified ${initial} → ${next}`)
    const exited = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Packaged app did not exit')), 10000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
    // Closing the window can destroy the IPC caller before its promise resolves.
    void page.evaluate(() => window.electronAPI.confirmClose()).catch(() => {})
    await exited
  } finally {
    await browser?.close()
    child.kill()
  }
}
console.log(JSON.stringify({ passed: true, evidence: profile, tests: ['packaged startup', 'live switch', 'saved preference', 'restart restores Chinese', 'switch back'] }, null, 2))
