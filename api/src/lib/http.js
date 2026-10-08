/*
 * Response helpers and the one error type every handler throws. route() turns
 * an HttpError into its status and anything else into a logged 500, so a
 * handler never has to build an error response by hand.
 */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Every response from this API is about one person's order or one member of
// staff. None of it may sit in a shared cache, and none of it is for crawlers.
const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const json = (status, body, headers = {}) => ({
  status,
  jsonBody: body,
  headers: { ...BASE_HEADERS, ...headers },
});

/**
 * The request body as an object. Mutations must arrive as application/json:
 * a cross-site HTML form cannot send that content type without a CORS
 * preflight this API never answers, which, with the SameSite=Strict session
 * cookie, is the CSRF defence.
 */
async function body(req) {
  const type = req.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  let data;
  try {
    data = await req.json();
  } catch {
    throw new HttpError(400, 'That request body is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Expected a JSON object.');
  return data;
}

/** Wrap a handler: HttpError -> its status, anything else -> 500. */
const route = (fn) => async (req, ctx) => {
  try {
    return await fn(req, ctx);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    ctx.error(e);
    return json(500, { error: 'Something went wrong on our side. Try again in a minute.' });
  }
};

module.exports = { HttpError, json, body, route };
