const cookie = require('cookie');
const Redis = require('ioredis');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SESSION_SECRET || 'design-sreda-secret-2026';
const REDIS_URL = process.env.REDIS_URL || '';
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';

let redis = null;
function getRedis() {
  if (!redis && REDIS_URL) {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, connectTimeout: 5000, lazyConnect: true });
  }
  return redis;
}

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

async function readJSON(name) {
  const r = getRedis();
  if (r) {
    await r.connect().catch(() => {});
    const raw = await r.get(`ds:${name}`);
    if (raw) return JSON.parse(raw);
    const def = JSON.parse(JSON.stringify(DEFAULTS[name]));
    await r.set(`ds:${name}`, JSON.stringify(def));
    return def;
  }
  return JSON.parse(JSON.stringify(DEFAULTS[name]));
}

async function writeJSON(name, data) {
  const r = getRedis();
  if (r) {
    await r.connect().catch(() => {});
    await r.set(`ds:${name}`, JSON.stringify(data));
  }
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

async function blobPut(filename, fileData) {
  const r = getRedis();
  if (r) {
    await r.connect().catch(() => {});
    const b64 = fileData.toString('base64');
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf' };
    const ct = mime[filename.split('.').pop().toLowerCase()] || 'application/octet-stream';
    await r.set(`ds:file:${filename}`, b64);
    await r.rpush('ds:filelist', JSON.stringify({ name: filename, url: `/api/uploads/${filename}`, contentType: ct }));
    return { url: `/api/uploads/${filename}`, filename };
  }
  return { url: '', filename };
}

async function blobList() {
  const r = getRedis();
  if (r) {
    await r.connect().catch(() => {});
    const list = await r.lrange('ds:filelist', 0, -1);
    return list.map(s => JSON.parse(s));
  }
  return [];
}

async function blobDelete(filename) {
  const r = getRedis();
  if (r) {
    await r.connect().catch(() => {});
    await r.del(`ds:file:${filename}`);
    const list = await r.lrange('ds:filelist', 0, -1);
    for (const item of list) {
      const parsed = JSON.parse(item);
      if (parsed.name === filename) {
        await r.lrem('ds:filelist', 1, item);
        break;
      }
    }
  }
}

async function blobGet(filename) {
  const r = getRedis();
  if (r) {
    await r.connect().catch(() => {});
    const b64 = await r.get(`ds:file:${filename}`);
    if (!b64) return null;
    const list = await r.lrange('ds:filelist', 0, -1);
    let ct = 'application/octet-stream';
    for (const item of list) {
      const parsed = JSON.parse(item);
      if (parsed.name === filename && parsed.contentType) { ct = parsed.contentType; break; }
    }
    return { data: Buffer.from(b64, 'base64'), contentType: ct };
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

    if (path === '/content/public' && method === 'GET') {
      return json(res, 200, await readJSON('content'));
    }

    if (path === '/content/public/:page' && method === 'GET') {
      const content = await readJSON('content');
      const page = content[req.url.split('/').pop()];
      if (page) return json(res, 200, page);
      return json(res, 404, { error: 'Page not found' });
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

    if (path === '/works/public' && method === 'GET') {
      return json(res, 200, await readJSON('works'));
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

    const fileServeMatch = path.match(/^\/uploads\/(.+)$/);
    if (fileServeMatch && method === 'GET') {
      const filename = fileServeMatch[1];
      const file = await blobGet(filename);
      if (!file) return json(res, 404, { error: 'File not found' });
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(file.data);
      return;
    }

    if (path === '/uploads' && method === 'GET') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      const files = await blobList();
      return json(res, 200, files);
    }

    if (fileServeMatch && method === 'DELETE') {
      if (!authCheck(req)) return json(res, 401, { error: 'Unauthorized' });
      await blobDelete(fileServeMatch[1]);
      return json(res, 200, { success: true });
    }

    if (path === '/send' && method === 'POST') {
      const buf = await readBody(req);
      const { name, text } = JSON.parse(buf.toString());
      if (!text) return json(res, 400, { error: 'No text' });

      const hasToken = !!TG_BOT_TOKEN;
      const hasChat = !!TG_CHAT_ID;
      console.log('[send] token set:', hasToken, '| chat set:', hasChat);

      if (hasToken && hasChat) {
        try {
          const tgRes = await fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TG_CHAT_ID, text: text })
          });
          const tgBody = await tgRes.text();
          console.log('[send] tg response:', tgRes.status, tgBody);
          if (!tgRes.ok) {
            return json(res, 502, { error: 'Telegram API error', details: tgBody });
          }
        } catch (e) {
          console.error('[send] fetch failed:', e.message);
          return json(res, 502, { error: 'Failed to reach Telegram' });
        }
      } else {
        console.error('[send] missing env vars — token:', hasToken, 'chat:', hasChat);
        return json(res, 500, { error: 'TG_BOT_TOKEN or TG_CHAT_ID not configured', tokenSet: hasToken, chatSet: hasChat });
      }

      return json(res, 200, { success: true });
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
};
