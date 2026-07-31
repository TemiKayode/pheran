/**
 * apply-email-templates.js
 * Downloads PHERAN email templates from Supabase Storage and applies them
 * to Supabase Auth via the Management API.
 *
 * Setup (one-time):
 *   1. Get a personal access token: https://supabase.com/dashboard/account/tokens
 *   2. Add to mvp/mock-server/.env:  SUPABASE_ACCESS_TOKEN=your_token_here
 *   3. Run: node apply-email-templates.js
 */
const https = require('https')
const path  = require('path')
const MOCK_SERVER = path.join(__dirname, 'mvp', 'mock-server')
require(path.join(MOCK_SERVER, 'node_modules', 'dotenv')).config({ path: path.join(MOCK_SERVER, '.env') })
const { createClient } = require(path.join(MOCK_SERVER, 'node_modules', '@supabase', 'supabase-js'))

const SUPA_URL     = process.env.SUPABASE_URL
const SUPA_KEY     = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF  = SUPA_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]

if (!SUPA_URL || !SUPA_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in mvp/mock-server/.env')
  process.exit(1)
}
if (!ACCESS_TOKEN) {
  console.error(`
Missing SUPABASE_ACCESS_TOKEN.

Steps:
  1. Go to https://supabase.com/dashboard/account/tokens
  2. Generate a new token (name it anything, e.g. "pheran-deploy")
  3. Add to mvp/mock-server/.env:
       SUPABASE_ACCESS_TOKEN=your_token_here
  4. Re-run: node apply-email-templates.js
`)
  process.exit(1)
}

const supabase = createClient(SUPA_URL, SUPA_KEY)

// Map: storage filename → Supabase Auth config field names
// verifyType: the ?type= param used by the /verify proxy route on pheran.ng/verify
const TEMPLATE_MAP = {
  'confirm-signup.html': {
    subject:      'Confirm your PHERAN account',
    subjectField: 'mailer_subjects_confirmation',
    bodyField:    'mailer_templates_confirmation_content',
    verifyType:   'signup',
  },
  'reset-password.html': {
    subject:      'Reset your PHERAN password',
    subjectField: 'mailer_subjects_recovery',
    bodyField:    'mailer_templates_recovery_content',
    verifyType:   'recovery',
  },
  'magic-link.html': {
    subject:      'Your PHERAN sign-in link',
    subjectField: 'mailer_subjects_magic_link',
    bodyField:    'mailer_templates_magic_link_content',
    verifyType:   'magiclink',
  },
  'invite-user.html': {
    subject:      "You've been invited to PHERAN",
    subjectField: 'mailer_subjects_invite',
    bodyField:    'mailer_templates_invite_content',
    verifyType:   'invite',
  },
  'change-email.html': {
    subject:      'Confirm your new PHERAN email',
    subjectField: 'mailer_subjects_email_change',
    bodyField:    'mailer_templates_email_change_content',
    verifyType:   'email_change',
  },
  'reauthentication.html': {
    subject:      'Confirm your identity — PHERAN',
    subjectField: 'mailer_subjects_reauthentication',
    bodyField:    'mailer_templates_reauthentication_content',
    verifyType:   'reauthentication',
  },
}

// Replace {{ .ConfirmationURL }} with the pheran.ng/verify proxy URL so the
// Supabase project reference is never exposed in outgoing emails.
function proxyConfirmationUrl(html, verifyType) {
  const proxyUrl = `https://pheran.ng/verify?token_hash={{ .TokenHash }}&type=${verifyType}`
  return html.replace(/\{\{\s*\.ConfirmationURL\s*\}\}/g, proxyUrl)
}

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, res => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function run() {
  console.log(`[project] ${PROJECT_REF}`)
  const configUpdate = {}

  for (const [filename, cfg] of Object.entries(TEMPLATE_MAP)) {
    const { data, error } = await supabase.storage.from('email-templates').download(filename)
    if (error) {
      console.error(`[skip] ${filename}: ${error.message}`)
      continue
    }
    const html = proxyConfirmationUrl(await data.text(), cfg.verifyType)
    configUpdate[cfg.subjectField] = cfg.subject
    configUpdate[cfg.bodyField]    = html
    console.log(`[ok] ${filename}`)
  }

  const payload = JSON.stringify(configUpdate)
  const result = await httpsRequest(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    {
      method: 'PATCH',
      headers: {
        'Authorization':  `Bearer ${ACCESS_TOKEN}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    payload
  )

  if (result.status !== 200) {
    console.error(`[error] Management API returned ${result.status}:`, result.body)
    process.exit(1)
  }

  console.log('\n[done] All email templates applied to Supabase Auth.')
  console.log('Verify at: Authentication → Emails in your Supabase dashboard.')
}

run().catch(e => { console.error(e); process.exit(1) })
