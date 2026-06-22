const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SESSION_SECRET || 'design-sreda-secret-2026';

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

function readJSON(name) {
  const p = path.join(DATA_DIR, name + '.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function writeJSON(name, data) {
  const p = path.join(DATA_DIR, name + '.json');
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function authCheck(req, res, next) {
  const token = req.cookies && req.cookies.admin_token;
  if (token === simpleHash(SECRET)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/admin/login.html');
}

app.use(express.static(__dirname));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/data', express.static(DATA_DIR));

app.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie('admin_token', simpleHash(SECRET), {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    });
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

app.get('/api/check-auth', (req, res) => {
  const token = req.cookies && req.cookies.admin_token;
  res.json({ authenticated: token === simpleHash(SECRET) });
});

app.get('/api/content', authCheck, (req, res) => {
  res.json(readJSON('content'));
});

app.put('/api/content', authCheck, (req, res) => {
  writeJSON('content', req.body);
  res.json({ success: true });
});

app.get('/api/content/:page', authCheck, (req, res) => {
  const content = readJSON('content');
  if (content[req.params.page]) {
    return res.json(content[req.params.page]);
  }
  res.status(404).json({ error: 'Page not found' });
});

app.put('/api/content/:page', authCheck, (req, res) => {
  const content = readJSON('content');
  content[req.params.page] = req.body;
  writeJSON('content', content);
  res.json({ success: true });
});

app.get('/api/works', authCheck, (req, res) => {
  res.json(readJSON('works'));
});

app.get('/api/works/:id', authCheck, (req, res) => {
  const works = readJSON('works');
  const work = works.works.find(w => w.id === Number(req.params.id));
  if (work) return res.json(work);
  res.status(404).json({ error: 'Work not found' });
});

app.post('/api/works', authCheck, (req, res) => {
  const works = readJSON('works');
  const maxId = works.works.reduce((max, w) => Math.max(max, w.id), 0);
  const newWork = { ...req.body, id: maxId + 1 };
  works.works.push(newWork);
  writeJSON('works', works);
  res.json(newWork);
});

app.put('/api/works/:id', authCheck, (req, res) => {
  const works = readJSON('works');
  const idx = works.works.findIndex(w => w.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Work not found' });
  works.works[idx] = { ...works.works[idx], ...req.body, id: Number(req.params.id) };
  writeJSON('works', works);
  res.json(works.works[idx]);
});

app.delete('/api/works/:id', authCheck, (req, res) => {
  const works = readJSON('works');
  works.works = works.works.filter(w => w.id !== Number(req.params.id));
  writeJSON('works', works);
  res.json({ success: true });
});

app.get('/api/calculator', authCheck, (req, res) => {
  res.json(readJSON('calculator'));
});

app.put('/api/calculator', authCheck, (req, res) => {
  writeJSON('calculator', req.body);
  res.json({ success: true });
});

app.post('/api/upload', authCheck, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename, filename: req.file.filename });
});

app.get('/api/uploads', authCheck, (req, res) => {
  const files = fs.readdirSync(UPLOADS_DIR).map(f => ({
    name: f,
    url: '/uploads/' + f
  }));
  res.json(files);
});

app.delete('/api/uploads/:filename', authCheck, (req, res) => {
  const fp = path.join(UPLOADS_DIR, req.params.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin/`);
});
