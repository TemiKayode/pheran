const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')
const fs = require('node:fs')

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

// Boots the real server.js as a child process in local-fallback auth mode
// (no SUPABASE_* vars) so the suite never touches production Supabase and
// needs no test-account credentials. Picks a free port per run so it can't
// collide with a dev server someone else already has running on 4000.
async function startServer(envOverrides = {}) {
  const port = await freePort()
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', SUPABASE_ANON_KEY: '',
      SENTRY_DSN: '',
      ADMIN_EMAIL: 'test-admin@pheran.ng',
      ADMIN_PIN: 'Test-Pin-9182',
      JWT_SECRET: 'test-suite-jwt-secret-not-for-production-use',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let out = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`)
      if (res.ok) break
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150))
  }

  return {
    baseUrl,
    adminEmail: 'test-admin@pheran.ng',
    adminPin: 'Test-Pin-9182',
    log: () => out,
    async stop() {
      child.kill()
      await new Promise(r => child.on('exit', r))
      // fallback auth mode writes real users to mvp/users.json (gitignored,
      // but keep the working tree clean of test accounts regardless)
      const usersPath = path.join(__dirname, '..', '..', 'users.json')
      try { fs.rmSync(usersPath, { force: true }) } catch (e) {}
    },
  }
}

// Basic cookie-jar so tests can carry a session across requests the same
// way a browser would, without pulling in an HTTP client dependency.
function cookieJar() {
  const jar = new Map()
  return {
    header() { return [...jar.values()].join('; ') },
    capture(res) {
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      for (const c of set) jar.set(c.split('=')[0], c.split(';')[0])
    },
  }
}

module.exports = { startServer, cookieJar }
