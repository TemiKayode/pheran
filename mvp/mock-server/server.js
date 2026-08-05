require('dotenv').config()

// Sentry must be initialized before express (and anything else) is required,
// so its auto-instrumentation can hook into them. No-ops entirely if
// SENTRY_DSN isn't set — safe to leave unconfigured in local dev.
const Sentry = require('@sentry/node')
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || (process.env.RAILWAY_ENVIRONMENT_NAME || 'production'),
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined, // Railway sets this automatically — lets Sentry pin a new/regressed issue to the exact deploy
    tracesSampleRate: 0.1,
    // Explicit, not just the (already-private) defaults: request/response bodies carry
    // shipping addresses, phone numbers, and emails; cookies and headers carry session
    // tokens and the admin Basic-Auth credential. None of that belongs in an error report.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
    },
  })
  console.log('[sentry] error tracking enabled')
}
// Used at the handful of business-critical call sites (order writes, payment/status
// updates, product writes, uploads) that catch their own errors and would otherwise
// never reach Sentry.setupExpressErrorHandler below. No-ops if SENTRY_DSN isn't set.
function reportError(e, extra) {
  if (!process.env.SENTRY_DSN) return
  Sentry.captureException(e instanceof Error ? e : new Error(String(e)), extra ? { extra } : undefined)
}

const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Constant-time string comparison — prevents timing attacks on token/pin comparisons
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ba = Buffer.from(a), bb = Buffer.from(b)
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, Buffer.alloc(ba.length))
    return false
  }
  return crypto.timingSafeEqual(ba, bb)
}

