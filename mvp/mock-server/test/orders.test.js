const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer } = require('./helpers')

let server
const REAL_PRODUCT_ID = 'two-piece-mono-peplum'
const REAL_PRICE = 48000

before(async () => { server = await startServer() })
after(async () => { await server.stop() })

async function placeOrder(items, extra = {}) {
  return fetch(`${server.baseUrl}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, shipping: { firstName: 'Test', lastName: 'Buyer' }, ...extra }),
  })
}

test('order pricing is derived from the catalog, not the client', async () => {
  const res = await placeOrder([{ id: REAL_PRODUCT_ID, qty: 1 }])
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.order.items[0].price, REAL_PRICE)
  assert.equal(body.order.subtotal, REAL_PRICE)
})

test('a client-supplied price on a real product is ignored (tamper resistance)', async () => {
  const res = await placeOrder([{ id: REAL_PRODUCT_ID, qty: 1, price: 1 }])
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.order.items[0].price, REAL_PRICE, 'server must not trust the client-supplied price')
})

test('unknown product id is rejected outright', async () => {
  const res = await placeOrder([{ id: 'not-a-real-product', qty: 1 }])
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.match(body.error, /Unknown product/)
})

test('quantity is clamped to a sane range regardless of client input', async () => {
  const res = await placeOrder([{ id: REAL_PRODUCT_ID, qty: 99999 }])
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.ok(body.order.items[0].qty <= 20, `qty should be clamped, got ${body.order.items[0].qty}`)
})

test('empty cart is rejected', async () => {
  const res = await placeOrder([])
  assert.equal(res.status, 400)
})

test('more than 50 line items is rejected', async () => {
  const items = Array.from({ length: 51 }, () => ({ id: REAL_PRODUCT_ID, qty: 1 }))
  const res = await placeOrder(items)
  assert.equal(res.status, 400)
})

test('free delivery applies at the ₦100,000 subtotal threshold, standard fee below it', async () => {
  const below = await placeOrder([{ id: REAL_PRODUCT_ID, qty: 1 }]) // 48,000
  const belowBody = await below.json()
  assert.equal(belowBody.order.deliveryFee, 1500)

  const above = await placeOrder([{ id: REAL_PRODUCT_ID, qty: 3 }]) // 144,000
  const aboveBody = await above.json()
  assert.equal(aboveBody.order.deliveryFee, 0)
})

test('express delivery always charges the flat express fee', async () => {
  const res = await placeOrder([{ id: REAL_PRODUCT_ID, qty: 3 }], { deliveryMethod: 'express' })
  const body = await res.json()
  assert.equal(body.order.deliveryFee, 3500)
})

test("custom order line derives price from the garment/fabric config, not the client", async () => {
  const res = await placeOrder([{ id: 'custom', qty: 1, garmentKey: 'not-a-real-garment', fabricKey: 'also-fake', price: 1 }])
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.match(body.error, /Invalid custom-order selection/)
})

test('an anonymous order cannot list another user\'s orders — only own session sees it', async () => {
  const placed = await placeOrder([{ id: REAL_PRODUCT_ID, qty: 1 }])
  assert.equal(placed.status, 201)
  // No session cookie was sent, so this is an anonymous order — GET /api/orders
  // without a session must not return anyone's order history.
  const list = await fetch(`${server.baseUrl}/api/orders`)
  const listBody = await list.json()
  assert.equal(listBody.orders.length, 0)
})
