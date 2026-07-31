require('dotenv').config()
const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// ─── Supabase client (optional — falls back to data.json if not configured) ──
let supabase = null
try {
  const { createClient } = require('@supabase/supabase-js')
  const SUPA_URL = process.env.SUPABASE_URL
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  if (SUPA_URL && SUPA_KEY) {
    supabase = createClient(SUPA_URL, SUPA_KEY)
    console.log('[supabase] client ready →', SUPA_URL)
  }
} catch(e) { console.warn('[supabase] not available:', e.message) }

const app = express()

// CORS — only allow known production origins and localhost for dev
const _PROD_ORIGINS = ['https://pheran.ng', 'https://www.pheran.ng', 'https://admin.pheran.ng']
const _EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // same-origin / curl / server-to-server
    if ([..._PROD_ORIGINS, ..._EXTRA_ORIGINS].includes(origin) ||
        /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true)
    cb(new Error('CORS: origin not allowed'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))

// Basic security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// Block direct HTTP access to server-side files exposed via express.static
app.use((req, res, next) => {
  const p = req.path.toLowerCase()
  if (
    p.includes('/mock-server/') ||
    p.includes('/node_modules/') ||
    p.includes('.env') ||
    /\/users\.json($|\?)/.test(p)
  ) return res.status(403).end()
  next()
})

// Rate-limit auth endpoints — 20 attempts per IP per 15 minutes
const _authRateMap = new Map()
app.use('/api/auth', (req, res, next) => {
  const key = req.ip || 'unknown'
  const now = Date.now()
  const rec = _authRateMap.get(key) || { n: 0, t: now }
  if (now - rec.t > 900000) { rec.n = 0; rec.t = now }
  rec.n++
  _authRateMap.set(key, rec)
  if (rec.n > 20) return res.status(429).set('Retry-After', '900').json({ ok: false, error: 'Too many requests — try again in 15 minutes' })
  next()
})

// Rewrite requests from admin.pheran.ng so they hit /admin/* routes
app.use((req, _res, next) => {
  const host = (req.headers.host || '').split(':')[0]
  if (host === 'admin.pheran.ng' && !req.path.startsWith('/admin')) {
    req.url = '/admin' + (req.url === '/' ? '/' : req.url)
  }
  next()
})

// ── Clean URL page routes ─────────────────────────────────────────────────
// Registered BEFORE static so these routes take precedence over .html file serving.
// Visitors always see clean paths like /shop, not /mvp/category.html
const _MVR = path.join(__dirname, '..')
const _PAGES = {
  '/': 'homepage.html',
  '/shop': 'category.html',
  '/product': 'product.html',
  '/cart': 'cart.html',
  '/checkout': 'checkout.html',
  '/order-confirmed': 'confirmation.html',
  '/account': 'account.html',
  '/policies': 'policies.html',
  '/support': 'support.html',
  '/gallery': 'gallery.html',
  '/custom': 'custom.html',
}
for (const [route, file] of Object.entries(_PAGES)) {
  app.get(route, (_req, res) => res.sendFile(path.join(_MVR, file)))
  if ('/' + file !== route) {
    // *.html → clean path (handles relative href links from other pages)
    app.get('/' + file, (_req, res) => res.redirect(301, route))
    // Legacy /mvp/filename.html → clean path
    app.get('/mvp/' + file, (_req, res) => res.redirect(301, route))
  }
}

// Auth verification proxy — hides the Supabase project URL from email links.
// Email links point to pheran.ng/verify?token_hash=...&type=...
// This route validates the params then redirects to Supabase internally.
const _VALID_VERIFY_TYPES = new Set(['signup','recovery','magiclink','invite','email_change','reauthentication'])
const _SUPA_URL = process.env.SUPABASE_URL || ''
app.get('/verify', (req, res) => {
  const { token_hash, type } = req.query
  if (!token_hash || !type || !_VALID_VERIFY_TYPES.has(type)) {
    return res.status(400).send('Invalid or expired verification link.')
  }
  // Redirect back to account page after confirmation
  const redirectTo = encodeURIComponent('https://pheran.ng/account')
  const target = `${_SUPA_URL}/auth/v1/verify?token_hash=${encodeURIComponent(token_hash)}&type=${encodeURIComponent(type)}&redirect_to=${redirectTo}`
  res.redirect(302, target)
})