// Safe HTML escaper for server-generated email bodies
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// Send order confirmation email via Resend (https://resend.com).
// Silently skips if RESEND_API_KEY is not configured — no order is blocked.
async function sendOrderEmail(order) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  const shipping = order.shipping || {}
  const email = order.user_email || order.userEmail || shipping.email
  if (!email) return
  const firstName = escHtml(shipping.firstName || 'Customer')
  const bankName    = process.env.PHERAN_BANK_NAME       || 'Zenith Bank'
  const accountNum  = process.env.PHERAN_ACCOUNT_NUMBER  || '—'
  const accountName = process.env.PHERAN_ACCOUNT_NAME    || 'PHERAN FASHION LIMITED'
  const items = Array.isArray(order.items) ? order.items : []
  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0ebe4;font-size:14px;color:#333">${escHtml(i.title||'Item')}${i.color?` · ${escHtml(i.color)}`:''}${i.size?` · ${escHtml(i.size)}`:''}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f0ebe4;text-align:center;font-size:14px;color:#333">${Number(i.qty)||1}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f0ebe4;text-align:right;font-size:14px;color:#333">₦${Number(i.price||0).toLocaleString('en-NG')}</td>
    </tr>`).join('')
  const address = escHtml([shipping.address,shipping.city,shipping.state].filter(Boolean).join(', ') || '—')
  const total   = Number(order.total||0).toLocaleString('en-NG')
  const fee     = Number(order.deliveryFee||order.delivery_fee||0).toLocaleString('en-NG')
  const sub     = Number(order.subtotal||0).toLocaleString('en-NG')
  const year    = new Date().getFullYear()
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F4F0;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4F0;padding:40px 16px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:600px;box-shadow:0 2px 16px rgba(0,0,0,.06)">
  <tr><td style="background:#2D1B4E;padding:32px;text-align:center">
    <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;letter-spacing:8px;color:#fff">PHERAN</div>
  </td></tr>
  <tr><td style="padding:36px 32px">
    <h2 style="margin:0 0 6px;color:#2D1B4E;font-size:21px;font-weight:700">Order Received</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6">Hi ${firstName}, thank you for shopping with PHERAN. We've received your order and will process it as soon as we confirm your bank transfer.</p>
    <div style="background:#F7F4F0;border-radius:8px;padding:16px 20px;margin-bottom:28px">
      <div style="font-size:11px;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Order Reference</div>
      <div style="font-size:20px;font-weight:700;color:#2D1B4E;font-family:monospace">${escHtml(order.id)}</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr>
        <th style="text-align:left;padding:0 0 10px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#999;border-bottom:2px solid #f0ebe4;font-weight:700">Item</th>
        <th style="text-align:center;padding:0 0 10px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#999;border-bottom:2px solid #f0ebe4;font-weight:700">Qty</th>
        <th style="text-align:right;padding:0 0 10px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#999;border-bottom:2px solid #f0ebe4;font-weight:700">Price</th>
      </tr>
      ${itemsHtml}
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      <tr><td style="padding:4px 0;color:#666;font-size:14px">Subtotal</td><td style="padding:4px 0;text-align:right;color:#333;font-size:14px">₦${sub}</td></tr>
      <tr><td style="padding:4px 0;color:#666;font-size:14px">Delivery</td><td style="padding:4px 0;text-align:right;color:#333;font-size:14px">₦${fee}</td></tr>
      <tr><td style="padding:10px 0 0;font-weight:700;color:#2D1B4E;font-size:17px;border-top:2px solid #f0ebe4">Total</td><td style="padding:10px 0 0;text-align:right;font-weight:700;color:#2D1B4E;font-size:17px;border-top:2px solid #f0ebe4">₦${total}</td></tr>
    </table>
    <div style="background:#fffbf0;border:1px solid #f5d87a;border-radius:8px;padding:18px 20px;margin-bottom:28px">
      <div style="font-weight:700;color:#92640c;margin-bottom:10px;font-size:14px">Bank Transfer Details</div>
      <div style="color:#555;font-size:14px;line-height:1.8">
        Transfer <strong style="color:#2D1B4E">₦${total}</strong> to:<br>
        Bank: <strong>${escHtml(bankName)}</strong><br>
        Account: <strong>${escHtml(accountNum)}</strong><br>
        Name: <strong>${escHtml(accountName)}</strong><br>
        Reference: <strong style="font-family:monospace">${escHtml(order.id)}</strong>
      </div>
    </div>
    <div style="margin-bottom:24px">
      <div style="font-size:11px;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Delivery Address</div>
      <div style="color:#333;font-size:14px;line-height:1.6">${address}</div>
    </div>
    <p style="color:#888;font-size:13px;line-height:1.6;margin:0 0 20px">Questions? Email us at <a href="mailto:support@pheran.ng" style="color:#2D1B4E;font-weight:600">support@pheran.ng</a> and quote your order reference.</p>
    <div style="background:#F7F4F0;border-radius:8px;padding:16px 20px;text-align:center">
      <p style="margin:0 0 10px;color:#555;font-size:13px;line-height:1.6">Once your order arrives, we'd love to hear how it went.</p>
      <a href="https://g.page/r/CXT4uvIepBYIEBI/review" style="color:#2D1B4E;font-weight:700;font-size:13px;text-decoration:none">★ Leave us a Google review →</a>
    </div>
  </td></tr>
  <tr><td style="background:#F7F4F0;padding:24px;text-align:center">
    <div style="font-family:Georgia,serif;font-size:13px;letter-spacing:5px;color:#2D1B4E;margin-bottom:6px">PHERAN</div>
    <div style="font-size:11px;color:#aaa">© ${year} PHERAN Fashion Limited · Nigeria</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `PHERAN <orders@pheran.ng>`,
        to: [email],
        subject: `Your PHERAN order ${order.id} is confirmed`,
        html,
      }),
    })
    if (!res.ok) console.warn('[email] Resend error:', res.status, await res.text().catch(()=>''))
    else console.log('[email] Order confirmation sent to', email)
  } catch(e) { console.warn('[email] Failed to send order confirmation:', e.message) }
}

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

// Shared JWT signing secret for the local users.json fallback auth path (only used
// when Supabase Auth isn't configured). Defined once at module scope so the signer
// and verifier always agree. This repo is public, so a fixed fallback string here
// would let anyone forge a session for any account — an unset JWT_SECRET gets a
// random one generated for this run instead.
if (!process.env.JWT_SECRET) {
  console.warn('[auth] WARNING: JWT_SECRET not set — generated a random secret for this run. Set JWT_SECRET in the environment so sessions survive a restart.')
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')

const app = express()

// gzip/brotli-equivalent compression for every response — text payloads (HTML,
// CSS, JS, JSON) typically shrink 60-80%, which matters a lot on the mobile
// networks most of this site's traffic comes in on.
app.use(require('compression')())

// CORS — only allow known production origins and localhost for dev
const _PROD_ORIGINS = ['https://pheran.ng', 'https://www.pheran.ng', 'https://admin.pheran.ng']
const _EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // same-origin / curl / server-to-server
    if ([..._PROD_ORIGINS, ..._EXTRA_ORIGINS].includes(origin) ||
        /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true)
    // Not a recognized cross-origin caller — decline to add CORS headers rather than
    // throwing. Genuine same-origin requests (e.g. the site's own domain when it isn't
    // yet listed in ALLOWED_ORIGINS) still succeed since browsers don't require CORS
    // headers for same-origin calls; only real cross-origin reads get blocked.
    cb(null, false)
  },
  credentials: true,
}))
// navigator.sendBeacon() (used for session-tracking on page unload) sends its
// body as Content-Type: text/plain, not application/json — without this, every
// beacon's payload silently fails to parse and the route 400s on an "empty" body.
app.use(express.json({ limit: '1mb', type: ['application/json', 'text/plain'] }))
// cookie-parser must run before any middleware/route reads req.cookies (admin auth, etc.)
try { app.use(require('cookie-parser')()) } catch (e) { console.warn('cookie-parser missing') }

// Security headers — applied to every response
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '0') // modern browsers: disable legacy XSS auditor (CSP handles this)
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // HSTS — only on HTTPS (Railway / production)
  const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.secure
  if (isHttps) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  // Content Security Policy
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://js.sentry-cdn.com https://browser.sentry-cdn.com",          // inline scripts used in HTML pages; GTM loads gtag.js; Sentry's loader pulls the full SDK from browser.sentry-cdn.com
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.supabase.co https://aajbecjnnuebsvxmuiww.supabase.co https://www.google-analytics.com https://www.googletagmanager.com https://www.google.com https://www.google.com.ng",
    "connect-src 'self' https://*.supabase.co https://api.supabase.com https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net https://www.google.com https://www.google.com.ng https://*.ingest.us.sentry.io https://o4509921943158784.ingest.us.sentry.io",
    "media-src 'self' blob: https://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '))
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

// Rate-limit auth endpoints — 20 attempts per IP per 15 minutes.
// Also covers /api/admin/login — the PIN gate for the whole admin panel had no
// brute-force protection at all before this, since it isn't under /api/auth.
const _authRateMap = new Map()
function authRateLimit(req, res, next) {
  const key = req.ip || 'unknown'
  const now = Date.now()
  const rec = _authRateMap.get(key) || { n: 0, t: now }
  if (now - rec.t > 900000) { rec.n = 0; rec.t = now }
  rec.n++
  _authRateMap.set(key, rec)
  if (rec.n > 20) return res.status(429).set('Retry-After', '900').json({ ok: false, error: 'Too many requests — try again in 15 minutes' })
  next()
}
app.use('/api/auth', authRateLimit)
app.use('/api/admin/login', authRateLimit)

// On admin.pheran.ng, the bare root should show the admin panel instead of the
// storefront homepage. Deliberately narrow — only the exact "/" path, not
// "doesn't start with /admin" as this used to read. That broader form rewrote
// every API call the admin panel's own JS makes (/api/admin/login,
// /api/products, /api/admin/orders, ...) into a nonsense /admin/api/... path
// that matches nothing, so every one of them silently 401'd. Same-origin asset
// requests like /kill-sw.js were caught by it too.
app.use((req, _res, next) => {
  const host = (req.headers.host || '').split(':')[0]
  if (host === 'admin.pheran.ng' && req.path === '/') {
    req.url = '/admin/' + req.url.slice(1)
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
  '/about': 'about.html',
  '/guides/what-to-wear-to-an-owambe': 'guide-owambe.html',
  '/guides/custom-aso-oke-dress-nigeria': 'guide-aso-oke.html',
  '/guides/bespoke-evening-gown-cost-lagos': 'guide-gown-pricing.html',
}
// Preserves ?id=... etc. when redirecting legacy .html links to their clean path —
// dropping the query string here sent every /product.html?id=X click to a bare
// /product with no id, which always fell back to showing the first product.
function withQuery(base, req) {
  const qIdx = req.url.indexOf('?')
  return qIdx === -1 ? base : base + req.url.slice(qIdx)
}
for (const [route, file] of Object.entries(_PAGES)) {
  // /product is server-rendered per-product below instead of served as a
  // static file — skip the generic handler so that one wins.
  if (route !== '/product') app.get(route, (_req, res) => res.sendFile(path.join(_MVR, file)))
  if ('/' + file !== route) {
    // 302, not 301: a 301 gets cached by the browser near-permanently, so any
    // future bug in this redirect (like the query-string one above) would stay
    // stuck in visitors' caches even after the server-side fix ships.
    // *.html → clean path (handles relative href links from other pages)
    app.get('/' + file, (req, res) => res.redirect(302, withQuery(route, req)))
    // Legacy /mvp/filename.html → clean path
    app.get('/mvp/' + file, (req, res) => res.redirect(302, withQuery(route, req)))
  }
}

// Product page — server-renders per-product title, description, share image,
// canonical URL, and JSON-LD structured data before the HTML reaches the
// client. Without this every product shared the same generic <title>/og:image,
// so link previews (WhatsApp, Instagram — none of which execute JS) always
// showed the wrong product, and search engines saw near-duplicate pages.
// Reads straight from loadData() on every request, so a product added or
// removed via the admin panel is reflected immediately, with no redeploy.
let _productPageTemplate = null
function getProductPageTemplate() {
  if (!_productPageTemplate) _productPageTemplate = fs.readFileSync(path.join(_MVR, 'product.html'), 'utf8')
  return _productPageTemplate
}
function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
app.get('/product', (req, res) => {
  try {
    const id = String(req.query.id || '')
    const product = id ? loadData().find(p => p.id === id) : null
    let html = getProductPageTemplate()
    if (product) {
      const title = `${product.title} — PHERAN`
      const desc = (product.description || `Shop ${product.title} from PHERAN, Nigeria's premium fashion house.`).slice(0, 160)
      const image = product.images?.[0] || 'https://pheran.ng/img-red-gown-front.jpg'
      const url = `https://pheran.ng/product?id=${encodeURIComponent(product.id)}`
      html = html
        .replace('<title>PHERAN — Product</title>', `<title>${escAttr(title)}</title>`)
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escAttr(desc)}">`)
        .replace('<meta property="og:title" content="PHERAN">', `<meta property="og:title" content="${escAttr(title)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escAttr(desc)}">`)
        .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${escAttr(image)}">`)
        .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escAttr(url)}">`)
        .replace('<meta name="twitter:title" content="PHERAN">', `<meta name="twitter:title" content="${escAttr(title)}">`)
        .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${escAttr(desc)}">`)
        .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${escAttr(image)}">`)
        .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escAttr(url)}">`)
      const productLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.title,
        image: product.images || [],
        description: product.description || '',
        sku: product.id,
        brand: { '@type': 'Brand', name: 'PHERAN' },
        offers: {
          '@type': 'Offer',
          url,
          priceCurrency: 'NGN',
          price: product.price,
          availability: product.availability === 'Out of Stock' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
        },
      }
      if (product.rating) productLd.aggregateRating = { '@type': 'AggregateRating', ratingValue: product.rating, reviewCount: product.count || 1 }
      const breadcrumbLd = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pheran.ng/' },
          { '@type': 'ListItem', position: 2, name: 'Shop', item: 'https://pheran.ng/shop' },
          { '@type': 'ListItem', position: 3, name: product.title, item: url },
        ],
      }
      html = html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(productLd)}</script>\n<script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>\n</head>`)
    } else if (id) {
      // A specific product was requested but doesn't exist (deleted, bad link) —
      // 404 instead of silently serving generic content as if it were fine.
      res.status(404)
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    res.send(html)
  } catch (e) {
    res.sendFile(path.join(_MVR, 'product.html'))
  }
})

// Sitemap generated from the live catalog — a static sitemap.xml went stale
// the moment a product was added or removed. Registered before the static
// file middlewares so it takes precedence over the checked-in fallback file.
const _STATIC_ROUTES = [
  { path: '/',       freq: 'weekly',  priority: '1.0' },
  { path: '/shop',   freq: 'weekly',  priority: '0.9' },
  { path: '/gallery',freq: 'monthly', priority: '0.7' },
  { path: '/custom', freq: 'monthly', priority: '0.7' },
  { path: '/about',  freq: 'monthly', priority: '0.6' },
  { path: '/support',freq: 'monthly', priority: '0.5' },
  { path: '/policies',freq: 'monthly', priority: '0.4' },
  { path: '/guides/what-to-wear-to-an-owambe',          freq: 'monthly', priority: '0.6' },
  { path: '/guides/custom-aso-oke-dress-nigeria',        freq: 'monthly', priority: '0.6' },
  { path: '/guides/bespoke-evening-gown-cost-lagos',     freq: 'monthly', priority: '0.6' },
]
app.get('/sitemap.xml', (_req, res) => {
  try {
    const products = loadData()
    const urls = [
      ..._STATIC_ROUTES.map(r => ({ loc: `https://pheran.ng${r.path}`, freq: r.freq, priority: r.priority })),
      ...products.map(p => ({ loc: `https://pheran.ng/product?id=${encodeURIComponent(p.id)}`, freq: 'weekly', priority: '0.8' })),
    ]
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n') +
      `\n</urlset>\n`
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.send(body)
  } catch (e) {
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>')
  }
})

