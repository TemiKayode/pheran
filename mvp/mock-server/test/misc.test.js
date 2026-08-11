const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer } = require('./helpers')

let server

before(async () => { server = await startServer() })
after(async () => { await server.stop() })

test('health check reports ok with product catalog loaded', async () => {
  const res = await fetch(`${server.baseUrl}/api/health`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.ok(body.products > 0, 'catalog should have products loaded')
})

test('unknown API route returns a JSON 404, not an HTML page', async () => {
  const res = await fetch(`${server.baseUrl}/api/this-route-does-not-exist`)
  assert.equal(res.status, 404)
  assert.match(res.headers.get('content-type') || '', /application\/json/)
})

test('unknown non-API route serves the branded 404 page', async () => {
  const res = await fetch(`${server.baseUrl}/this-page-does-not-exist`)
  assert.equal(res.status, 404)
  assert.match(res.headers.get('content-type') || '', /text\/html/)
})

test('product listing endpoint returns the seeded catalog', async () => {
  const res = await fetch(`${server.baseUrl}/api/products?perPage=200`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(Array.isArray(body.products))
  assert.ok(body.products.some(p => p.id === 'two-piece-mono-peplum'))
})

test('security headers are present on every response', async () => {
  const res = await fetch(`${server.baseUrl}/api/health`)
  assert.ok(res.headers.get('content-security-policy'), 'CSP header should be set')
})
