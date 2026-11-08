const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createServer, parseBounds } = require('../server');

let server;
let baseUrl;
let originalApiKey;

before(async () => {
  originalApiKey = process.env.OPENCELLID_API_KEY;
  delete process.env.OPENCELLID_API_KEY;
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (originalApiKey === undefined) delete process.env.OPENCELLID_API_KEY;
  else process.env.OPENCELLID_API_KEY = originalApiKey;
});

test('accepts a Sudan search area within the OpenCellID area limit', () => {
  assert.deepEqual(parseBounds('15.492,32.5517,15.508,32.5683'), [15.492, 32.5517, 15.508, 32.5683]);
});

test('rejects malformed, out-of-country, and oversized search areas', () => {
  assert.equal(parseBounds('not,a,bbox'), null);
  assert.equal(parseBounds('37.7,-122.5,37.8,-122.4'), null);
  assert.equal(parseBounds('15,32,15.2,32.2'), null);
});

test('serves the map page', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
});

test('rejects invalid API bounds before checking API configuration', async () => {
  const response = await fetch(`${baseUrl}/api/cells?bbox=15,32,15.2,32.2`);
  assert.equal(response.status, 400);
});

test('reports a missing API key for valid bounds', async () => {
  const response = await fetch(`${baseUrl}/api/cells?bbox=15.492,32.5517,15.508,32.5683`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /OPENCELLID_API_KEY/);
});

test('proxies OpenCellID data and includes required attribution', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENCELLID_API_KEY;
  process.env.OPENCELLID_API_KEY = 'test-key';
  let upstreamUrl;
  globalThis.fetch = async (input) => {
    upstreamUrl = new URL(input);
    return new Response(JSON.stringify({ count: 1, cells: [{ lat: 15.5, lon: 32.5 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/cells?bbox=15.492,32.5517,15.508,32.5683`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(upstreamUrl.pathname, '/cell/getInArea');
    assert.equal(upstreamUrl.searchParams.get('mcc'), '634');
    assert.equal(upstreamUrl.searchParams.get('limit'), '50');
    assert.equal(upstreamUrl.searchParams.get('key'), 'test-key');
    assert.equal(data.cells.length, 1);
    assert.equal(data.attribution.license, 'https://creativecommons.org/licenses/by-sa/4.0/');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENCELLID_API_KEY;
    else process.env.OPENCELLID_API_KEY = originalKey;
  }
});

test('handles OpenCellID daily-limit errors returned with HTTP 200', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENCELLID_API_KEY;
  process.env.OPENCELLID_API_KEY = 'test-key';
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Daily limit exceeded', code: 7 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const response = await originalFetch(`${baseUrl}/api/cells?bbox=15.492,32.5517,15.508,32.5683`);
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, /الحد اليومي/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENCELLID_API_KEY;
    else process.env.OPENCELLID_API_KEY = originalKey;
  }
});

test('rejects unsupported request methods', async () => {
  const response = await fetch(baseUrl, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});
