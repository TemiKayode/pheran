const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, cookieJar } = require('./helpers')

let server

before(async () => { server = await startServer() })
after(async () => { await server.stop() })

test('register requires firstName, email and password', async () => {
  const res = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nofirstname@test.com', password: 'testpass123' }),
  })
  assert.equal(res.status, 400)
})

test('register rejects passwords under 8 characters', async () => {
  const res = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'A', email: 'short@test.com', password: 'short' }),
  })
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.match(body.error, /8 characters/)
})

test('register → login → /api/auth/me round trip', async () => {
  const email = `roundtrip-${Date.now()}@test.com`
  const jar = cookieJar()

  const reg = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Round', lastName: 'Trip', email, password: 'testpass123' }),
  })
  assert.equal(reg.status, 201)
  jar.capture(reg)

  const me = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { Cookie: jar.header() } })
  assert.equal(me.status, 200)
  const meBody = await me.json()
  assert.equal(meBody.user.email, email)
  assert.equal(meBody.user.firstName, 'Round')
})

test('duplicate registration is rejected', async () => {
  const email = `dupe-${Date.now()}@test.com`
  const payload = { firstName: 'Dupe', email, password: 'testpass123' }
  const first = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  assert.equal(first.status, 201)
  const second = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  assert.equal(second.status, 409)
})

test('login with wrong password is rejected', async () => {
  const email = `wrongpw-${Date.now()}@test.com`
  await fetch(`${server.baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Wrong', email, password: 'correctpass123' }),
  })
  const login = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'incorrectpass' }),
  })
  assert.equal(login.status, 401)
})

test('/api/auth/me without a session returns 401', async () => {
  const res = await fetch(`${server.baseUrl}/api/auth/me`)
  assert.equal(res.status, 401)
})

test('logout clears the session', async () => {
  const email = `logout-${Date.now()}@test.com`
  const jar = cookieJar()
  const reg = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Log', email, password: 'testpass123' }),
  })
  jar.capture(reg)

  const logout = await fetch(`${server.baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: jar.header() } })
  jar.capture(logout)
  assert.equal(logout.status, 200)

  const me = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { Cookie: jar.header() } })
  assert.equal(me.status, 401)
})

test('auth endpoints are rate-limited past 20 requests per window', async () => {
  const attempts = []
  for (let i = 0; i < 22; i++) {
    attempts.push(fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ratelimit-probe@test.com', password: 'wrong' }),
    }))
  }
  const results = await Promise.all(attempts)
  const statuses = results.map(r => r.status)
  assert.ok(statuses.includes(429), `expected at least one 429 among: ${statuses.join(',')}`)
})