// Email verification page — deliberately NOT a redirect straight to Supabase's
// GET /auth/v1/verify. That endpoint is stateful and single-use on a bare GET,
// which email security scanners (Outlook Safe Links, corporate gateways, etc.)
// routinely pre-fetch before the real user ever opens the email — silently
// burning the one-time token, so the genuine click then fails with a
// confusing "requires a token" error. It also put the raw Supabase project
// domain in the visitor's address bar.
// This page instead renders normally (harmless if a scanner fetches it — that
// alone consumes nothing) and its own JS does the actual verification via a
// POST to /api/auth/verify below, which calls Supabase server-to-server and
// sets the session cookie directly. The browser never leaves pheran.ng, and
// nothing is consumed until a real browser actually executes the script.
const _VALID_VERIFY_TYPES = new Set(['signup','recovery','magiclink','invite','email_change','reauthentication'])
app.get('/verify', (req, res) => {
  const { token_hash, type } = req.query
  if (!token_hash || !type || !_VALID_VERIFY_TYPES.has(type)) {
    return res.status(400).send('Invalid or expired verification link.')
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<script src="https://js.sentry-cdn.com/6de81974c2a513ec04b868a2f6fda26d.min.js" crossorigin="anonymous"></script>
<script src="/kill-sw.js?v=20260801"></script>
<title>PHERAN — Confirming…</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#F7F4F0}
.box{text-align:center;padding:40px 24px;max-width:380px}.logo{font-family:Georgia,serif;font-size:2rem;font-weight:700;letter-spacing:5px;color:#2D1B4E}
.sub{font-size:.9rem;color:#888;margin-top:12px;letter-spacing:.02em;line-height:1.6}.dot{display:inline-block;animation:blink 1.2s infinite}.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:0}40%{opacity:1}}
.retry{display:none;margin-top:20px;padding:12px 24px;background:#2D1B4E;color:#fff;border:none;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;text-decoration:none}
</style></head>
<body><div class="box"><div class="logo">PHERAN</div><div class="sub" id="msg">Confirming your email<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div><a class="retry" id="retry" href="/account">Go to my account →</a></div>
<script>
(async()=>{
  const p = new URLSearchParams(location.search)
  const token_hash = p.get('token_hash'), type = p.get('type')
  const msg = document.getElementById('msg'), retry = document.getElementById('retry')
  if(!token_hash || !type){ msg.textContent = 'This link is invalid or incomplete.'; return }
  try{
    const r = await fetch('/api/auth/verify', {
      method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token_hash, type })
    })
    const d = await r.json()
    if(d.ok){
      location.replace('/account' + ((type==='signup'||type==='email_change') ? '?confirmed=1' : ''))
    } else {
      msg.textContent = 'This link has expired or was already used. If you already have an account, just sign in — otherwise request a new link.'
      retry.style.display = 'inline-block'
      retry.textContent = 'Go to sign in →'
    }
  }catch(e){
    msg.textContent = 'Something went wrong confirming this link.'
    retry.style.display = 'inline-block'
  }
})()
</script></body></html>`)
})

// Auth callback — exchanges the access_token hash for a session cookie, then redirects cleanly to /account.
// The access_token never appears in the /account URL.
app.get('/auth/callback', (_req, res) => {
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<script src="https://js.sentry-cdn.com/6de81974c2a513ec04b868a2f6fda26d.min.js" crossorigin="anonymous"></script>
<script src="/kill-sw.js?v=20260801"></script>
<title>PHERAN — Signing in…</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#F7F4F0}
.box{text-align:center;padding:40px 24px}.logo{font-family:Georgia,serif;font-size:2rem;font-weight:700;letter-spacing:5px;color:#2D1B4E}
.sub{font-size:.9rem;color:#888;margin-top:12px;letter-spacing:.02em}.dot{display:inline-block;animation:blink 1.2s infinite}.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:0}40%{opacity:1}}</style></head>
<body><div class="box"><div class="logo">PHERAN</div><div class="sub" id="msg">Confirming your email<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div></div>
<script>
(async()=>{
  const hp=new URLSearchParams(location.hash.slice(1))
  const at=hp.get('access_token'),rt=hp.get('refresh_token'),type=hp.get('type')
  if(!at||!rt){location.replace('/account');return}
  try{
    const r=await fetch('/api/auth/exchange',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:at,refresh_token:rt})})
    const d=await r.json()
    location.replace('/account'+(d.ok&&(type==='signup'||type==='email_change')?'?confirmed=1':''))
  }catch(e){location.replace('/account')}
})()
</script></body></html>`)
})

// Public: bank transfer details for checkout (configured in .env)
app.get('/api/bank-details', (_req, res) => {
  res.json({
    ok: true,
    bank:    process.env.PHERAN_BANK_NAME    || 'Zenith Bank',
    account: process.env.PHERAN_ACCOUNT_NUMBER || '1234567890',
    name:    process.env.PHERAN_ACCOUNT_NAME   || 'PHERAN FASHION LIMITED',
  })
})

// Rate limit for order/cart mutations — 60 requests per IP per 15 minutes
const _mutationRateMap = new Map()
function mutationRateLimit(req, res, next) {
  const key = req.ip || 'unknown'
  const now = Date.now()
  const rec = _mutationRateMap.get(key) || { n: 0, t: now }
  if (now - rec.t > 900000) { rec.n = 0; rec.t = now }
  rec.n++
  _mutationRateMap.set(key, rec)
  if (rec.n > 60) return res.status(429).set('Retry-After', '900').json({ ok: false, error: 'Too many requests — try again in 15 minutes' })
  next()
}

// Auto-evict stale product cache entries every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of PRODUCT_CACHE.entries()) {
    if (now - v.ts > CACHE_TTL * 2) PRODUCT_CACHE.delete(k)
  }
}, 600000).unref()

