const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer } = require('./helpers')

let server

before(async () => { server = await startServer() })
after(async () => { await server.stop() })

function basicAuthHeader(email, pin) {
  return 'Basic ' + Buffer.from(`${email}:${pin}`).toString('base64')
}

test('admin routes reject requests with no credentials', async () => {
  const res = await fetch(`${server.baseUrl}/api/admin/orders`)
  assert.equal(res.status, 401)
})

test('admin routes reject an incorrect PIN', async () => {
  const res = await fetch(`${server.baseUrl}/api/admin/orders`, {
    headers: { Authorization: basicAuthHeader(server.adminEmail, 'wrong-pin-entirely') },
  })
  assert.equal(res.status, 401)
})

test('admin routes accept the correct email + PIN', async () => {
  const res = await fetch(`${server.baseUrl}/api/admin/orders`, {
    headers: { Authorization: basicAuthHeader(server.adminEmail, server.adminPin) },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
})

test('admin login endpoint issues a session cookie usable for subsequent requests', async () => {
  const login = await fetch(`${server.baseUrl}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: server.adminEmail, pin: server.adminPin }),
  })
  assert.equal(login.status, 200)
  const setCookie = login.headers.getSetCookie()[0]
  const cookie = setCookie.split(';')[0]

  const orders = await fetch(`${server.baseUrl}/api/admin/orders`, { headers: { Cookie: cookie } })
  assert.equal(orders.status, 200)
})

test('a non-admin\'s customer session cannot access admin routes', async () => {
  const email = `notadmin-${Date.now()}@test.com`
  const reg = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Not', email, password: 'testpass123' }),
  })
  const cookie = reg.headers.getSetCookie()[0].split(';')[0]
  const res = await fetch(`${server.baseUrl}/api/admin/orders`, { headers: { Cookie: cookie } })
  assert.equal(res.status, 401)
})

test('/api/health-ip reports the resolved client IP for verifying proxy hop config', async () => {
  const res = await fetch(`${server.baseUrl}/api/health-ip`, {
    headers: { Authorization: basicAuthHeader(server.adminEmail, server.adminPin) },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok('resolved' in body && 'trustProxyHops' in body)
})

test('CSV export neutralizes formula-injection payloads in customer-supplied fields', async () => {
  await fetch(`${server.baseUrl}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ id: 'two-piece-mono-peplum', qty: 1 }],
      shipping: { firstName: '=cmd|\'/c calc\'!A1', lastName: 'Injector' },
    }),
  })
  const res = await fetch(`${server.baseUrl}/api/admin/orders/export`, {
    headers: { Authorization: basicAuthHeader(server.adminEmail, server.adminPin) },
  })
  assert.equal(res.status, 200)
  const csv = await res.text()
  assert.ok(csv.includes('Injector'), 'exported order should be present')
  // A raw leading "=" would execute as a formula in Excel/Sheets — must be
  // neutralized with a leading apostrophe (inside the quoted CSV cell).
  assert.doesNotMatch(csv, /,"?=cmd/, 'formula-injection payload must be neutralized, not passed through raw')
})

// Must run last in this file — it deliberately exhausts this IP's admin-auth
// failure budget, which would make every subsequent test in the file see 429
// instead of the response it's actually testing for.
test('repeated bad credentials lock out the admin guard, not just /api/admin/login', async () => {
  // requireAdminAuth also accepts Authorization: Basic on ~10 other routes —
  // the lockout has to live in the guard itself or those routes stay an
  // unlimited-attempt brute-force surface regardless of the login route's limit.
  const attempts = []
  for (let i = 0; i < 11; i++) {
    attempts.push(fetch(`${server.baseUrl}/api/cache-metrics`, {
      headers: { Authorization: basicAuthHeader(server.adminEmail, `wrong-pin-${i}`) },
    }))
  }
  const results = await Promise.all(attempts)
  const statuses = results.map(r => r.status)
  assert.ok(statuses.includes(429), `expected a 429 after repeated failures, got: ${statuses.join(',')}`)

  // Locked out even with the CORRECT pin now — this IP's budget is spent
  const correct = await fetch(`${server.baseUrl}/api/cache-metrics`, {
    headers: { Authorization: basicAuthHeader(server.adminEmail, server.adminPin) },
  })
  assert.equal(correct.status, 429)
})