// serve static assets — mvp/ for images/JS/CSS/SW, Pheran root for /css/ and /videos/
app.use(express.static(path.join(__dirname, '..')))
app.use(express.static(path.join(__dirname, '../..')))
// Admin — protected by ADMIN_PIN env var (default: pheran2026)
const ADMIN_PIN = process.env.ADMIN_PIN || 'pheran2026'
const ADMIN_TOKEN = crypto.createHash('sha256').update(ADMIN_PIN + 'pheran-admin-2026').digest('hex')

function setAdminCookie(req, res) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.secure
  res.cookie('admin_auth', ADMIN_TOKEN, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000, secure })
}

// requireAdminAuth — accepts session cookie (set after first Basic Auth) or Basic Auth header directly
function requireAdminAuth(req, res, next) {
  if (req.cookies?.admin_auth === ADMIN_TOKEN) return next()
  const [, b64] = (req.headers['authorization'] || '').split(' ')
  if (b64) {
    const [, pass] = Buffer.from(b64, 'base64').toString().split(':')
    if (pass === ADMIN_PIN) { setAdminCookie(req, res); return next() }
  }
  res.status(401).json({ ok: false, error: 'Unauthorized — admin access only' })
}

app.use('/admin', (req, res, next) => {
  const [, b64] = (req.headers['authorization'] || '').split(' ')
  if (b64) {
    const [, pass] = Buffer.from(b64, 'base64').toString().split(':')
    if (pass === ADMIN_PIN) { setAdminCookie(req, res); return next() }
  }
  res.set('WWW-Authenticate', 'Basic realm="PHERAN Admin"')
  res.status(401).send('Access denied')
})
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')))


// Ensure uploads directory exists and serve it
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads')
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })
app.use('/uploads', express.static(UPLOADS_DIR))

// Allowed MIME types for uploads — images and videos only
const UPLOAD_MIME = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
}

