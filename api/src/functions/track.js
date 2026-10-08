/*
 * GET /api/track/{code} — the public tracking lookup behind /track/.
 *
 * No account, no cookie. A malformed code and an unknown one get the same 404
 * so the response says nothing about which codes exist.
 */
const { app } = require('@azure/functions');
const { json, route, HttpError } = require('../lib/http');
const store = require('../lib/store');
const orders = require('../lib/orders');

async function track(req) {
  const code = orders.parseCode(req.params.code);
  const NOT_FOUND = 'No order with that tracking code. Check it against your message from us.';
  if (!code) throw new HttpError(404, NOT_FOUND);

  const { orders: table } = await store.tables();
  const e = await store.get(table, store.ORDER_PK, code);
  if (!e) throw new HttpError(404, NOT_FOUND);
  return json(200, orders.publicView(e));
}

app.http('track', { methods: ['GET'], authLevel: 'anonymous', route: 'track/{code}', handler: route(track) });

module.exports = { track };
