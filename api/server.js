const cookie = require('cookie');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SESSION_SECRET || 'design-sreda-secret-2026';
const KV_URL = process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';

const DEFAULTS = {
  content: require('../data/content.json'),
  works: require('../data/works.json'),
  calculator: require('../data/calculator.json')
};

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((obj, c) => {
    const [k, ...v] = c.split('=');
    obj[k.trim()] = decodeURIComponent(v.join('='));
    return obj;
  }, {});
}

function authCheck(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.admin_token === simpleHash(SECRET);
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function json(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function kvGet(key) {
  if (!KV_URL) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const data = await res.json();
  return data.result ?? null;
}

async function kvSet(key, value) {
  if (!KV_URL) return;
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
}

async function readJSON(name) {
  const data = await kvGet(name);
  if (data) return data;
  if (DEFAULTS[name]) {
    if (KV_URL) await kvSet(name, DEFAULTS[name]);
    return JSON.parse(JSON.stringify(DEFAULTS[name]));
  }
  return null;
}

async function writeJSON(name, data) {
  if (KV_URL) {
    await kvSet(name, data);
  }
}

async function blobPut(filename, fileData) {
  if (!BLOB_TOKEN) return { url: '' };
  const res = await fetch(`https://blob.vercel-storage.com/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BLOB_TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'x-api-config': JSON.stringify({ access: 'public' })
    },
    body: fileData
  });
  return res.json();
}

async function blobList() {
  if (!BLOB_TOKEN) return { blobs: [] };
  const res = await fetch('https://blob.vercel-storage.com', {
    headers: { Authorization: `Bearer ${BLOB_TOKEN}` }
  });
  return res.json();
}

async function blobDelete(url) {
  if (!BLOB_TOKEN) return;
  await fetch('https://blob.vercel-storage.com', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${BLOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ urls: [url] })
  });
}

function parseMultipart(buffer, boundary) {
  const parts = buffer.toString('binary').split('--' + boundary);
  for (const part of parts) {
    const fileMatch = part.match(/filename="(.+?)"/);
    if (fileMatch) {
      const ext = fileMatch[1].split('.').pop();
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const raw = part.substring(headerEnd + 4);
      const clean = raw.replace(/\r\n--$/, '').replace(/\r\n$/, '');
      return { filename: fileMatch[1], ext, data: Buffer.from(clean, 'binary') };
    }
  }
  return null;
}

module.exports = async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  let path = url.pathname;
  if (path.startsWith('/api/')) path = path.slice(4);
  else if (path.startsWith('/api')) path = path.slice(4);
  if (!path.startsWith('/')) path = '/' + path;

  const method = req.method;

  try {
    if (path === '/login' && method === 'POST') {
      const buf = await readBody(req);
      const { password } = JSON.parse(buf.toString());
      if (password === ADMIN_PASSWORD) {
        res.setHeader('Set-Cookie', cookie.serialize('admin_token', simpleHash(SECRET), { httpOnly: true, maxAge: 86400000, path: '/' }));
        return json(res, 200, { success: true });
      }
      return json(res, 401, { error: 'Wrong password' });
    }

    if (path === '/logout' && method === 'POST') {
      res.setHeader('Set-Cookie', cookie.serialize('admin_token', '', { httpOnly: true, maxAge: 0, path: '/' }));
      return json(res, 200, { success: true });
    }

    if (path === '/check-auth' && method === 'GET') {
      return json(res, 200, { authenticated: authCheck(req) });
    }

    if (path === '/content' && method === 'GET') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      return json(res, 200, await readJSON('content'));
    }

    if (path === '/content' && method === 'PUT') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const buf = await readBody(req);
      await writeJSON('content', JSON.parse(buf.toString()));
      return json(res, 200, { success: true });
    }

    const contentPageMatch = path.match(/^\/content\/(.+)$/);
    if (contentPageMatch && method === 'GET') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const content = await readJSON('content');
      const page = content[contentPageMatch[1]];
      if (page) return json(res, 200, page);
      return json(res, 404, { error: 'Page not found' });
    }

    if (contentPageMatch && method === 'PUT') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const buf = await readBody(req);
      const content = await readJSON('content');
      content[contentPageMatch[1]] = JSON.parse(buf.toString());
      await writeJSON('content', content);
      return json(res, 200, { success: true });
    }

    if (path === '/works' && method === 'GET') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      return json(res, 200, await readJSON('works'));
    }

    if (path === '/works' && method === 'POST') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const buf = await readBody(req);
      const works = await readJSON('works');
      const maxId = works.works.reduce((max, w) => Math.max(max, w.id), 0);
      const newWork = { ...JSON.parse(buf.toString()), id: maxId + 1 };
      works.works.push(newWork);
      await writeJSON('works', works);
      return json(res, 200, newWork);
    }

    const workIdMatch = path.match(/^\/works\/(\d+)$/);
    if (workIdMatch && method === 'GET') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const works = await readJSON('works');
      const work = works.works.find(w => w.id === Number(workIdMatch[1]));
      if (work) return json(res, 200, work);
      return json(res, 404, { error: 'Work not found' });
    }

    if (workIdMatch && method === 'PUT') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const buf = await readBody(req);
      const works = await readJSON('works');
      const idx = works.works.findIndex(w => w.id === Number(workIdMatch[1]));
      if (idx === -1) return json(res, 404, { error: 'Work not found' });
      works.works[idx] = { ...works.works[idx], ...JSON.parse(buf.toString()), id: Number(workIdMatch[1]) };
      await writeJSON('works', works);
      return json(res, 200, works.works[idx]);
    }

    if (workIdMatch && method === 'DELETE') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const works = await readJSON('works');
      works.works = works.works.filter(w => w.id !== Number(workIdMatch[1]));
      await writeJSON('works', works);
      return json(res, 200, { success: true });
    }

    if (path === '/calculator' && method === 'GET') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      return json(res, 200, await readJSON('calculator'));
    }

    if (path === '/calculator' && method === 'PUT') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const buf = await readBody(req);
      await writeJSON('calculator', JSON.parse(buf.toString()));
      return json(res, 200, { success: true });
    }

    if (path === '/upload' && method === 'POST') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) return json(res, 400, { error: 'No boundary' });
      const buf = await readBody(req);
      const file = parseMultipart(buf, boundaryMatch[1]);
      if (!file) return json(res, 400, { error: 'No file' });
      const blobName = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + file.ext;
      const blob = await blobPut(blobName, file.data);
      return json(res, 200, { url: blob.url || '', filename: blobName });
    }

    if (path === '/uploads' && method === 'GET') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const data = await blobList();
      const blobs = data.blobs || [];
      return json(res, 200, blobs.map(b => ({ name: b.pathname, url: b.url })));
    }

    const uploadDeleteMatch = path.match(/^\/uploads\/(.+)$/);
    if (uploadDeleteMatch && method === 'DELETE') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      await blobDelete(decodeURIComponent(uploadDeleteMatch[1]));
      return json(res, 200, { success: true });
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
};