// File upload — admin only, images + videos → Supabase Storage, local disk fallback
try {
  const multer = require('multer')
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 80 * 1024 * 1024 }, // 80 MB covers product videos
    fileFilter: (_req, file, cb) => cb(null, !!UPLOAD_MIME[file.mimetype])
  })
  app.post('/api/upload', requireAdminAuth, upload.any(), async (req, res) => {
    if (!req.files || !req.files.length) return res.status(400).json({ ok: false, error: 'No files received' })
    const results = []
    for (const file of req.files) {
      const isVideo = file.mimetype.startsWith('video/')
      const ext = UPLOAD_MIME[file.mimetype] || path.extname(file.originalname).toLowerCase() || (isVideo ? '.mp4' : '.jpg')
      const prefix = isVideo ? 'videos/' : ''
      const filename = `${prefix}${isVideo ? 'vid' : 'img'}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
      if (supabase) {
        try {
          const { error } = await supabase.storage
            .from('product-images')
            .upload(filename, file.buffer, { contentType: file.mimetype, upsert: true })
          if (error) throw error
          const { data } = supabase.storage.from('product-images').getPublicUrl(filename)
          results.push({ url: data.publicUrl, type: isVideo ? 'video' : 'image', name: file.originalname })
          continue
        } catch (storageErr) {
          console.warn('[upload] Supabase Storage error:', storageErr.message, '— falling back to disk')
        }
      }
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer)
      results.push({ url: `/uploads/${filename}`, type: isVideo ? 'video' : 'image', name: file.originalname })
    }
    res.json({ ok: true, results, paths: results.map(r => r.url) })
  })
} catch (e) {
  app.post('/api/upload', (_req, res) => {
    res.status(501).json({ ok: false, error: 'Multer not installed — run npm install in mock-server/' })
  })
}

// Simple in-memory cache for product responses and metrics
const PRODUCT_CACHE = new Map() // key -> { ts, body }
const CACHE_STATS = { hits: 0, misses: 0, requests: 0, totalResponseBytes: 0 }
const CACHE_TTL = 60 * 1000

function qsKey(obj){
  const keys = Object.keys(obj||{}).sort()
  const out = {}
  keys.forEach(k=> out[k]=obj[k])
  return JSON.stringify(out)
}

const DATA_PATH = path.join(__dirname, '..', 'data.json')
let cached = null
const COO_PATH = path.join(__dirname, 'cooccurrence.json')
let cooc = null

function saveProducts(products){
  const payload = { products }
  fs.writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2), 'utf8')
  cached = products
  PRODUCT_CACHE.clear()
  // Mirror write to Supabase when configured
  if(supabase){
    const rows = products.map(p=>{ const{oldPrice,...rest}=p; return{...rest,old_price:oldPrice??null} })
    supabase.from('products').upsert(rows).then(({error})=>{
      if(error) console.warn('[supabase] write error:', error.message)
    })
  }
}
function loadCooc(){
  if(cooc) return cooc
  try{ cooc = JSON.parse(fs.readFileSync(COO_PATH,'utf8')||'{}') }catch(e){ cooc = {} }
  return cooc
}
function loadData(){
  if(cached) return cached
  const raw = fs.readFileSync(DATA_PATH, 'utf8')
  const js = JSON.parse(raw)
  cached = js.products || []
  return cached
}
async function ensureStorageBucket(){
  if(!supabase) return
  try{
    await supabase.storage.createBucket('product-images',{public:true})
    console.log('[storage] product-images bucket ready')
  }catch(e){
    if(!String(e?.message||e).includes('already exists')) console.warn('[storage] bucket setup failed:',e?.message||e)
  }
}
async function syncFromSupabase(){
  if(!supabase) return
  try{
    const { data, error } = await supabase.from('products').select('*')
    if(error){ console.warn('[supabase] read error:', error.message); return }
    if(!data?.length){ console.log('[supabase] products table empty — using data.json'); return }
    cached = data.map(p=>({
      ...p,
      oldPrice: p.old_price ?? undefined,
      images: toArr(p.images),
      sizes:  toArr(p.sizes),
      colors: toArr(p.colors),
    }))
    PRODUCT_CACHE.clear()
    console.log(`[supabase] loaded ${cached.length} products`)
  }catch(e){ console.warn('[supabase] sync failed:', e.message) }
}

function toArr(v){ return Array.isArray(v)?v:(typeof v==='string'?JSON.parse(v||'[]'):[]) }

function computeFacets(list){
  const sizes = {}
  const colors = {}
  const fabrics = {}
  list.forEach(p=>{
    toArr(p.sizes).forEach(s=> sizes[s] = (sizes[s]||0)+1)
    toArr(p.colors).forEach(c=> colors[c] = (colors[c]||0)+1)
    if(p.fabric) fabrics[p.fabric] = (fabrics[p.fabric]||0)+1
  })
  return { sizes, colors, fabrics }
}

function applyFilters(list, params){
  let out = list.slice()
  if(params.min) out = out.filter(p=> p.price >= Number(params.min))
  if(params.max) out = out.filter(p=> p.price <= Number(params.max))
  if(params.category || params.cat){
    const cats = (params.category || params.cat).split(',')
    out = out.filter(p=> cats.includes(p.category))
  }
  if(params.size){ const sizes = params.size.split(','); out = out.filter(p=> toArr(p.sizes).some(s=> sizes.includes(s))) }
  if(params.color){ const cols = params.color.split(','); out = out.filter(p=> toArr(p.colors).some(c=> cols.includes(c))) }
  if(params.fabric){ const fac = params.fabric.split(','); out = out.filter(p=> fac.includes(p.fabric)) }
  return out
}

function sortList(list, sort){
  const out = list.slice()
  if(!sort || sort==='popular') return out
  if(sort==='price_asc') return out.sort((a,b)=> a.price - b.price)
  if(sort==='price_desc') return out.sort((a,b)=> b.price - a.price)
  if(sort==='rating_desc') return out.sort((a,b)=> (b.rating||0) - (a.rating||0))
  return out
}

// cursor helpers
function encodeCursor(idx){ return Buffer.from(String(idx)).toString('base64') }
function decodeCursor(cur){ try{ return parseInt(Buffer.from(cur,'base64').toString('utf8'),10) }catch(e){ return 0 } }

app.get('/api/products', (req, res)=>{
  CACHE_STATS.requests += 1
  const key = qsKey(req.query)
  const now = Date.now()
  const cachedEntry = PRODUCT_CACHE.get(key)
  if(cachedEntry && (now - cachedEntry.ts) < CACHE_TTL){
    CACHE_STATS.hits += 1
    // return cached body (string)
    res.setHeader('x-cache','HIT')
    res.setHeader('content-type','application/json')
    return res.send(cachedEntry.body)
  }
  CACHE_STATS.misses += 1
  const all = loadData()
  const params = req.query || {}
  // initial filtering for facets counts
  const filtered = applyFilters(all, params)
  const facets = computeFacets(filtered)

  // apply sorting
  const sorted = sortList(filtered, params.sort)

  // when no results, provide recommendations using simple similarity scoring
  let recommendations = null
  if((sorted||[]).length === 0){
    // build candidate list from full catalog
    const candidates = all.slice()
    const paramsSizes = params.size ? params.size.split(',') : []
    const paramsColors = params.color ? params.color.split(',') : []
    const paramsFabrics = params.fabric ? params.fabric.split(',') : []
    const paramsCat = params.cat || params.category || null

    // score each candidate by overlap with requested attributes + rating
    const scored = candidates.map(p=>{
      let score = 0
      if(paramsSizes.length) score += (p.sizes||[]).filter(s=> paramsSizes.includes(s)).length * 2
      if(paramsColors.length) score += (p.colors||[]).filter(c=> paramsColors.includes(c)).length * 1
      if(paramsFabrics.length && paramsFabrics.includes(p.fabric)) score += 3
      if(paramsCat && p.category && p.category === paramsCat) score += 2
      // fall back to popularity via rating
      score += (p.rating||0) * 0.5
      return { p, score }
    })
    // boost by co-occurrence popularity
    const co = loadCooc()
    scored.forEach(s=>{
      const id = s.p.id
      const boost = (co[id]||0)
      s.score += boost * 0.1
    })
    scored.sort((a,b)=> b.score - a.score)
    recommendations = scored.slice(0,6).map(s=>s.p)
    // if no clear matches, fall back to top-rated
    if(!recommendations.length) recommendations = sortList(all, 'rating_desc').slice(0,6)
  }

  // pagination: support cursor or page
  const perPage = Number(params.perPage) || 12
  let page = Number(params.page) || 1
  if(params.cursor){
    const start = decodeCursor(params.cursor) || 0
    const slice = sorted.slice(start, start + perPage)
    const next = (start + perPage) < sorted.length ? encodeCursor(start + perPage) : null
    return res.json({ products: slice, facets, total: sorted.length, cursor: params.cursor, nextCursor: next })
  }

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  page = Math.min(Math.max(1, page), totalPages)
  const start = (page-1)*perPage
  const slice = sorted.slice(start, start+perPage)
  const resp = { products: slice, facets, total, page, perPage }
  if(recommendations) resp.recommendations = recommendations
  const bodyStr = JSON.stringify(resp)
  try{ PRODUCT_CACHE.set(key, { ts: Date.now(), body: bodyStr }) }catch(e){}
  CACHE_STATS.totalResponseBytes += bodyStr.length
  res.setHeader('x-cache','MISS')
  res.json(resp)
})

app.post('/api/products/admin', requireAdminAuth, (req, res)=>{
  try{
    const body = req.body || {}
    const products = loadData()
    const existingIndex = products.findIndex(p => p.id === body.id)
    const product = {
      ...body,
      id: body.id || `product-${Date.now()}`,
      title: body.title || 'Untitled Product',
      category: body.category || 'General',
      price: Number(body.price || 0),
      oldPrice: Number(body.oldPrice || body.price || 0),
      rating: Number(body.rating || 4.5),
      availability: body.availability || 'In Stock',
      sizes: Array.isArray(body.sizes) ? body.sizes : String(body.sizes || '').split(',').map(v=>v.trim()).filter(Boolean),
      colors: Array.isArray(body.colors) ? body.colors : String(body.colors || '').split(',').map(v=>v.trim()).filter(Boolean),
      fabric: body.fabric || 'Unknown',
      images: Array.isArray(body.images) ? body.images : String(body.images || '').split(/\n|,/).map(v=>v.trim()).filter(Boolean),
      description: body.description || '',
      count: Number(body.count || 1)
    }
    if(existingIndex >= 0) {
      products[existingIndex] = product
    } else {
      products.push(product)
    }
    saveProducts(products)
    res.json({ ok:true, message: existingIndex >= 0 ? 'Product updated' : 'Product created', product })
  } catch(e){
    res.status(500).json({ ok:false, error: String(e) })
  }
})

app.delete('/api/products/admin', requireAdminAuth, (req, res)=>{
  try{
    const { id } = req.body || {}
    if(!id) return res.status(400).json({ ok:false, error:'missing id' })
    const products = loadData().filter(p => p.id !== id)
    saveProducts(products)
    res.json({ ok:true, message:'Product deleted' })
  } catch(e){
    res.status(500).json({ ok:false, error: String(e) })
  }
})

// cache metrics endpoints
app.get('/api/cache-metrics', requireAdminAuth, (_req,res)=>{
  try{
    const keys = []
    for(const [k,v] of PRODUCT_CACHE.entries()){
      keys.push({ key: k, ts: v.ts, size: v.body.length })
      if(keys.length >= 200) break
    }
    res.json({ ok:true, stats: CACHE_STATS, entries: keys, cacheSize: PRODUCT_CACHE.size })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

app.post('/api/cache/clear', requireAdminAuth, (_req,res)=>{
  try{ PRODUCT_CACHE.clear(); CACHE_STATS.hits = CACHE_STATS.misses = CACHE_STATS.requests = CACHE_STATS.totalResponseBytes = 0; res.json({ ok:true }) }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

app.post('/api/cache/prune', requireAdminAuth, (req,res)=>{
  try{
    const maxEntries = Number(req.body.maxEntries) || 200
    const maxAgeMs = Number(req.body.maxAgeMs) || CACHE_TTL
    const now = Date.now()
    // remove by age
    for(const [k,v] of PRODUCT_CACHE.entries()){
      if((now - v.ts) > maxAgeMs) PRODUCT_CACHE.delete(k)
    }
    // enforce max entries
    if(PRODUCT_CACHE.size > maxEntries){
      const arr = Array.from(PRODUCT_CACHE.entries()).map(([k,v])=>({k,ts:v.ts})).sort((a,b)=>a.ts-b.ts)
      const toRemove = arr.slice(0, PRODUCT_CACHE.size - maxEntries)
      toRemove.forEach(r=> PRODUCT_CACHE.delete(r.k))
    }
    res.json({ ok:true, cacheSize: PRODUCT_CACHE.size })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

// session logging endpoint for collaborative recommendations
app.post('/api/session', (req,res)=>{
  const body = req.body || {}
  const ids = Array.isArray(body.products) ? body.products : []
  const events = Array.isArray(body.events) ? body.events : []
  const userId = body.userId || null
  const ts = body.ts || Date.now()
  if(!ids.length && !events.length) return res.status(400).json({error:'no products or events'})
  const co = loadCooc()
  // increment counts for simple products array
  ids.forEach(id=>{ co[id] = (co[id]||0) + 1 })
  // process events: increment per product and append to session log
  if(events.length){
    events.forEach(ev=>{ const id = ev.id; if(!id) return; co[id] = (co[id]||0) + 1 })
    // append events to session_events.json for analysis
    try{
      const pathS = path.join(__dirname, 'session_events.json')
      const existing = fs.existsSync(pathS) ? JSON.parse(fs.readFileSync(pathS,'utf8')||'[]') : []
      existing.push({ userId, ts, events })
      fs.writeFileSync(pathS, JSON.stringify(existing.slice(-1000), null, 2), 'utf8') // keep last 1000
    }catch(e){ /* ignore */ }
  }
  // write back co-occurrence counts
  try{ fs.writeFileSync(COO_PATH, JSON.stringify(co,null,2),'utf8') }catch(e){ /* ignore */ }
  res.json({ ok:true })
})

// admin endpoint to read session events (recent)
app.get('/api/session-events', requireAdminAuth, (_req,res)=>{
  try{
    const pathS = path.join(__dirname, 'session_events.json')
    const existing = fs.existsSync(pathS) ? JSON.parse(fs.readFileSync(pathS,'utf8')||'[]') : []
    res.json({ ok:true, events: existing })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

// admin endpoint to read co-occurrence counts
app.get('/api/cooccurrence', requireAdminAuth, (_req,res)=>{
  try{
    const co = loadCooc()
    res.json({ ok:true, co })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

// Full-text search endpoint
app.get('/api/search', (req,res)=>{
  try{
    const q = String(req.query.q || '').trim().toLowerCase()
    if(!q) return res.status(400).json({ ok:false, error:'query required' })
    const all = loadData()
    const terms = q.split(/\s+/).filter(Boolean)
    const scored = all.map(p=>{
      let score = 0
      const fields = [
        (p.title||'').toLowerCase(),
        (p.category||'').toLowerCase(),
        (p.fabric||'').toLowerCase(),
        (p.description||'').toLowerCase(),
        ...(p.colors||[]).map(c=>c.toLowerCase()),
      ]
      terms.forEach(term=>{
        fields.forEach((f,fi)=>{
          if(f.includes(term)){
            // weight: title match highest (idx 0), then category (1), fabric (2), desc (3), colors (4+)
            score += [10, 6, 5, 3, 2][fi] || 2
            if(f.startsWith(term)) score += 3
          }
        })
      })
      return { p, score }
    }).filter(s=>s.score>0).sort((a,b)=>b.score-a.score)
    const limit = Math.min(Number(req.query.limit)||20, 50)
    const results = scored.slice(0,limit).map(s=>s.p)
    res.json({ ok:true, query:q, total:scored.length, results })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

// In-memory mock cart store (keyed by userId)
const CART_STORE = new Map()

app.get('/api/cart', (req,res)=>{
  try{
    const userId = req.query.userId || 'anonymous'
    const cart = CART_STORE.get(userId) || []
    const subtotal = cart.reduce((s,i)=>s+(i.price*i.qty),0)
    res.json({ ok:true, cart, subtotal, count: cart.reduce((s,i)=>s+i.qty,0) })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

app.post('/api/cart', (req,res)=>{
  try{
    const { userId='anonymous', productId, size, color, qty=1, price, title } = req.body||{}
    if(!productId) return res.status(400).json({ ok:false, error:'productId required' })
    const cart = CART_STORE.get(userId) || []
    const key = `${productId}|${size||''}|${color||''}`
    const existing = cart.find(i=>i.key===key)
    if(existing){
      existing.qty += Number(qty)
    } else {
      cart.push({ key, productId, size, color, qty:Number(qty), price:Number(price)||0, title:title||productId })
    }
    CART_STORE.set(userId, cart)
    res.json({ ok:true, cart, count: cart.reduce((s,i)=>s+i.qty,0) })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

app.delete('/api/cart', (req,res)=>{
  try{
    const { userId='anonymous', key } = req.body||{}
    if(!key) return res.status(400).json({ ok:false, error:'item key required' })
    const cart = (CART_STORE.get(userId)||[]).filter(i=>i.key!==key)
    CART_STORE.set(userId, cart)
    res.json({ ok:true, cart })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

app.post('/api/cart/clear', (req,res)=>{
  try{
    const { userId='anonymous' } = req.body||{}
    CART_STORE.set(userId, [])
    res.json({ ok:true })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

// In-memory mock orders store (keyed by userId)
const ORDERS_STORE = new Map()

app.get('/api/orders', (req,res)=>{
  try{
    const userId = req.query.userId || 'anonymous'
    const orders = ORDERS_STORE.get(userId) || []
    res.json({ ok:true, orders, total: orders.length })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

app.get('/api/orders/:orderId', (req,res)=>{
  try{
    const userId = req.query.userId || 'anonymous'
    const orders = ORDERS_STORE.get(userId) || []
    const order = orders.find(o=>o.id===req.params.orderId)
    if(!order) return res.status(404).json({ ok:false, error:'Order not found' })
    res.json({ ok:true, order })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

app.post('/api/orders', (req,res)=>{
  try{
    const { userId='anonymous', items=[], shipping={}, payment={}, deliveryMethod='standard' } = req.body||{}
    if(!items.length) return res.status(400).json({ ok:false, error:'items required' })
    const subtotal = items.reduce((s,i)=>s+(Number(i.price||0)*Number(i.qty||1)),0)
    const deliveryFee = deliveryMethod==='express' ? 3500 : (subtotal>=100000 ? 0 : 1500)
    const order = {
      id: 'ORD-' + Date.now(),
      userId,
      items,
      shipping,
      payment: { method: payment.method||'card' },
      deliveryMethod,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    }
    const orders = ORDERS_STORE.get(userId) || []
    orders.unshift(order)
    ORDERS_STORE.set(userId, orders)
    // Clear server-side cart for this user
    CART_STORE.set(userId, [])
    res.status(201).json({ ok:true, order })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

app.patch('/api/orders/:orderId/status', (req,res)=>{
  try{
    const userId = req.query.userId || 'anonymous'
    const { status } = req.body||{}
    const valid = ['confirmed','processing','dispatched','delivered','cancelled']
    if(!valid.includes(status)) return res.status(400).json({ ok:false, error:'invalid status' })
    const orders = ORDERS_STORE.get(userId) || []
    const order = orders.find(o=>o.id===req.params.orderId)
    if(!order) return res.status(404).json({ ok:false, error:'Order not found' })
    order.status = status
    order.updatedAt = new Date().toISOString()
    ORDERS_STORE.set(userId, orders)
    res.json({ ok:true, order })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

// ─── Auth ─────────────────────────────────────────────────────────────────────
const COOKIE_ACCESS  = 'pheran_token'
const COOKIE_REFRESH = 'pheran_refresh'
const COOKIE_BASE    = { httpOnly:true, sameSite:'lax', path:'/' }

// cookie-parser is always needed
try{ app.use(require('cookie-parser')()) }catch(e){ console.warn('cookie-parser missing') }

if(supabase){
  // ── Supabase Auth (primary) ──────────────────────────────────────────────
  console.log('[auth] using Supabase Auth')

  function setSession(req, res, session){
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.secure
    res.cookie(COOKIE_ACCESS,  session.access_token,  {...COOKIE_BASE, secure, maxAge:(session.expires_in||3600)*1000})
    res.cookie(COOKIE_REFRESH, session.refresh_token, {...COOKIE_BASE, secure, maxAge:30*24*60*60*1000})
  }
  function clearSession(res){
    res.clearCookie(COOKIE_ACCESS,  {path:'/'})
    res.clearCookie(COOKIE_REFRESH, {path:'/'})
  }
  function fmtUser(u){
    const m = u.user_metadata||{}
    return { id:u.id, email:u.email, firstName:m.firstName||'', lastName:m.lastName||'', phone:m.phone||'' }
  }
  async function resolveUser(req, res){
    const access  = req.cookies?.[COOKIE_ACCESS]
    const refresh = req.cookies?.[COOKIE_REFRESH]
    if(access){
      const { data, error } = await supabase.auth.getUser(access)
      if(!error && data.user) return data.user
    }
    // access token expired — try refresh
    if(refresh){
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refresh })
      if(!error && data.session){ setSession(req, res, data.session); return data.user }
    }
    return null
  }

  app.post('/api/auth/register', async(req,res)=>{
    try{
      const{firstName,lastName='',email,phone='',password}=req.body||{}
      if(!firstName||!email||!password) return res.status(400).json({ok:false,error:'firstName, email and password are required'})
      if(password.length<8) return res.status(400).json({ok:false,error:'Password must be at least 8 characters'})
      const{data,error}=await supabase.auth.signUp({ email, password, options:{data:{firstName,lastName,phone}} })
      if(error) return res.status(400).json({ok:false,error:error.message})
      // Supabase may require email verification before issuing a session
      const needsVerification = !data.session
      if(!needsVerification) setSession(req, res, data.session)
      res.status(201).json({
        ok:true,
        requiresVerification: needsVerification,
        message: needsVerification ? 'Check your email to verify your account before signing in.' : undefined,
        user: fmtUser(data.user)
      })
    }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
  })

  app.post('/api/auth/login', async(req,res)=>{
    try{
      const{email,password}=req.body||{}
      if(!email||!password) return res.status(400).json({ok:false,error:'Email and password are required'})
      const{data,error}=await supabase.auth.signInWithPassword({email,password})
      if(error) return res.status(401).json({ok:false,error:error.message})
      setSession(req, res, data.session)
      res.json({ok:true, user:fmtUser(data.user)})
    }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
  })

  app.get('/api/auth/me', async(req,res)=>{
    try{
      const user = await resolveUser(req,res)
      if(!user) return res.status(401).json({ok:false,error:'Not authenticated'})
      res.json({ok:true, user:fmtUser(user)})
    }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
  })

  app.post('/api/auth/logout', async(req,res)=>{
    const access = req.cookies?.[COOKIE_ACCESS]
    if(access){ try{ await supabase.auth.admin.signOut(access,'local') }catch(e){} }
    clearSession(res)
    res.json({ok:true})
  })

  app.patch('/api/auth/profile', async(req,res)=>{
    try{
      const user = await resolveUser(req,res)
      if(!user) return res.status(401).json({ok:false,error:'Not authenticated'})
      const{firstName,lastName,phone}=req.body||{}
      const meta={...user.user_metadata}
      if(firstName!==undefined) meta.firstName=firstName
      if(lastName!==undefined)  meta.lastName=lastName
      if(phone!==undefined)     meta.phone=phone
      const{data,error}=await supabase.auth.admin.updateUserById(user.id,{user_metadata:meta})
      if(error) return res.status(500).json({ok:false,error:error.message})
      res.json({ok:true, user:fmtUser(data.user)})
    }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
  })

} else {
  // ── Fallback: bcrypt + users.json ────────────────────────────────────────
  console.log('[auth] Supabase not configured — using local users.json')
  const USERS_PATH = path.join(__dirname,'..','users.json')
  const JWT_SECRET = process.env.JWT_SECRET || 'pheran-dev-secret-change-in-production'
  function loadUsers(){ try{ return JSON.parse(fs.readFileSync(USERS_PATH,'utf8')||'[]') }catch(e){ return [] } }
  function saveUsersList(u){ fs.writeFileSync(USERS_PATH,JSON.stringify(u,null,2),'utf8') }

  try{
    const bcrypt=require('bcryptjs'), jwt=require('jsonwebtoken')
    const sign=(u)=>jwt.sign({id:u.id,email:u.email},JWT_SECRET,{expiresIn:'30d'})
    const verify=(t)=>{ try{ return jwt.verify(t,JWT_SECRET) }catch(e){ return null } }
    const co={...COOKIE_BASE, maxAge:30*24*60*60*1000}
    const safe=(u)=>{ const{passwordHash,...r}=u; return r }

    app.post('/api/auth/register', async(req,res)=>{
      try{
        const{firstName,lastName='',email,phone='',password}=req.body||{}
        if(!firstName||!email||!password) return res.status(400).json({ok:false,error:'firstName, email and password are required'})
        if(password.length<8) return res.status(400).json({ok:false,error:'Password must be at least 8 characters'})
        const users=loadUsers()
        if(users.find(u=>u.email===email)) return res.status(409).json({ok:false,error:'An account with that email already exists'})
        const user={id:'usr_'+Date.now(),firstName,lastName,email,phone,passwordHash:await bcrypt.hash(password,12),createdAt:new Date().toISOString()}
        saveUsersList([...users,user])
        res.cookie(COOKIE_ACCESS,sign(user),co)
        res.status(201).json({ok:true,user:safe(user)})
      }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
    })
    app.post('/api/auth/login', async(req,res)=>{
      try{
        const{email,password}=req.body||{}
        if(!email||!password) return res.status(400).json({ok:false,error:'Email and password are required'})
        const user=loadUsers().find(u=>u.email===email)
        if(!user) return res.status(401).json({ok:false,error:'No account found with that email'})
        if(!(await bcrypt.compare(password,user.passwordHash))) return res.status(401).json({ok:false,error:'Incorrect password'})
        res.cookie(COOKIE_ACCESS,sign(user),co)
        res.json({ok:true,user:safe(user)})
      }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
    })
    app.get('/api/auth/me',(req,res)=>{
      try{
        const p=verify(req.cookies?.[COOKIE_ACCESS])
        if(!p) return res.status(401).json({ok:false,error:'Not authenticated'})
        const user=loadUsers().find(u=>u.id===p.id)
        if(!user) return res.status(401).json({ok:false,error:'Account not found'})
        res.json({ok:true,user:safe(user)})
      }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
    })
    app.post('/api/auth/logout',(_req,res)=>{ res.clearCookie(COOKIE_ACCESS,{path:'/'}); res.json({ok:true}) })
    app.patch('/api/auth/profile',(req,res)=>{
      try{
        const p=verify(req.cookies?.[COOKIE_ACCESS])
        if(!p) return res.status(401).json({ok:false,error:'Not authenticated'})
        const users=loadUsers(), idx=users.findIndex(u=>u.id===p.id)
        if(idx<0) return res.status(404).json({ok:false,error:'User not found'})
        ;['firstName','lastName','phone'].forEach(k=>{ if(req.body[k]!==undefined) users[idx][k]=req.body[k] })
        saveUsersList(users)
        res.json({ok:true,user:safe(users[idx])})
      }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
    })
  }catch(e){
    const err=(_,res)=>res.status(501).json({ok:false,error:'Auth unavailable'})
    ;['/api/auth/register','/api/auth/login','/api/auth/logout'].forEach(r=>app.post(r,err))
    app.get('/api/auth/me',err); app.patch('/api/auth/profile',err)
  }
}

// Health check
app.get('/api/health', (req,res)=>{
  try{
    const products = loadData()
    res.json({ ok:true, uptime: process.uptime(), products: products.length, cacheSize: PRODUCT_CACHE.size, ts: Date.now() })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

const PORT = process.env.PORT || 4000
Promise.all([syncFromSupabase(), ensureStorageBucket()]).then(()=>{
  app.listen(PORT, ()=> console.log('PHERAN mock server running on port', PORT))
})
