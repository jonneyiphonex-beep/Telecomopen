const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, 'public');
const OPENCELLID_ATTRIBUTION = {
  text: 'Cell tower data from OpenCellID, licensed under CC BY-SA 4.0.',
  source: 'https://opencellid.org',
  license: 'https://creativecommons.org/licenses/by-sa/4.0/',
};
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function parseBounds(value) {
  if (typeof value !== 'string') return null;
  const bounds = value.split(',').map(Number);
  if (bounds.length !== 4 || bounds.some((item) => !Number.isFinite(item))) return null;

  const [south, west, north, east] = bounds;
  const latitudeSpan = (north - south) * 111320;
  const longitudeSpan = (east - west) * 111320
    * Math.cos(((south + north) / 2) * Math.PI / 180);
  const valid = south < north && west < east
    && south >= 3 && north <= 23
    && west >= 21 && east <= 39
    && latitudeSpan * longitudeSpan <= 4_000_000;
  return valid ? bounds : null;
}

async function getCells(requestUrl, response) {
  const bounds = parseBounds(requestUrl.searchParams.get('bbox'));
  if (!bounds) {
    sendJson(response, 400, { error: 'نطاق الخريطة غير صالح أو خارج السودان.' });
    return;
  }

  const apiKey = process.env.OPENCELLID_API_KEY;
  if (!apiKey) {
    sendJson(response, 503, {
      error: 'أضف مفتاح OpenCellID إلى OPENCELLID_API_KEY في ملف .env لتفعيل بيانات الخلايا.',
    });
    return;
  }

  const upstreamUrl = new URL('https://opencellid.org/cell/getInArea');
  upstreamUrl.searchParams.set('key', apiKey);
  upstreamUrl.searchParams.set('BBOX', bounds.join(','));
  upstreamUrl.searchParams.set('mcc', '634');
  upstreamUrl.searchParams.set('limit', '50');
  upstreamUrl.searchParams.set('offset', '0');
  upstreamUrl.searchParams.set('format', 'json');

  try {
    const upstream = await fetch(upstreamUrl, { signal: AbortSignal.timeout(15000) });
    const body = await upstream.text();
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      sendJson(response, 502, { error: 'استجابة OpenCellID ليست بصيغة JSON متوقعة.' });
      return;
    }

    if (!upstream.ok || (data && data.error)) {
      const code = Number(data?.code);
      const status = upstream.status === 429 || code === 7 ? 429 : 502;
      const error = code === 2
        ? 'مفتاح OpenCellID غير صالح. تحقق من OPENCELLID_API_KEY.'
        : code === 3
          ? 'رفض OpenCellID نطاق البحث أو بيانات الطلب.'
          : status === 429
            ? 'تم بلوغ الحد اليومي لطلبات OpenCellID.'
            : 'تعذر جلب بيانات الخلايا من OpenCellID. تحقق من المفتاح وحاول مجددًا.';
      sendJson(response, status, { error, code: Number.isFinite(code) ? code : undefined });
      return;
    }

    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.cells)) {
      sendJson(response, 502, { error: 'استجابة OpenCellID لا تحتوي على قائمة خلايا متوقعة.' });
      return;
    }

    sendJson(response, 200, { ...data, attribution: OPENCELLID_ATTRIBUTION });
  } catch {
    sendJson(response, 504, { error: 'انتهت مهلة الاتصال بـ OpenCellID.' });
  }
}

function createServer() {
  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');

    if (request.method === 'GET' && requestUrl.pathname === '/api/cells') {
      getCells(requestUrl, response);
      return;
    }

    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' });
      response.end('Method not allowed');
      return;
    }

    const relativePath = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
    const filePath = path.resolve(root, relativePath);
    if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== path.join(root, 'index.html')) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, contents) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500);
        response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
        return;
      }
      response.writeHead(200, {
        'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      });
      response.end(contents);
    });
  });
}

if (require.main === module) {
  loadEnvFile();
  const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }

  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Telecomopen is running at http://localhost:${server.address().port}`);
  });
}

module.exports = { createServer, parseBounds };