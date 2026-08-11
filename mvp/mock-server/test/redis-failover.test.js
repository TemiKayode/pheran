const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer } = require('./helpers')

// Regression test for a real High-severity finding: windowedCount() used to
// return 0 ("not limited yet") on any Redis error, which silently took the
// admin brute-force lockout completely offline for the duration of any Redis
// outage — demonstrated directly against a live server: 15 wrong-PIN requests
// against a dead Redis connection produced zero 429s. The fix falls through
// to the same in-memory Map used when Redis isn't configured at all, so this
// boots with REDIS_URL pointing at a port nothing is listening on and asserts
// the lockout still engages.
let server

before(async () => { server = await startServer({ REDIS_URL: 'redis://127.0.0.1:19999' }) })
after(async () => { await server.stop() })

function basicAuthHeader(email, pin) {
  return 'Basic ' + Buffer.from(`${email}:${pin}`).toString('base64')
}

test('admin lockout still engages when REDIS_URL is set but unreachable', async () => {
  const attempts = []
  for (let i = 0; i < 11; i++) {
    attempts.push(fetch(`${server.baseUrl}/api/cache-metrics`, {
      headers: { Authorization: basicAuthHeader(server.adminEmail, `wrong-${i}`) },
    }))
  }
  const results = await Promise.all(attempts)
  const statuses = results.map(r => r.status)
  assert.ok(statuses.includes(429), `expected a 429 despite Redis being unreachable, got: ${statuses.join(',')}`)
})

test('a rate-limited route still resolves reasonably quickly despite the dead Redis connection', async () => {
  // /api/auth/login routes through windowedCount(), which is what actually
  // talks to Redis — a plain /api/health request wouldn't exercise the
  // timeout path this is guarding at all.
  const start = Date.now()
  await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'timing-probe@test.com', password: 'wrong' }),
  })
  const elapsed = Date.now() - start
  // Generous bound — this isn't a strict perf test, just a guard against the
  // multi-second stalls the unbounded maxRetriesPerRequest/commandTimeout
  // defaults produced before those were tuned down.
  assert.ok(elapsed < 3000, `expected a fast response despite Redis being down, took ${elapsed}ms`)
})