// Admin — protected by ADMIN_EMAIL + ADMIN_PIN env vars.
// Registered BEFORE the generic static middlewares below so unauthenticated requests
// for /admin/*.html can never be served directly by express.static — they must pass
// through the auth-check middleware first.
//
// IMPORTANT: this repo is public on GitHub. A hardcoded fallback PIN here would be
// visible to anyone and usable as a live backdoor if ADMIN_PIN is ever unset in
// Railway. So instead of a fixed fallback, an unset ADMIN_PIN gets a random one
// generated fresh at boot (logged once below) — it still lets the server start,
// but there is no fixed value anywhere in source that grants access.
if (!process.env.ADMIN_PIN) {
  console.warn('[admin] WARNING: ADMIN_PIN not set — generated a temporary random PIN for this run (see below). Set ADMIN_PIN in the environment for a persistent login.')
}
const ADMIN_PIN = process.env.ADMIN_PIN || String(crypto.randomInt(10000000, 100000000))
if (!process.env.ADMIN_PIN) console.warn(`[admin] Temporary PIN for this run: ${ADMIN_PIN}`)
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@pheran.ng').trim().toLowerCase()
if (!process.env.ADMIN_EMAIL) console.warn('[admin] ADMIN_EMAIL not set — using default admin@pheran.ng. Set ADMIN_EMAIL in the environment to use your own address.')
// Token incorporates both credentials so changing either one (e.g. rotating the
// PIN, or updating the admin email in Railway) invalidates existing sessions.
const ADMIN_TOKEN = crypto.createHash('sha256').update(ADMIN_PIN + ADMIN_EMAIL + 'pheran-admin-2026').digest('hex')

function setAdminCookie(req, res) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.secure
  res.cookie('admin_auth', ADMIN_TOKEN, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000, secure })
}

// requireAdminAuth — timing-safe comparison to prevent timing oracle attacks
function requireAdminAuth(req, res, next) {
  if (req.cookies?.admin_auth && timingSafeEqual(req.cookies.admin_auth, ADMIN_TOKEN)) return next()
  const [, b64] = (req.headers['authorization'] || '').split(' ')
  if (b64) {
    const decoded = Buffer.from(b64, 'base64').toString()
    const colonIdx = decoded.indexOf(':')
    const user = (colonIdx >= 0 ? decoded.slice(0, colonIdx) : '').trim().toLowerCase()
    const pass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : ''
    if (user === ADMIN_EMAIL && pass && timingSafeEqual(pass, ADMIN_PIN)) { setAdminCookie(req, res); return next() }
  }
  res.status(401).json({ ok: false, error: 'Unauthorized — admin access only' })
}

// Admin login page — served before the auth guard so unauthenticated users can reach it
app.get('/admin/login', (_req, res) => res.sendFile(path.join(__dirname, '..', 'admin', 'login.html')))

// Admin login API — validates email + PIN together, issues httpOnly session cookie.
// Both must match — neither alone is enough — so a leaked PIN alone can't get in.
app.post('/api/admin/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const pin = String(req.body?.pin || '')
  if (!email || !pin || email !== ADMIN_EMAIL || !timingSafeEqual(pin, ADMIN_PIN)) {
    return res.status(401).json({ ok: false, error: 'Incorrect email or PIN' })
  }
  setAdminCookie(req, res)
  res.json({ ok: true })
})

// Admin logout — clears session cookie and redirects to login
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_auth', { path: '/' })
  res.json({ ok: true })
})

app.use('/admin', (req, res, next) => {
  // Login page is public — skip auth check
  if (req.path === '/login' || req.path === '/login.html') return next()
  // Valid session cookie → allow through
  if (req.cookies?.admin_auth && timingSafeEqual(req.cookies.admin_auth, ADMIN_TOKEN)) return next()
  // HTML page request → redirect to login (no browser Basic Auth dialog)
  if (req.headers.accept?.includes('text/html')) return res.redirect(302, '/admin/login')
  // API / asset request → 401
  res.status(401).json({ ok: false, error: 'Unauthorized — admin access only' })
})
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')))

