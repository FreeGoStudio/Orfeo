#!/usr/bin/env node
// ── Sends one Orfeo package to the Microsoft Store ─────────────────────────
//
// Used by .github/workflows/store.yml (Actions → Microsoft Store), after the
// release is out on GitHub. Talks to the Partner Center submission API
// directly: starts a new submission from the published one (same listing,
// screenshots, price), puts the new package in place of the old ones, uploads
// it, and sends it for certification — or, with --draft, leaves it for you to
// check and submit in Partner Center.
//
// Usage: node scripts/store-submit.mjs <path/to/Orfeo-X.Y.Z.appx> [--draft]
// Env:   AZURE_AD_TENANT_ID, AZURE_AD_APPLICATION_CLIENT_ID,
//        AZURE_AD_APPLICATION_SECRET, MS_STORE_PRODUCT_ID
// Writes a short report to $GITHUB_STEP_SUMMARY when it is set.
import { appendFileSync, readFileSync, statSync } from 'fs'
import { execFileSync } from 'child_process'
import { basename, dirname, join } from 'path'

const [pkg, ...flags] = process.argv.slice(2)
const draft = flags.includes('--draft')
const env = (k) => process.env[k] || fail(`${k} is not set — see docs/CONTRIBUTING.md → Microsoft Store.`)
const TENANT = env('AZURE_AD_TENANT_ID')
const CLIENT = env('AZURE_AD_APPLICATION_CLIENT_ID')
const SECRET = env('AZURE_AD_APPLICATION_SECRET')
const APP = env('MS_STORE_PRODUCT_ID')
const API = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${APP}`
if (!pkg) fail('Usage: node scripts/store-submit.mjs <package.appx> [--draft]')

function summary(...lines) {
  console.log(lines.join('\n'))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n\n')
}
function fail(msg) {
  summary('### Microsoft Store: not sent', msg)
  process.exit(1)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Sign in (the Entra app that Partner Center knows) ───────────────────────
const tokenRes = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/token`, {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT, client_secret: SECRET, resource: 'https://manage.devcenter.microsoft.com' }),
})
const token = (await tokenRes.json()).access_token
if (!token) fail('Signing in to Partner Center failed: check the AZURE_AD_* secrets (the client secret may have expired).')

async function call(method, path, body) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? (method === 'POST' ? '' : undefined) : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = new Error(`${method} ${path}: HTTP ${res.status} ${data?.message ?? data?.code ?? text.slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  return data
}

// ── An update already open? ─────────────────────────────────────────────────
const app = await call('GET', '')
const pending = app.pendingApplicationSubmission
if (pending?.id) {
  const { status } = await call('GET', `/submissions/${pending.id}/status`)
  if (['PendingCommit', 'CommitFailed'].includes(status)) {
    // A draft: replace it if it was made through this API; one started in
    // Partner Center can only be finished or deleted there
    try {
      await call('DELETE', `/submissions/${pending.id}`)
      console.log(`Deleted the open draft ${pending.id} to start a fresh one.`)
    } catch (e) {
      fail(
        'An update you started in Partner Center is still open (Apps and games → Orfeo).',
        'Submit it or delete it there, then run this again.',
      )
    }
  } else {
    fail(
      `The previous update is still with Microsoft (status: ${status}).`,
      'Only one update can be in progress at a time: run this again once Partner Center shows it as published.',
    )
  }
}

// ── New submission from the published one, with the new package ───────────
const name = basename(pkg)
const sub = await call('POST', '/submissions')
console.log(`New submission ${sub.id}`)
sub.applicationPackages = [
  // the older packages go: the new one covers every PC they did
  ...sub.applicationPackages.map((p) => ({ ...p, fileStatus: 'PendingDelete' })),
  { fileName: name, fileStatus: 'PendingUpload' },
]
const updated = await call('PUT', `/submissions/${sub.id}`, sub)

// The package travels zipped (stored, it is already compressed)
const zip = join(dirname(pkg), 'store-upload.zip')
execFileSync('zip', ['-0', '-j', '-q', zip, pkg])
const size = statSync(zip).size
console.log(`Uploading ${name} (${(size / 1048576).toFixed(0)} MB)…`)
const up = await fetch(updated.fileUploadUrl, {
  method: 'PUT',
  headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-version': '2020-04-08', 'Content-Length': String(size) },
  body: readFileSync(zip),
})
if (!up.ok) fail(`Uploading the package failed: HTTP ${up.status} ${(await up.text()).slice(0, 300)}`)

if (draft) {
  summary('### Microsoft Store: draft ready', `${name} is uploaded. Check it in Partner Center (Apps and games → Orfeo) and press **Submit for certification**.`)
  process.exit(0)
}

// ── Send it for certification, and wait for Microsoft to accept the package ─
await call('POST', `/submissions/${sub.id}/commit`)
for (let i = 0; i < 80; i++) {
  await sleep(15000)
  const s = await call('GET', `/submissions/${sub.id}/status`)
  if (s.status === 'CommitStarted') continue
  if (s.status === 'CommitFailed') {
    const why = (s.statusDetails?.errors ?? []).map((e) => `- ${e.details ?? e.code}`).join('\n')
    fail(`Microsoft refused the package:\n${why || '(no details given)'}`)
  }
  summary('### Microsoft Store: submitted', `${name} is accepted and in certification (status: ${s.status}). That takes a few hours to 3 business days; Store users then get the update automatically.`)
  process.exit(0)
}
summary('### Microsoft Store: submitted, still checking', `${name} was sent; Microsoft is still checking the package. Follow it in Partner Center (Apps and games → Orfeo).`)
