// Load test for a single PHERAN server instance — answers "how many
// concurrent users can one instance actually serve" so replica counts for
// Railway can be sized from a real number instead of a guess.
//
// Usage: node loadtest/run.js [baseUrl]
//   Defaults to spawning the app itself on a free local port so this can be
//   run with zero setup. Pass a URL (e.g. a Railway deploy) to test that
//   instead — in which case nothing is spawned locally.
//
// /api/auth and /api/orders are deliberately excluded from the sustained
// throughput runs: both are IP-rate-limited (20/60 requests per 15 min),
// so a single-machine load test would just measure the rate limiter, not
// server capacity. They get a short, low-connection-count smoke run instead,
// capped comfortably under the limit, just to confirm they respond correctly
// under a little concurrency.
const autocannon = require('autocannon')
const path = require('node:path')
const { startServer } = require('../test/helpers')

function run(opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(opts, (err, result) => err ? reject(err) : resolve(result))
    autocannon.track(instance, { renderProgressBar: false })
  })
}

function summarize(label, result) {
  console.log(`\n=== ${label} ===`)
  console.log(`  requests/sec : ${result.requests.average.toFixed(1)} avg (${result.requests.p99} p99 total over run)`)
  console.log(`  latency (ms) : avg ${result.latency.average.toFixed(1)} | p50 ${result.latency.p50} | p99 ${result.latency.p99} | max ${result.latency.max}`)
  console.log(`  throughput   : ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s`)
  console.log(`  errors       : ${result.errors} | timeouts: ${result.timeouts} | non-2xx: ${result['2xx'] !== result.requests.total ? result.requests.total - result['2xx'] : 0}`)
  return result
}

async function main() {
  const providedUrl = process.argv[2]
  let server = null
  let baseUrl = providedUrl

  if (!baseUrl) {
    console.log('No URL given — spawning a local instance to test...')
    server = await startServer()
    baseUrl = server.baseUrl
    console.log(`Local instance up at ${baseUrl}\n`)
  } else {
    console.log(`Testing external target: ${baseUrl}\n`)
  }

  try {
    const catalog = await run({
      url: `${baseUrl}/api/products?perPage=50`,
      connections: 100,
      duration: 20,
      title: 'catalog browsing',
    })
    summarize('GET /api/products (catalog browsing, 100 concurrent, 20s)', catalog)

    const homepage = await run({
      url: `${baseUrl}/`,
      connections: 100,
      duration: 20,
      title: 'homepage',
    })
    summarize('GET / (homepage, 100 concurrent, 20s)', homepage)

    const health = await run({
      url: `${baseUrl}/api/health`,
      connections: 50,
      duration: 10,
      title: 'health',
    })
    summarize('GET /api/health (50 concurrent, 10s)', health)

    // Kept well under the 20-per-15-min auth limit and 60-per-15-min mutation
    // limit — this confirms the endpoint behaves correctly under a little
    // concurrency, not how many requests/sec it can sustain (it's rate-limited
    // by design, so "as many as possible" isn't the right question here).
    const authSmoke = await run({
      url: `${baseUrl}/api/auth/me`,
      connections: 5,
      amount: 10,
      title: 'auth smoke',
    })
    summarize('GET /api/auth/me (5 concurrent, 10 requests — smoke only, not a throughput test)', authSmoke)

    console.log('\nDone. Compare "catalog browsing" req/s against your expected peak concurrent browsers')
    console.log('per instance, then multiply Railway replicas accordingly — that endpoint is representative')
    console.log('of real traffic shape (most visitors browse far more than they checkout).')
  } finally {
    if (server) await server.stop()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
