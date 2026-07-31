// Run from project root: node upload-email-templates.js
const fs = require('fs')
const path = require('path')
const MOCK_SERVER = path.join(__dirname, 'mvp', 'mock-server')
require(path.join(MOCK_SERVER, 'node_modules', 'dotenv')).config({ path: path.join(MOCK_SERVER, '.env') })
const { createClient } = require(path.join(MOCK_SERVER, 'node_modules', '@supabase', 'supabase-js'))

const SUPA_URL = process.env.SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
const BUCKET = 'email-templates'
const TEMPLATES_DIR = path.join(__dirname, 'email-templates')

if (!SUPA_URL || !SUPA_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in mvp/mock-server/.env')
  process.exit(1)
}

const supabase = createClient(SUPA_URL, SUPA_KEY)

async function run() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.error('email-templates/ directory not found at', TEMPLATES_DIR)
    process.exit(1)
  }

  // Create private bucket (templates are internal — no public access needed)
  try {
    await supabase.storage.createBucket(BUCKET, { public: false })
    console.log(`[bucket] Created private bucket: ${BUCKET}`)
  } catch (e) {
    if (!String(e?.message || e).includes('already exists')) {
      console.warn('[bucket] createBucket error:', e?.message || e)
    } else {
      console.log(`[bucket] ${BUCKET} already exists`)
    }
  }

  const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.html'))
  if (!files.length) { console.warn('[skip] No .html files found'); process.exit(0) }

  let uploaded = 0
  for (const filename of files) {
    const buffer = fs.readFileSync(path.join(TEMPLATES_DIR, filename))
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filename, buffer, { contentType: 'text/html; charset=utf-8', upsert: true })
    if (error) {
      console.error(`[error] ${filename}:`, error.message)
    } else {
      console.log(`[ok] ${filename}`)
      uploaded++
    }
  }

  // Remove local folder only if all uploads succeeded
  if (uploaded === files.length) {
    fs.rmSync(TEMPLATES_DIR, { recursive: true, force: true })
    console.log(`\n[done] Deleted local email-templates/ folder (${uploaded} files uploaded)`)
  } else {
    console.warn(`\n[warn] Only ${uploaded}/${files.length} files uploaded — local folder kept`)
  }

  console.log('\nTemplates are now in Supabase Storage (private bucket: email-templates)')
  console.log('\nTo apply them in Supabase Dashboard:')
  console.log('  Authentication → Emails → select template type → paste HTML content')
  console.log('\n  confirm-signup.html    → Confirm signup')
  console.log('  reset-password.html    → Reset password')
  console.log('  magic-link.html        → Magic link')
  console.log('  invite-user.html       → Invite user')
  console.log('  change-email.html      → Change email address')
  console.log('  reauthentication.html  → Reauthentication')
  console.log('  security-notification.html → (reference for security alerts)')
}

run().catch(e => { console.error(e); process.exit(1) })