// serve static assets with caching headers
// HTML: no-cache so updates deploy immediately; CSS/JS/images: 1 day cache with revalidation
const _staticOpts = { etag: true, lastModified: true }
// (cache options are set per-extension in setHeaders below)
app.use(express.static(path.join(__dirname, '..'), {
  ..._staticOpts,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase()
    if (['.css', '.js', '.woff2', '.woff', '.ttf', '.ico', '.svg'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600')
    } else if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400')
    } else if (['.mp4', '.webm'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000')
    } else {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    }
  }
}))
app.use(express.static(path.join(__dirname, '../..'), _staticOpts))

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
  const sharp = require('sharp')
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 80 * 1024 * 1024 }, // 80 MB covers product videos
    fileFilter: (_req, file, cb) => cb(null, !!UPLOAD_MIME[file.mimetype])
  })
  app.post('/api/upload', requireAdminAuth, upload.any(), async (req, res) => {
    if (!req.files || !req.files.length) return res.status(400).json({ ok: false, error: 'No files received' })
    // Express 4 doesn't route a rejected async-handler promise to the error
    // middleware — an uncaught throw here (e.g. a disk write failing) would
    // otherwise leave the request hanging with no response ever sent.
    try {
      const results = []
      for (const file of req.files) {
        const isVideo = file.mimetype.startsWith('video/')
        let buffer = file.buffer
        let mimetype = file.mimetype
        let ext = UPLOAD_MIME[file.mimetype] || path.extname(file.originalname).toLowerCase() || (isVideo ? '.mp4' : '.jpg')
        // Images always get re-encoded to a size-capped JPEG, regardless of the
        // format uploaded in. Uncompressed PNG screenshots/exports from a phone
        // or image editor were landing at 1.5-2MB each versus ~70KB for an
        // equivalent JPEG — the single biggest thing slowing image load time
        // across the site, since this is what ends up in every product card.
        if (!isVideo) {
          try {
            buffer = await sharp(file.buffer)
              .rotate() // apply EXIF orientation before stripping metadata
              .resize({ width: 1400, withoutEnlargement: true })
              .jpeg({ quality: 85, progressive: true, mozjpeg: true })
              .toBuffer()
            mimetype = 'image/jpeg'
            ext = '.jpg'
          } catch (sharpErr) {
            console.warn('[upload] image optimization failed, using original:', sharpErr.message)
            reportError(new Error('Upload optimization failed: ' + sharpErr.message), { originalName: file.originalname })
          }
        }
        const prefix = isVideo ? 'videos/' : ''
        const filename = `${prefix}${isVideo ? 'vid' : 'img'}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
        if (supabase) {
          try {
            const { error } = await supabase.storage
              .from('product-images')
              .upload(filename, buffer, { contentType: mimetype, upsert: true })
            if (error) throw error
            const { data } = supabase.storage.from('product-images').getPublicUrl(filename)
            results.push({ url: data.publicUrl, type: isVideo ? 'video' : 'image', name: file.originalname })
            continue
          } catch (storageErr) {
            console.warn('[upload] Supabase Storage error:', storageErr.message, '— falling back to disk')
            // Not a hard failure (disk fallback below still serves the request), but worth
            // knowing about — Railway's filesystem isn't persistent across deploys, so a
            // disk-stored image silently disappears on the next redeploy.
            reportError(new Error('Upload fell back to disk: ' + storageErr.message), { filename })
          }
        }
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer)
        results.push({ url: `/uploads/${filename}`, type: isVideo ? 'video' : 'image', name: file.originalname })
      }
      res.json({ ok: true, results, paths: results.map(r => r.url) })
    } catch (e) {
      console.error('[upload] failed:', e.message)
      reportError(e, { route: '/api/upload' })
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'Upload failed — please try again' })
    }
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
      if(error){ console.warn('[supabase] write error:', error.message); reportError(new Error('Product upsert failed: '+error.message)) }
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
  const perPage = Math.min(200, Math.max(1, Number(params.perPage) || 12))
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
    // Validate and sanitize all fields — bounds prevent prototype pollution and XSS vectors
    const VALID_CATEGORIES = ['Dresses','Tops','Bottoms','Two-piece','Accessories','General']
    const VALID_AVAIL = ['In Stock','Made to Order','Limited Stock','Out of Stock']
    const price = Math.max(0, Math.min(99999999, Number(body.price) || 0))
    const oldPrice = Math.max(0, Math.min(99999999, Number(body.oldPrice) || 0))
    const product = {
      id: body.id ? String(body.id).slice(0,100).replace(/[^\w\-]/g,'') : `product-${Date.now()}`,
      title: String(body.title || 'Untitled Product').slice(0, 200),
      category: VALID_CATEGORIES.includes(body.category) ? body.category : 'General',
      price,
      oldPrice,
      rating: Math.max(0, Math.min(5, Number(body.rating) || 4.5)),
      availability: VALID_AVAIL.includes(body.availability) ? body.availability : 'In Stock',
      sizes: (Array.isArray(body.sizes) ? body.sizes : String(body.sizes||'').split(',').map(v=>v.trim()).filter(Boolean)).slice(0,20).map(s=>String(s).slice(0,10)),
      colors: (Array.isArray(body.colors) ? body.colors : String(body.colors||'').split(',').map(v=>v.trim()).filter(Boolean)).slice(0,30).map(c=>String(c).slice(0,50)),
      fabric: String(body.fabric || 'Unknown').slice(0, 100),
      images: (Array.isArray(body.images) ? body.images : String(body.images||'').split(/\n|,/).map(v=>v.trim()).filter(Boolean)).slice(0,20).map(u=>String(u).slice(0,500)),
      description: String(body.description || '').slice(0, 2000),
      count: Math.max(0, Math.min(9999, Number(body.count) || 1)),
      video: body.video ? String(body.video).slice(0,500) : undefined,
    }
    if(existingIndex >= 0) {
      products[existingIndex] = product
    } else {
      products.push(product)
    }
    saveProducts(products)
    res.json({ ok:true, message: existingIndex >= 0 ? 'Product updated' : 'Product created', product })
  } catch(e){
    reportError(e)
    res.status(500).json({ ok:false, error: String(e) })
  }
})

app.delete('/api/products/admin', requireAdminAuth, async (req, res)=>{
  try{
    const { id } = req.body || {}
    if(!id) return res.status(400).json({ ok:false, error:'missing id' })
    const products = loadData().filter(p => p.id !== id)
    saveProducts(products)
    // saveProducts() only upserts the remaining rows — it never deletes, so the row
    // must be removed from Supabase explicitly or syncFromSupabase() resurrects it
    // on the next server restart/deploy.
    if(supabase){
      const { error } = await supabase.from('products').delete().eq('id', id)
      if(error){ console.warn('[supabase] delete error:', error.message); reportError(new Error('Product delete failed: '+error.message), { productId: id }) }
    }
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
app.post('/api/session', mutationRateLimit, (req,res)=>{
  const body = req.body || {}
  // Only accept well-formed string IDs — prevents prototype pollution via __proto__ keys
  const ids = Array.isArray(body.products) ? body.products.filter(id=>typeof id==='string'&&id.length<=100&&/^[\w\-]+$/.test(id)).slice(0,50) : []
  const rawEvents = Array.isArray(body.events) ? body.events.slice(0,50) : []
  if(!ids.length && !rawEvents.length) return res.status(400).json({error:'no products or events'})
  const co = loadCooc()
  ids.forEach(id=>{ if(Object.prototype.hasOwnProperty.call(co,id)||true) co[id] = Math.min(99999,(co[id]||0)+1) })
  if(rawEvents.length){
    const events = rawEvents.map(ev=>({
      id: typeof ev.id==='string'&&/^[\w\-]+$/.test(ev.id) ? ev.id.slice(0,100) : null,
      type: typeof ev.type==='string' ? ev.type.slice(0,20) : 'view',
    })).filter(ev=>ev.id)
    events.forEach(ev=>{ co[ev.id] = Math.min(99999,(co[ev.id]||0)+1) })
    // async write so it doesn't block
    const pathS = path.join(__dirname, 'session_events.json')
    fs.promises.readFile(pathS,'utf8').then(raw=>{
      const existing = JSON.parse(raw||'[]')
      existing.push({ ts: Date.now(), events })
      return fs.promises.writeFile(pathS, JSON.stringify(existing.slice(-1000)), 'utf8')
    }).catch(()=>fs.promises.writeFile(pathS,JSON.stringify([{ts:Date.now(),events}]),'utf8').catch(()=>{}))
  }
  // async write co-occurrence
  fs.promises.writeFile(COO_PATH, JSON.stringify(co), 'utf8').catch(()=>{})
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

// Resolve userId from session cookie (Supabase JWT or bcrypt JWT).
// Returns the authenticated userId or 'anonymous' — never trusts client-supplied userId.
async function getSessionUserId(req) {
  if (supabase) {
    const access = req.cookies?.[COOKIE_ACCESS]
    if (!access) return 'anonymous'
    try {
      const { data } = await supabase.auth.getUser(access)
      return data?.user?.id || 'anonymous'
    } catch(e) { return 'anonymous' }
  } else {
    // bcrypt fallback: read JWT from cookie
    try {
      const jwt = require('jsonwebtoken')
      const t = req.cookies?.[COOKIE_ACCESS]
      if (!t) return 'anonymous'
      const p = jwt.verify(t, JWT_SECRET, { algorithms: ['HS256'] })
      return p?.id || 'anonymous'
    } catch(e) { return 'anonymous' }
  }
}

// In-memory mock orders store (keyed by authenticated userId — never client-supplied)
const ORDERS_STORE = new Map()

app.get('/api/orders', async(req,res)=>{
  try{
    const userId = await getSessionUserId(req)
    if(userId === 'anonymous') return res.json({ ok:true, orders:[], total:0 })
    // Prefer Supabase for accuracy; fall back to in-memory
    if(supabase){
      const { data, error } = await supabase.from('orders').select('*').eq('user_id', userId).order('created_at',{ascending:false}).limit(100)
      if(!error) return res.json({ ok:true, orders: data||[], total: (data||[]).length })
    }
    const orders = ORDERS_STORE.get(userId) || []
    res.json({ ok:true, orders, total: orders.length })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

app.get('/api/orders/:orderId', async(req,res)=>{
  try{
    const userId = await getSessionUserId(req)
    if(userId === 'anonymous') return res.status(401).json({ ok:false, error:'Not authenticated' })
    const orderId = req.params.orderId
    if(supabase){
      const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).eq('user_id', userId).single()
      if(error || !data) return res.status(404).json({ ok:false, error:'Order not found' })
      return res.json({ ok:true, order: data })
    }
    const orders = ORDERS_STORE.get(userId) || []
    const order = orders.find(o=>o.id===orderId)
    if(!order) return res.status(404).json({ ok:false, error:'Order not found' })
    res.json({ ok:true, order })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

// Re-derives each cart line's price from the authoritative catalog / custom-order
// config instead of trusting the client — the cart lives in localStorage, which
// anyone can edit via devtools before placing an order. Returns null items for
// anything that doesn't resolve to a real product so the caller can reject the order.
async function priceOrderItems(items) {
  const catalog = loadData()
  const customConfig = await getCustomConfig()
  let priceError = null
  const priced = items.map(raw => {
    if (priceError) return null
    const qty = Math.max(1, Math.min(20, Math.floor(Number(raw?.qty)) || 1))
    if (raw?.id === 'custom') {
      const garment = customConfig.garments.find(g => g.key === raw.garmentKey)
      const fabric = customConfig.fabrics.find(f => f.key === raw.fabricKey)
      if (!garment || !fabric) { priceError = 'Invalid custom-order selection'; return null }
      const base = garment.basePrice
      const fab = fabric.priceAdd
      const rushPercent = customConfig.delivery?.rushPercent ?? 40
      const rush = raw.rush ? Math.round((base + fab) * (rushPercent / 100)) : 0
      return {
        key: String(raw.key || `custom-${Date.now()}`).slice(0,100),
        id: 'custom', qty,
        price: base + fab + rush,
        title: `Custom ${garment.label}`,
        image: String(raw.image || '').slice(0,500),
        size: String(raw.size || 'Custom').slice(0,40),
        color: String(raw.color || 'As specified').slice(0,100),
      }
    }
    const product = catalog.find(p => p.id === raw?.id)
    if (!product) { priceError = `Unknown product: ${String(raw?.id||'').slice(0,50)}`; return null }
    return {
      key: String(raw.key || product.id).slice(0,100),
      id: product.id, qty,
      price: product.price,
      title: product.title,
      image: product.images?.[0] || '',
      size: String(raw.size || '').slice(0,40),
      color: String(raw.color || '').slice(0,100),
    }
  })
  return priceError ? { error: priceError } : { items: priced }
}

app.post('/api/orders', mutationRateLimit, async(req,res)=>{
  try{
    const sessionUserId = await getSessionUserId(req)
    const { userEmail='', items: rawItems=[], shipping={}, deliveryMethod='standard' } = req.body||{}
    const userId = sessionUserId // always use session-derived ID — never trust client
    if(!Array.isArray(rawItems) || !rawItems.length) return res.status(400).json({ ok:false, error:'items required' })
    if(rawItems.length > 50) return res.status(400).json({ ok:false, error:'Too many items' })
    const priced = await priceOrderItems(rawItems)
    if(priced.error) return res.status(400).json({ ok:false, error: priced.error })
    const items = priced.items
    const subtotal = items.reduce((s,i)=>s+(i.price*i.qty),0)
    const deliveryFee = deliveryMethod==='express' ? 3500 : deliveryMethod==='international' ? 0 : (subtotal>=100000 ? 0 : 1500)
    const safeShipping = {
      firstName: String(shipping.firstName||'').slice(0,60),
      lastName:  String(shipping.lastName||'').slice(0,60),
      email:     String(shipping.email||'').slice(0,200),
      phone:     String(shipping.phone||'').slice(0,30),
      address:   String(shipping.address||'').slice(0,300),
      address2:  String(shipping.address2||'').slice(0,300),
      city:      String(shipping.city||'').slice(0,100),
      state:     String(shipping.state||'').slice(0,100),
    }
    const order = {
      id: 'PH-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      userId,
      userEmail: String(userEmail||'').slice(0,200),
      items,
      shipping: safeShipping,
      payment: { method: 'bank_transfer' },
      deliveryMethod,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      status: 'pending_payment',
      createdAt: new Date().toISOString(),
    }
    // Save to Supabase — the source of truth the admin panel reads from. If this
    // write fails (network blip, constraint violation, an ID collision from the
    // Date.now()-based id under concurrent requests) the order must not be
    // reported as placed: the customer would be shown real bank details and told
    // to wire money for an order the business can never see or confirm.
    if(supabase){
      // Include deliveryMethod inside shipping JSON so it's never lost even if the
      // top-level delivery_method column doesn't exist in older table schemas.
      const shippingWithMethod = { ...order.shipping, deliveryMethod: order.deliveryMethod }
      const basePayload = {
        id: order.id,
        user_id: userId !== 'anonymous' ? userId : null,
        user_email: userEmail,
        items: order.items,
        shipping: shippingWithMethod,
        subtotal: order.subtotal,
        delivery_fee: order.deliveryFee,
        total: order.total,
        status: order.status,
        delivery_method: order.deliveryMethod,
      }
      let { error: insertError } = await supabase.from('orders').insert(basePayload)
      // Retry without delivery_method column if table schema doesn't have it yet
      if(insertError && /column.+delivery_method|delivery_method.+column/i.test(insertError.message)){
        const { delivery_method, ...payloadWithoutCol } = basePayload
        ;({ error: insertError } = await supabase.from('orders').insert(payloadWithoutCol))
      }
      if(insertError){
        console.error('[orders] insert failed:', insertError.message)
        reportError(new Error('Order insert failed: ' + insertError.message), { orderId: order.id, total: order.total })
        return res.status(500).json({ ok:false, error:'Could not save your order — please try again' })
      }
    }
    // Also keep in-memory (admin fallback / fast lookup)
    const orders = ORDERS_STORE.get(userId) || []
    orders.unshift(order)
    ORDERS_STORE.set(userId, orders)
    // Fire-and-forget — never delays the response
    sendOrderEmail(order).catch(()=>{})
    res.status(201).json({ ok:true, order })
  }catch(e){
    reportError(e)
    res.status(500).json({ ok:false, error: String(e) })
  }
})

// ─── Admin orders management ───────────────────────────────────────────────────
app.get('/api/admin/orders', requireAdminAuth, async(req,res)=>{
  try{
    const page   = Math.max(0, parseInt(req.query.page)||0)
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit)||50))
    const offset = page * limit
    const { status, from, to, q } = req.query
    if(supabase){
      let query = supabase.from('orders').select('*',{count:'exact'})
      if(status && status !== 'all') query = query.eq('status', status)
      if(from) query = query.gte('created_at', from)
      if(to)   query = query.lte('created_at', to + 'T23:59:59.999Z')
      if(q){
        const safe = q.replace(/[%_\\]/g, '\\$&')
        query = query.or(`user_email.ilike.%${safe}%`)
      }
      const { data, error, count } = await query.order('created_at',{ascending:false}).range(offset, offset+limit-1)
      if(error) return res.status(500).json({ok:false,error:error.message})
      return res.json({ok:true, orders: data, total: count, page, limit})
    }
    // In-memory fallback
    let all = []
    for(const [,orders] of ORDERS_STORE) all.push(...orders)
    all.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
    if(status && status !== 'all') all = all.filter(o=>o.status===status)
    if(from) all = all.filter(o=>new Date(o.createdAt)>=new Date(from))
    if(to)   all = all.filter(o=>new Date(o.createdAt)<=new Date(to+'T23:59:59.999Z'))
    if(q){ const ql=q.toLowerCase(); all=all.filter(o=>(o.userEmail||'').toLowerCase().includes(ql)||(`${o.shipping?.firstName||''} ${o.shipping?.lastName||''}`).toLowerCase().includes(ql)) }
    res.json({ok:true, orders: all.slice(offset, offset+limit), total: all.length, page, limit})
  }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
})

// CSV export — must be before /:orderId routes so "export" isn't matched as an ID
app.get('/api/admin/orders/export', requireAdminAuth, async(req,res)=>{
  try{
    let orders = []
    if(supabase){
      const { data, error } = await supabase.from('orders').select('*').order('created_at',{ascending:false}).limit(5000)
      if(error) return res.status(500).json({ok:false,error:error.message})
      orders = data || []
    } else {
      for(const [,o] of ORDERS_STORE) orders.push(...o)
      orders.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
    }
    // Neutralize formula injection — a customer-supplied shipping name/address starting
    // with =, +, -, or @ would otherwise execute as a formula when the admin opens this
    // CSV in Excel/Sheets.
    const csvCell = v => {
      let s = String(v??'')
      if (/^[=+\-@]/.test(s)) s = `'${s}`
      return (s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`:s
    }
    const headers = ['Order ID','Date','Status','Customer Name','Email','Phone','Address','City','State','Delivery','Items','Subtotal','Delivery Fee','Total']
    const rows = orders.map(o=>{
      const s=o.shipping||{}
      return [
        o.id,
        o.created_at||o.createdAt||'',
        o.status||'',
        `${s.firstName||''} ${s.lastName||''}`.trim(),
        o.user_email||o.userEmail||s.email||'',
        s.phone||'',
        s.address||'',
        s.city||'',
        s.state||'',
        o.delivery_method||o.deliveryMethod||'standard',
        (Array.isArray(o.items)?o.items:[]).map(i=>`${i.title||'?'} x${i.qty||1}`).join(' | '),
        o.subtotal||0,
        o.delivery_fee||o.deliveryFee||0,
        o.total||0,
      ].map(csvCell).join(',')
    })
    const csv = [headers.join(','), ...rows].join('\r\n')
    const filename = `pheran-orders-${new Date().toISOString().slice(0,10)}.csv`
    res.setHeader('Content-Type','text/csv; charset=utf-8')
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`)
    res.send('﻿'+csv) // BOM so Excel opens UTF-8 correctly
  }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
})

app.patch('/api/admin/orders/:orderId/payment', requireAdminAuth, async(req,res)=>{
  try{
    const { orderId } = req.params
    const { confirmed=true } = req.body||{}
    const status = confirmed ? 'confirmed' : 'pending_payment'
    if(supabase){
      const { data, error } = await supabase.from('orders').update({status,updated_at:new Date().toISOString()}).eq('id',orderId).select().single()
      if(error){ reportError(new Error('Payment update failed: '+error.message), { orderId }); return res.status(500).json({ok:false,error:error.message}) }
      return res.json({ok:true,order:data})
    }
    for(const [,orders] of ORDERS_STORE){
      const o = orders.find(x=>x.id===orderId)
      if(o){ o.status=status; o.updatedAt=new Date().toISOString(); return res.json({ok:true,order:o}) }
    }
    res.status(404).json({ok:false,error:'Order not found'})
  }catch(e){ reportError(e); res.status(500).json({ok:false,error:String(e)}) }
})

app.patch('/api/admin/orders/:orderId/status', requireAdminAuth, async(req,res)=>{
  try{
    const { orderId } = req.params
    const { status } = req.body||{}
    const valid = ['pending_payment','confirmed','processing','dispatched','delivered','cancelled']
    if(!valid.includes(status)) return res.status(400).json({ok:false,error:'Invalid status'})
    if(supabase){
      const { data, error } = await supabase.from('orders').update({status,updated_at:new Date().toISOString()}).eq('id',orderId).select().single()
      if(error){ reportError(new Error('Status update failed: '+error.message), { orderId, status }); return res.status(500).json({ok:false,error:error.message}) }
      return res.json({ok:true,order:data})
    }
    for(const [,orders] of ORDERS_STORE){
      const o = orders.find(x=>x.id===orderId)
      if(o){ o.status=status; o.updatedAt=new Date().toISOString(); return res.json({ok:true,order:o}) }
    }
    res.status(404).json({ok:false,error:'Order not found'})
  }catch(e){ reportError(e); res.status(500).json({ok:false,error:String(e)}) }
})

// ─── Auth ─────────────────────────────────────────────────────────────────────
const COOKIE_ACCESS  = 'pheran_token'
const COOKIE_REFRESH = 'pheran_refresh'
const COOKIE_BASE    = { httpOnly:true, sameSite:'lax', path:'/' }

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
      if(!/[A-Z]/.test(password)||!/[0-9]/.test(password)) return res.status(400).json({ok:false,error:'Password must contain at least one uppercase letter and one number'})
      if(typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ok:false,error:'Invalid email address'})
      const{data,error}=await supabase.auth.signUp({ email: email.toLowerCase().trim(), password, options:{data:{firstName:String(firstName).slice(0,50),lastName:String(lastName).slice(0,50),phone:String(phone).slice(0,20)}} })
      if(error){
        // Anti-enumeration: "User already registered" returns identical success response
        // so attackers cannot discover which emails are registered
        const alreadyExists = error.status === 422 || /already registered/i.test(error.message||'')
        if(alreadyExists) return res.status(201).json({ ok:true, requiresVerification:true, message:'Check your email to verify your account before signing in.' })
        return res.status(400).json({ok:false,error:error.message})
      }
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

  // Exchange access+refresh tokens (from email confirmation hash) for httpOnly cookies.
  // Uses setSession which validates and rotates the refresh token (prevents replay).
  app.post('/api/auth/exchange', async(req,res)=>{
    const { access_token, refresh_token } = req.body || {}
    if(!access_token || !refresh_token) return res.status(400).json({ok:false,error:'Missing tokens'})
    try{
      const { data, error } = await supabase.auth.setSession({ access_token, refresh_token })
      if(error || !data?.session) return res.status(401).json({ok:false,error:'Invalid or expired token'})
      setSession(req, res, data.session)
      res.json({ok:true, user:fmtUser(data.user)})
    }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
  })

  // Backs the /verify page above — does the actual token_hash verification
  // server-to-server (Supabase's domain is never sent to the browser) and sets
  // the session cookie directly on success. Rate-limited via the /api/auth
  // prefix like every other auth endpoint, so this can't be brute-forced.
  app.post('/api/auth/verify', async(req,res)=>{
    try{
      const { token_hash, type } = req.body || {}
      if(!token_hash || !type || !_VALID_VERIFY_TYPES.has(type)) return res.status(400).json({ok:false,error:'Invalid verification request'})
      const { data, error } = await supabase.auth.verifyOtp({ token_hash, type })
      if(error || !data?.session) return res.status(401).json({ok:false,error:'This link has expired or was already used'})
      setSession(req, res, data.session)
      res.json({ok:true, user:fmtUser(data.user)})
    }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
  })

  // Silent refresh — called by client pages to renew access token using the httpOnly refresh cookie.
  // Rotates the refresh token on each use so stolen refresh tokens expire after one use.
  app.post('/api/auth/refresh', async(req,res)=>{
    const refresh = req.cookies?.[COOKIE_REFRESH]
    if(!refresh) return res.status(401).json({ok:false,error:'No refresh token'})
    try{
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refresh })
      if(error || !data?.session){ clearSession(res); return res.status(401).json({ok:false,error:'Session expired — please log in again'}) }
      setSession(req, res, data.session)
      res.json({ok:true, user:fmtUser(data.user)})
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
      if(firstName!==undefined) meta.firstName=String(firstName).slice(0,50)
      if(lastName!==undefined)  meta.lastName=String(lastName).slice(0,50)
      if(phone!==undefined)     meta.phone=String(phone).slice(0,20)
      const{data,error}=await supabase.auth.admin.updateUserById(user.id,{user_metadata:meta})
      if(error) return res.status(500).json({ok:false,error:error.message})
      res.json({ok:true, user:fmtUser(data.user)})
    }catch(e){ res.status(500).json({ok:false,error:String(e)}) }
  })

} else {
  // ── Fallback: bcrypt + users.json ────────────────────────────────────────
  console.log('[auth] Supabase not configured — using local users.json')
  const USERS_PATH = path.join(__dirname,'..','users.json')
  function loadUsers(){ try{ return JSON.parse(fs.readFileSync(USERS_PATH,'utf8')||'[]') }catch(e){ return [] } }
  function saveUsersList(u){ fs.writeFileSync(USERS_PATH,JSON.stringify(u,null,2),'utf8') }

  try{
    const bcrypt=require('bcryptjs'), jwt=require('jsonwebtoken')
    const sign=(u)=>jwt.sign({id:u.id,email:u.email},JWT_SECRET,{expiresIn:'30d',algorithm:'HS256'})
    const verify=(t)=>{ try{ return jwt.verify(t,JWT_SECRET,{algorithms:['HS256']}) }catch(e){ return null } }
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
        const _lens={firstName:50,lastName:50,phone:20}
        ;['firstName','lastName','phone'].forEach(k=>{ if(req.body[k]!==undefined) users[idx][k]=String(req.body[k]).slice(0,_lens[k]) })
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

// ─── Custom Order Config (admin-editable garments/fabrics/delivery) ───────────
const DEFAULT_CUSTOM_CONFIG = {
  garments: [
    { key:'dress', icon:'👗', label:'Dress', basePrice:35000 },
    { key:'blouse', icon:'👚', label:'Blouse', basePrice:22000 },
    { key:'trousers', icon:'👖', label:'Trousers', basePrice:24000 },
    { key:'skirt', icon:'🩱', label:'Skirt', basePrice:19000 },
    { key:'suit', icon:'🧥', label:'Co-ord Set', basePrice:65000 },
    { key:'gown', icon:'💃', label:'Evening Gown', basePrice:85000 }
  ],
  fabrics: [
    { key:'silk', icon:'🌟', label:'Silk Blend', priceAdd:8000 },
    { key:'linen', icon:'🍃', label:'Linen', priceAdd:3000 },
    { key:'cotton', icon:'☁️', label:'Cotton', priceAdd:2000 },
    { key:'ankara', icon:'🎨', label:'Ankara Print', priceAdd:4000 },
    { key:'aso-oke', icon:'👑', label:'Aso-oke', priceAdd:12000 },
    { key:'wool', icon:'🧶', label:'Wool Blend', priceAdd:7000 }
  ],
  delivery: {
    standardDays:'10–14 business days',
    standardDesc:'Our recommended timeframe for exceptional quality',
    standardLabel:'Standard',
    rushDays:'5–7 business days',
    rushDesc:'Priority handling by our lead tailors',
    rushLabel:'Rush',
    rushPercent:40
  }
}

function stripTags(str){
  return String(str==null?'':str).replace(/<[^>]*>/g,'').trim()
}

function sanitizeCustomConfig(body){
  const errors = []
  const garments = Array.isArray(body?.garments) ? body.garments : []
  const fabrics = Array.isArray(body?.fabrics) ? body.fabrics : []
  const delivery = (body && typeof body.delivery === 'object' && body.delivery) ? body.delivery : {}

  const seenGarmentKeys = new Set()
  const cleanGarments = garments.map((g, i) => {
    const key = stripTags(g?.key).toLowerCase().replace(/[^a-z0-9-]/g,'')
    const label = stripTags(g?.label).slice(0,60)
    const icon = stripTags(g?.icon).slice(0,8)
    const basePrice = Number(g?.basePrice)
    if(!key) errors.push(`Garment #${i+1}: missing key`)
    if(!label) errors.push(`Garment #${i+1}: missing label`)
    if(!Number.isFinite(basePrice) || basePrice < 0) errors.push(`Garment #${i+1}: invalid price`)
    if(key && seenGarmentKeys.has(key)) errors.push(`Garment #${i+1}: duplicate key "${key}"`)
    seenGarmentKeys.add(key)
    return { key, label, icon, basePrice: Number.isFinite(basePrice) ? Math.round(basePrice) : 0 }
  }).filter(g => g.key && g.label)

  const seenFabricKeys = new Set()
  const cleanFabrics = fabrics.map((f, i) => {
    const key = stripTags(f?.key).toLowerCase().replace(/[^a-z0-9-]/g,'')
    const label = stripTags(f?.label).slice(0,60)
    const icon = stripTags(f?.icon).slice(0,8)
    const priceAdd = Number(f?.priceAdd)
    if(!key) errors.push(`Fabric #${i+1}: missing key`)
    if(!label) errors.push(`Fabric #${i+1}: missing label`)
    if(!Number.isFinite(priceAdd) || priceAdd < 0) errors.push(`Fabric #${i+1}: invalid price`)
    if(key && seenFabricKeys.has(key)) errors.push(`Fabric #${i+1}: duplicate key "${key}"`)
    seenFabricKeys.add(key)
    return { key, label, icon, priceAdd: Number.isFinite(priceAdd) ? Math.round(priceAdd) : 0 }
  }).filter(f => f.key && f.label)

  const rushPercent = Number(delivery.rushPercent)
  const cleanDelivery = {
    standardDays: stripTags(delivery.standardDays).slice(0,60) || DEFAULT_CUSTOM_CONFIG.delivery.standardDays,
    standardDesc: stripTags(delivery.standardDesc).slice(0,200) || DEFAULT_CUSTOM_CONFIG.delivery.standardDesc,
    standardLabel: stripTags(delivery.standardLabel).slice(0,30) || DEFAULT_CUSTOM_CONFIG.delivery.standardLabel,
    rushDays: stripTags(delivery.rushDays).slice(0,60) || DEFAULT_CUSTOM_CONFIG.delivery.rushDays,
    rushDesc: stripTags(delivery.rushDesc).slice(0,200) || DEFAULT_CUSTOM_CONFIG.delivery.rushDesc,
    rushLabel: stripTags(delivery.rushLabel).slice(0,30) || DEFAULT_CUSTOM_CONFIG.delivery.rushLabel,
    rushPercent: Number.isFinite(rushPercent) && rushPercent >= 0 && rushPercent <= 500 ? Math.round(rushPercent) : DEFAULT_CUSTOM_CONFIG.delivery.rushPercent
  }

  if(!cleanGarments.length) errors.push('At least one garment type is required')
  if(!cleanFabrics.length) errors.push('At least one fabric type is required')

  return { garments: cleanGarments, fabrics: cleanFabrics, delivery: cleanDelivery, errors }
}

// Shared by the public GET endpoint below and by server-side order-price
// validation, so both always agree on the current garment/fabric/rush prices.
async function getCustomConfig() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('custom_config').select('*').eq('id',1).single()
      if (!error && data) {
        return { garments: data.garments||DEFAULT_CUSTOM_CONFIG.garments, fabrics: data.fabrics||DEFAULT_CUSTOM_CONFIG.fabrics, delivery: data.delivery||DEFAULT_CUSTOM_CONFIG.delivery }
      }
    } catch(e) { /* fall through to default */ }
  }
  return DEFAULT_CUSTOM_CONFIG
}

