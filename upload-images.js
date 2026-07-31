// Run from project root: node upload-images.js
const fs = require('fs')
const path = require('path')
const MOCK_SERVER = path.join(__dirname, 'mvp', 'mock-server')
require(path.join(MOCK_SERVER, 'node_modules', 'dotenv')).config({ path: path.join(MOCK_SERVER, '.env') })
const { createClient } = require(path.join(MOCK_SERVER, 'node_modules', '@supabase', 'supabase-js'))

const SUPA_URL = process.env.SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
const BUCKET   = 'product-images'
const IMG_DIR  = path.join(__dirname, 'mvp')
const DATA_PATH = path.join(__dirname, 'mvp', 'data.json')

if (!SUPA_URL || !SUPA_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in mvp/mock-server/.env')
  process.exit(1)
}

const supabase = createClient(SUPA_URL, SUPA_KEY)

const IMAGE_FILES = [
  'img-grey-linen-front.jpg',
  'img-grey-linen-side.jpg',
  'img-pink-cami.jpg',
  'img-red-gown-front.jpg',
  'img-red-gown-side.jpg',
  'img-wine-pinstripe.jpg',
  'logo.jpeg',
  'owner.jpg',
]

async function run() {
  // Ensure bucket exists and is public
  try {
    await supabase.storage.createBucket(BUCKET, { public: true })
    console.log(`[bucket] Created ${BUCKET}`)
  } catch (e) {
    if (!String(e?.message || e).includes('already exists')) {
      console.warn('[bucket] createBucket error:', e?.message || e)
    } else {
      console.log(`[bucket] ${BUCKET} already exists`)
    }
  }

  const urlMap = {} // filename -> publicUrl

  for (const filename of IMAGE_FILES) {
    const filePath = path.join(IMG_DIR, filename)
    if (!fs.existsSync(filePath)) {
      console.warn(`[skip] ${filename} — not found at ${filePath}`)
      continue
    }

    const buffer = fs.readFileSync(filePath)
    const ext = path.extname(filename).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filename, buffer, { contentType: mime, upsert: true })

    if (error) {
      console.error(`[error] ${filename}:`, error.message)
      continue
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename)
    urlMap[filename] = data.publicUrl
    console.log(`[ok] ${filename} → ${data.publicUrl}`)
  }

  // Update data.json — replace bare filenames with Supabase public URLs
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))
  let changed = false
  raw.products = raw.products.map(p => {
    const newImages = (p.images || []).map(img => {
      // Only replace bare filenames (not already-absolute URLs)
      if (!img.startsWith('http') && urlMap[img]) {
        changed = true
        return urlMap[img]
      }
      return img
    })
    return { ...p, images: newImages }
  })

  if (changed) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(raw, null, 2), 'utf8')
    console.log('\n[data.json] Updated with Supabase public URLs')
  } else {
    console.log('\n[data.json] No bare filenames found to replace')
  }

  // Also upsert to Supabase products table so live DB has updated image URLs
  const rows = raw.products.map(p => {
    const { oldPrice, ...rest } = p
    return { ...rest, old_price: oldPrice ?? null }
  })
  const { error: upsertErr } = await supabase.from('products').upsert(rows)
  if (upsertErr) {
    console.error('[supabase] products upsert error:', upsertErr.message)
  } else {
    console.log('[supabase] products table updated with new image URLs')
  }

  console.log('\nDone. URL map:')
  Object.entries(urlMap).forEach(([k, v]) => console.log(`  ${k} → ${v}`))
}

run().catch(e => { console.error(e); process.exit(1) })