app.get('/api/custom-config', async (_req, res) => {
  const cfg = await getCustomConfig()
  res.json({ ok:true, ...cfg })
})

app.post('/api/custom-config', requireAdminAuth, async (req, res) => {
  try{
    const { garments, fabrics, delivery, errors } = sanitizeCustomConfig(req.body)
    if(errors.length) return res.status(400).json({ ok:false, error: errors.join('; ') })
    if(!supabase) return res.status(501).json({ ok:false, error:'Supabase not configured' })
    const { data, error } = await supabase.from('custom_config').upsert({ id:1, garments, fabrics, delivery, updated_at:new Date().toISOString() }).select().single()
    if(error) return res.status(500).json({ ok:false, error:error.message })
    res.json({ ok:true, garments:data.garments, fabrics:data.fabrics, delivery:data.delivery })
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) })
  }
})

// Health check
app.get('/api/health', (req,res)=>{
  try{
    const products = loadData()
    res.json({ ok:true, uptime: process.uptime(), products: products.length, cacheSize: PRODUCT_CACHE.size, ts: Date.now() })
  }catch(e){ res.status(500).json({ ok:false, error: String(e) }) }
})

// 404 — registered after every route/static handler above, so anything that
// reaches here genuinely doesn't exist. API callers get JSON; everyone else
// gets the branded page instead of Express's bare "Cannot GET /..." default.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Not found' })
  res.status(404).sendFile(path.join(_MVR, '404.html'))
})

// Reports anything that reaches Express's error-handling chain to Sentry, then
// passes it on to our own handler below to format the response. Most routes in
// this file catch their own errors and never reach here — see the explicit
// Sentry.captureException calls at the handful of business-critical call sites
// (order creation, payment/status updates) for those.
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app)

// Catch-all error handler — never leak stack traces / internals to clients
app.use((err, req, res, _next) => {
  console.error('[unhandled]', err)
  if (res.headersSent) return
  res.status(err.status || 500).json({ ok: false, error: 'Internal server error' })
})

const PORT = process.env.PORT || 4000
Promise.all([syncFromSupabase(), ensureStorageBucket()]).then(()=>{
  app.listen(PORT, ()=> console.log('PHERAN mock server running on port', PORT))
})
