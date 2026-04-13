require('dotenv').config();
const express      = require('express');
const multer       = require('multer');
const path         = require('path');
const fs           = require('fs');
const cors         = require('cors');
const http         = require('http');
const crypto       = require('crypto');
const { execSync } = require('child_process');
const { sendOnline, sendOffline, setShutdownCallback } = require('./notify');
const r2           = require('./r2');
const db           = require('./db');

const app = express();

// ══════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════
const PORT = process.env.PORT || process.env.FV_PORT || 3000;

const CONFIG = {
  STORAGE_LIMIT:   process.env.FV_STORAGE_LIMIT || '5gb',
  FILE_SIZE_LIMIT: process.env.FV_FILE_LIMIT    || '200mb',
};

// ── Size helpers ──
const SIZE_UNITS = { pb: 1024**5, tb: 1024**4, gb: 1024**3, mb: 1024**2, kb: 1024 };
function parseSize(str) {
  if (!str || str === '0') return 0;
  const s = String(str).trim().toLowerCase(), n = parseFloat(s);
  for (const [u, m] of Object.entries(SIZE_UNITS)) {
    if (s.endsWith(u)) return Math.floor(n * m);
  }
  return Math.floor(n);
}
function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB','TB','PB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(i >= 2 ? 2 : 1)) + ' ' + units[i];
}

const STORAGE_LIMIT_BYTES = parseSize(CONFIG.STORAGE_LIMIT);
const FILE_SIZE_BYTES     = parseSize(CONFIG.FILE_SIZE_LIMIT);

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR   = path.join(__dirname, 'data');
const DUMP_DIR   = path.join(__dirname, 'dumps');
[UPLOAD_DIR, DATA_DIR, DUMP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Path helpers ──
function safeFolderPath(folder) {
  if (!folder || folder === '/' || folder === '.') return UPLOAD_DIR;
  const clean = folder.replace(/\.\./g, '').replace(/[^a-zA-Z0-9_\-ก-๙/]/g, '_').replace(/\/+/g, '/').replace(/^\//, '');
  const full  = path.join(UPLOAD_DIR, clean);
  if (full !== UPLOAD_DIR && !full.startsWith(UPLOAD_DIR + path.sep)) return UPLOAD_DIR;
  return full;
}
function ensureFolder(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

// ── Storage size (for limit check only) ──
function getDirSizeRecursive(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) total += getDirSizeRecursive(p);
      else { try { total += fs.statSync(p).size; } catch {} }
    }
  } catch {}
  return total;
}

let _dirSizeCache = null, _dirSizeCacheAt = 0;
function getUploadDirSize(force = false) {
  const now = Date.now();
  if (!force && _dirSizeCache !== null && now - _dirSizeCacheAt < 2000) return _dirSizeCache;
  _dirSizeCache   = getDirSizeRecursive(UPLOAD_DIR);
  _dirSizeCacheAt = now;
  return _dirSizeCache;
}
function invalidateDirCache() { _dirSizeCache = null; }

// ── Persistent data ──
const dataFile  = n => path.join(DATA_DIR, n + '.json');
const readData  = (n, d) => { try { return JSON.parse(fs.readFileSync(dataFile(n), 'utf8')); } catch { return d; } };
const writeData = (n, v) => fs.writeFileSync(dataFile(n), JSON.stringify(v, null, 2));

// ── Shutdown ──
let isShuttingDown = false;
function archiveAndShutdown(server) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  try { execSync(`zip -r "${path.join(DUMP_DIR, 'filevault-dump-' + ts + '.zip')}" "${UPLOAD_DIR}"`, { stdio: 'pipe' }); } catch {
    try { execSync(`tar -czf "${path.join(DUMP_DIR, 'filevault-dump-' + ts + '.tar.gz')}" -C "${UPLOAD_DIR}" .`, { stdio: 'pipe' }); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}

// ── Multer ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => { const d = safeFolderPath(req.query.folder || ''); ensureFolder(d); cb(null, d); },
  filename:    (req, file, cb) => {
    const dir  = safeFolderPath(req.query.folder || '');
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\-ก-๙]/g, '_');
    if (fs.existsSync(path.join(dir, safe))) {
      const e = path.extname(safe), b = path.basename(safe, e);
      cb(null, `${b}_${Date.now()}${e}`);
    } else cb(null, safe);
  },
});
const memStorage = multer.memoryStorage();

function checkStorageLimit(req, res, next) {
  if (!STORAGE_LIMIT_BYTES) return next();
  const used = getUploadDirSize();
  if (used >= STORAGE_LIMIT_BYTES) {
    res.status(507).json({ ok: false, error: `พื้นที่เต็ม! ${formatSize(used)}/${formatSize(STORAGE_LIMIT_BYTES)}` });
    setImmediate(() => archiveAndShutdown(req.app.get('server')));
    return;
  }
  next();
}

const upload    = multer({ storage,    limits: { fileSize: FILE_SIZE_BYTES || undefined } });
const uploadMem = multer({ storage: memStorage, limits: { fileSize: FILE_SIZE_BYTES || undefined } });

// ══════════════════════════════════════════
// MIDDLEWARE
// ══════════════════════════════════════════
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag:   true,
  lastModified: true,
}));

// ── Cookie parser (no dep) ──
app.use((req, res, next) => {
  if (!req.cookies) {
    req.cookies = {};
    const raw = req.headers.cookie || '';
    raw.split(';').forEach(c => {
      const [k, ...v] = c.trim().split('=');
      if (k) req.cookies[k.trim()] = v.join('=');
    });
  }
  next();
});

// ── Site password lock ──
const SITE_PASSWORD = process.env.FV_SITE_PASSWORD || '';
// Fallback in-memory set (ใช้เมื่อ DB ไม่พร้อม)
const _memTokens = new Set();
function genToken() { return crypto.randomBytes(32).toString('hex'); }

async function checkToken(token) {
  if (!token) return false;
  // ตรวจ DB ก่อน ถ้า DB ไม่พร้อมใช้ in-memory
  try {
    if (await db.isHealthy()) return await db.hasSession(token);
  } catch {}
  return _memTokens.has(token);
}

async function saveToken(token, ip) {
  _memTokens.add(token);
  try { await db.addSession(token, ip); } catch {}
}

if (SITE_PASSWORD) {
  app.use((req, res, next) => {
    if (req.path === '/api/site-auth' || req.path.startsWith('/api/')) return next();
    const token = req.cookies?.fv_token || req.headers['x-fv-token'] || new URLSearchParams(req.url.split('?')[1] || '').get('fv_token');
    checkToken(token).then(valid => {
      if (valid) return next();
      res.send(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>FileVault — ล็อค</title><style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1117;font-family:'Segoe UI',sans-serif}.card{background:#1a1d27;border:1px solid #2a2d3a;border-radius:20px;padding:40px 36px;max-width:360px;width:100%;text-align:center;box-shadow:0 8px 40px #0008}.logo{font-size:2.8rem;margin-bottom:12px}h1{color:#e2e8f0;font-size:1.3rem;font-weight:700;margin-bottom:4px}.sub{color:#64748b;font-size:.85rem;margin-bottom:28px}input{width:100%;padding:12px 16px;border-radius:12px;border:1.5px solid #2a2d3a;background:#0f1117;color:#e2e8f0;font-size:1rem;margin-bottom:14px;outline:none;text-align:center;letter-spacing:3px;transition:border .2s}input:focus{border-color:#6366f1}button{width:100%;padding:13px;border-radius:12px;border:none;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:1rem;font-weight:600;cursor:pointer;transition:opacity .2s}button:hover{opacity:.9}.err{color:#f87171;font-size:.82rem;margin-top:8px;display:none}</style></head><body><div class="card"><div class="logo">🔐</div><h1>FileVault</h1><p class="sub">กรุณาใส่รหัสผ่านเพื่อเข้าใช้งาน</p><input id="pw" type="password" placeholder="รหัสผ่าน..." onkeydown="if(event.key==='Enter')auth()"/><button onclick="auth()">เข้าสู่ระบบ</button><div class="err" id="err">❌ รหัสผ่านไม่ถูกต้อง</div></div><script>async function auth(){const pw=document.getElementById('pw').value;const r=await fetch('/api/site-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});const d=await r.json();if(d.ok){document.cookie='fv_token='+d.token+'; path=/; max-age=2592000; samesite=strict';location.reload();}else{document.getElementById('err').style.display='block';document.getElementById('pw').value='';document.getElementById('pw').focus();}}document.getElementById('pw').focus();</script></body></html>`);
    }).catch(() => next());
  });
}

app.post('/api/site-auth', async (req, res) => {
  const { password } = req.body || {};
  if (!SITE_PASSWORD) return res.json({ ok: true, token: 'no-lock' });
  if (password === SITE_PASSWORD) {
    const t  = genToken();
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    await saveToken(t, ip);
    return res.json({ ok: true, token: t });
  }
  res.status(401).json({ ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
});

// ══════════════════════════════════════════
// ROUTES — Folders
// ══════════════════════════════════════════
app.get('/api/folders', async (req, res) => {
  try {
    const result  = await r2.listObjects('');
    const folders = result.folders.map(f => ({ path: f.name, name: f.name, fileCount: 0, size: 0 }));
    res.json({ ok: true, folders });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/folders', async (req, res) => {
  try {
    const name = req.body?.name || req.query.name;
    if (!name) return res.status(400).json({ ok: false, error: 'ต้องระบุชื่อ' });
    const key = name.replace(/\/?$/, '/') + '.keep';
    await r2.uploadObject(key, Buffer.from(''), 'text/plain');
    res.json({ ok: true, path: name });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/folders', async (req, res) => {
  try {
    const name = req.body?.name || req.query.name;
    if (!name) return res.status(400).json({ ok: false, error: 'ต้องระบุชื่อ' });
    const prefix   = name.replace(/\/?$/, '/');
    const files    = await r2.searchObjects('');
    const toDelete = files.filter(f => f.key.startsWith(prefix));
    await Promise.all(toDelete.map(f => r2.deleteObject(f.key)));
    res.json({ ok: true, deleted: toDelete.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ══════════════════════════════════════════
// ROUTES — Folder locks  (PostgreSQL-backed)
// ══════════════════════════════════════════
// folderLocks เป็น in-memory cache — DB คือ source of truth
let folderLocks = {};

function hashPin(pin) { return crypto.createHash('sha256').update('fv-lock:' + pin).digest('hex'); }

// โหลด locks จาก DB ลง cache
async function loadLocksFromDB() {
  try {
    folderLocks = await db.getLocks();
    console.log(`🔒 [locks] Loaded ${Object.keys(folderLocks).length} locks from PostgreSQL`);
  } catch (e) {
    console.warn('⚠ [locks] DB load error:', e.message, '— using local fallback');
    // fallback: ลอง R2
    try { await loadLocksFromR2(); } catch {}
  }
}

// legacy R2 fallback (ใช้เมื่อ DB ไม่พร้อม)
const LOCKS_KEY = process.env.FV_LOCKS_KEY || 'system/folder-locks.json';
async function loadLocksFromR2() {
  try {
    const obj    = await r2.downloadObject(LOCKS_KEY);
    const remote = JSON.parse(obj.buffer.toString('utf8'));
    Object.assign(folderLocks, remote);
    console.log(`🔒 [locks] Loaded ${Object.keys(folderLocks).length} locks from R2 (fallback)`);
  } catch {}
}

app.get('/api/lock', (req, res) => {
  res.json({ ok: true, locks: Object.keys(folderLocks).map(f => ({ folder: f, hint: folderLocks[f].hint || '' })) });
});

app.post('/api/lock', async (req, res) => {
  const { folder, pin, hint } = req.body || {};
  if (!folder) return res.status(400).json({ ok: false, error: 'ต้องระบุ folder' });
  const pinStr = String(pin || '');
  if (!/^\d{4}$/.test(pinStr)) return res.status(400).json({ ok: false, error: 'รหัสต้องเป็นตัวเลข 4 หลัก' });
  const pinHash = hashPin(pinStr);
  folderLocks[folder] = { hash: pinHash, hint: hint || '' };
  try { await db.setLock(folder, pinHash, hint || ''); }
  catch (e) { console.warn('⚠ [locks] DB setLock error:', e.message); }
  res.json({ ok: true });
});

app.delete('/api/lock', async (req, res) => {
  const { folder, pin } = req.body || {};
  if (!folder) return res.status(400).json({ ok: false, error: 'ต้องระบุ folder' });
  const lock = folderLocks[folder];
  if (!lock) return res.status(404).json({ ok: false, error: 'folder นี้ไม่มีรหัส' });
  if (!pin || hashPin(String(pin)) !== lock.hash) return res.status(403).json({ ok: false, error: 'รหัสไม่ถูกต้อง' });
  delete folderLocks[folder];
  try { await db.removeLock(folder); }
  catch (e) { console.warn('⚠ [locks] DB removeLock error:', e.message); }
  res.json({ ok: true });
});

app.post('/api/lock/verify', (req, res) => {
  const { folder, pin } = req.body || {};
  const lock = folderLocks[folder];
  if (!lock) return res.json({ ok: true, unlocked: true });
  if (!pin || hashPin(String(pin)) !== lock.hash) return res.status(403).json({ ok: false, error: 'รหัสไม่ถูกต้อง' });
  res.json({ ok: true, unlocked: true });
});

function checkFolderLock(req, res, next) {
  const folder = req.query.folder || req.body?.folder || '';
  if (!folder || !folderLocks[folder]) return next();
  const pin = req.headers['x-folder-pin'];
  if (!pin || hashPin(String(pin)) !== folderLocks[folder].hash)
    return res.status(403).json({ ok: false, error: '🔒 folder นี้ถูกล็อค', locked: true, folder });
  next();
}
app.use(['/api/files', '/api/download', '/api/upload', '/api/delete', '/api/move', '/api/rename'], checkFolderLock);

// ══════════════════════════════════════════
// ROUTES — Files
// ══════════════════════════════════════════
app.get('/api/files', async (req, res) => {
  try {
    const folder = req.query.folder || '';
    const prefix = folder ? folder.replace(/\/?$/, '/') : '';
    const result  = await r2.listObjects(prefix);
    const files   = result.files.map(f => ({ name: f.name, size: f.size, modified: new Date(f.modified).getTime(), isDir: false, folder: folder || '', key: f.key, publicUrl: f.publicUrl }));
    const folders = result.folders.map(f => ({ name: f.name, isDir: true, folder: folder || '', key: f.key, fileCount: 0, dirSize: 0 }));
    res.json({ ok: true, files: [...folders, ...files], folder: folder || '' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q) return res.json({ ok: true, files: [] });
    const files = await r2.searchObjects(q);
    res.json({ ok: true, files: files.map(f => ({ name: f.name, size: f.size, modified: new Date(f.modified).getTime(), isDir: false, folder: f.folder || '', key: f.key })), query: q });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/upload', checkStorageLimit, upload.array('files'), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ ok: false, error: 'ไม่มีไฟล์' });
  if (STORAGE_LIMIT_BYTES > 0 && getUploadDirSize(true) > STORAGE_LIMIT_BYTES) {
    req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    res.status(507).json({ ok: false, error: 'พื้นที่เกินกำหนด' });
    setImmediate(() => archiveAndShutdown(req.app.get('server')));
    return;
  }
  invalidateDirCache();
  const folder   = req.query.folder || '';
  const r2Folder = folder || (process.env.FV_DEFAULT_FOLDER || 'cloud');

  await Promise.all(req.files.map(async f => {
    try {
      const key    = `${r2Folder}/${f.filename}`;
      const buffer = fs.readFileSync(f.path);
      await r2.uploadObject(key, buffer, f.mimetype);
      // Audit log
      const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
      await db.logFileEvent({ eventType: 'upload', fileName: f.filename, folder: folder || r2Folder, r2Key: key, fileSize: f.size, ip, userAgent: req.headers['user-agent'] });
      await db.recordStat({ uploadCount: 1, uploadBytes: f.size });
    } catch (e) { console.error('R2 upload error:', e.message); }
  }));

  const savedFiles = req.files.map(f => ({ name: f.filename, size: f.size }));
  res.json({ ok: true, saved: savedFiles, folder });
});

app.post('/api/move', (req, res) => {
  try {
    const { name, fromFolder, toFolder, copy } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'ต้องระบุชื่อไฟล์' });
    const srcDir = safeFolderPath(fromFolder || ''), dstDir = safeFolderPath(toFolder || '');
    const src    = path.join(srcDir, path.basename(name));
    ensureFolder(dstDir);
    if (!src.startsWith(UPLOAD_DIR)) return res.status(400).json({ ok: false, error: 'path ไม่ถูกต้อง' });
    if (!fs.existsSync(src)) return res.status(404).json({ ok: false, error: 'ไม่พบไฟล์' });
    let dstName = path.basename(name), dst = path.join(dstDir, dstName);
    if (fs.existsSync(dst)) { const e = path.extname(dstName), b = path.basename(dstName, e); dstName = `${b}_${Date.now()}${e}`; dst = path.join(dstDir, dstName); }
    if (!dst.startsWith(UPLOAD_DIR)) return res.status(400).json({ ok: false, error: 'destination ไม่ถูกต้อง' });
    if (copy) { fs.copyFileSync(src, dst); } else { fs.renameSync(src, dst); }
    invalidateDirCache();
    res.json({ ok: true, name: dstName, toFolder: toFolder || '' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.patch('/api/rename', (req, res) => {
  try {
    const { name, newName, folder } = req.body;
    if (!name || !newName) return res.status(400).json({ ok: false, error: 'ต้องระบุ name และ newName' });
    const dir  = safeFolderPath(folder || '');
    const src  = path.join(dir, path.basename(name));
    const safe = path.basename(newName).replace(/[^a-zA-Z0-9._\-ก-๙]/g, '_');
    const dst  = path.join(dir, safe);
    if (!src.startsWith(UPLOAD_DIR) || !dst.startsWith(UPLOAD_DIR)) return res.status(400).json({ ok: false, error: 'path ไม่ถูกต้อง' });
    if (!fs.existsSync(src)) return res.status(404).json({ ok: false, error: 'ไม่พบไฟล์' });
    if (fs.existsSync(dst))  return res.status(409).json({ ok: false, error: 'มีไฟล์ชื่อนี้อยู่แล้ว' });
    fs.renameSync(src, dst);
    res.json({ ok: true, name: safe });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/download/:name', async (req, res) => {
  const folder = req.query.folder || '', name = path.basename(req.params.name);
  const key    = folder ? `${folder}/${name}` : name;
  try {
    const obj = await r2.downloadObject(key);
    const ct = (!obj.contentType || obj.contentType === 'application/octet-stream')
      ? r2.guessMime(name, 'application/octet-stream')
      : obj.contentType;
    res.set('Content-Type', ct);
    res.set('Content-Disposition', `inline; filename="${name}"`);
    if (obj.contentLength) res.set('Content-Length', obj.contentLength);
    res.set('Cache-Control', 'private, max-age=3600');
    // Audit log
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    db.logFileEvent({ eventType: 'download', fileName: name, folder, r2Key: key, fileSize: obj.contentLength, ip, userAgent: req.headers['user-agent'] });
    db.recordStat({ downloadCount: 1, downloadBytes: obj.contentLength || 0 });
    res.send(obj.buffer);
  } catch (e) {
    const dir = safeFolderPath(folder), fp = path.join(dir, name);
    if (fs.existsSync(fp)) return res.download(fp);
    res.status(404).json({ ok: false, error: 'ไม่พบไฟล์' });
  }
});

app.delete('/api/delete/:name', async (req, res) => {
  const folder = req.query.folder || '', name = path.basename(req.params.name);
  const dir    = safeFolderPath(folder), fp = path.join(dir, name);
  if (!fp.startsWith(UPLOAD_DIR)) return res.status(400).json({ ok: false, error: 'path ไม่ถูกต้อง' });
  if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch {} }
  try {
    const key = folder ? `${folder}/${name}` : name;
    await r2.deleteObject(key);
    // Audit log
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    await db.logFileEvent({ eventType: 'delete', fileName: name, folder, r2Key: key, ip, userAgent: req.headers['user-agent'] });
    await db.recordStat({ deleteCount: 1 });
  } catch (e) { console.error('R2 delete error:', e.message); }
  invalidateDirCache();
  res.json({ ok: true });
});

// ── File read/write ──
app.get('/api/files/:name', (req, res) => {
  const dir = safeFolderPath(req.query.folder || ''), fp = path.join(dir, path.basename(req.params.name));
  if (!fp.startsWith(UPLOAD_DIR)) return res.status(400).json({ ok: false, error: 'path ไม่ถูกต้อง' });
  if (!fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'ไม่พบไฟล์' });
  try { res.json({ ok: true, content: fs.readFileSync(fp, 'utf8') }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.put('/api/files/:name', (req, res) => {
  const dir  = safeFolderPath(req.query.folder || ''); ensureFolder(dir);
  const safe = path.basename(req.params.name).replace(/[^a-zA-Z0-9._\-ก-๙]/g, '_');
  const fp   = path.join(dir, safe);
  if (!fp.startsWith(UPLOAD_DIR)) return res.status(400).json({ ok: false, error: 'path ไม่ถูกต้อง' });
  try { fs.writeFileSync(fp, req.body.content ?? '', 'utf8'); invalidateDirCache(); res.json({ ok: true, name: safe }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Dumps ──
app.get('/api/dump/latest', (req, res) => {
  try {
    const files = fs.readdirSync(DUMP_DIR).filter(f => f.startsWith('filevault-dump-'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(DUMP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return res.status(404).json({ ok: false, error: 'ไม่มี dump' });
    res.download(path.join(DUMP_DIR, files[0].name));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/dump/list', (req, res) => {
  try {
    const files = fs.readdirSync(DUMP_DIR).filter(f => f.startsWith('filevault-dump-'))
      .map(f => { const s = fs.statSync(path.join(DUMP_DIR, f)); return { name: f, size: s.size, created: s.mtimeMs }; })
      .sort((a, b) => b.created - a.created);
    res.json({ ok: true, dumps: files });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ══════════════════════════════════════════
// ROUTES — R2 direct
// ══════════════════════════════════════════
app.get('/api/r2/files', async (req, res) => {
  try { const result = await r2.listObjects(req.query.prefix || req.query.folder || ''); res.json({ ok: true, ...result }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/r2/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ ok: true, files: [] });
    const files = await r2.searchObjects(q);
    res.json({ ok: true, files, query: q });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/r2/upload', uploadMem.array('files'), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ ok: false, error: 'ไม่มีไฟล์' });
  try {
    const prefix = (req.query.prefix || req.query.folder || '').replace(/^\//, '');
    const saved = await Promise.all(req.files.map(async f => {
      const key    = prefix ? `${prefix}/${f.originalname}` : f.originalname;
      const result = await r2.uploadObject(key, f.buffer, f.mimetype);
      return { name: f.originalname, key: result.key, size: f.size, publicUrl: result.publicUrl };
    }));
    res.json({ ok: true, saved, prefix: prefix || '' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/r2/download/*', async (req, res) => {
  const key = req.params[0];
  if (!key) return res.status(400).json({ ok: false, error: 'ต้องระบุ key' });
  try {
    const obj = await r2.downloadObject(key);
    res.set('Content-Type', obj.contentType || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${path.basename(key)}"`);
    if (obj.contentLength) res.set('Content-Length', obj.contentLength);
    res.send(obj.buffer);
  } catch (e) {
    const code = e.$metadata?.httpStatusCode;
    res.status(code === 404 ? 404 : 500).json({ ok: false, error: code === 404 ? 'ไม่พบไฟล์' : e.message });
  }
});

app.delete('/api/r2/delete/*', async (req, res) => {
  const key = req.params[0];
  if (!key) return res.status(400).json({ ok: false, error: 'ต้องระบุ key' });
  try { await r2.deleteObject(key); res.json({ ok: true, key }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/r2/move', async (req, res) => {
  try {
    const { sourceKey, destKey, copy = false } = req.body;
    if (!sourceKey || !destKey) return res.status(400).json({ ok: false, error: 'ต้องระบุ sourceKey และ destKey' });
    const result = await r2.copyObject(sourceKey, destKey, !copy);
    res.json({ ok: true, ...result, action: copy ? 'copy' : 'move' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/r2/head/*', async (req, res) => {
  const key = req.params[0];
  if (!key) return res.status(400).json({ ok: false, error: 'ต้องระบุ key' });
  try {
    const info = await r2.headObject(key);
    if (!info.exists) return res.status(404).json({ ok: false, error: 'ไม่พบไฟล์' });
    res.json({ ok: true, key, ...info });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/r2/presign/upload', async (req, res) => {
  try {
    const { key, expiresIn = 3600, contentType } = req.body;
    if (!key) return res.status(400).json({ ok: false, error: 'ต้องระบุ key' });
    const result = await r2.presignUpload(key, expiresIn, contentType);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/r2/presign/download', async (req, res) => {
  try {
    const { key, expiresIn = 3600 } = req.body;
    if (!key) return res.status(400).json({ ok: false, error: 'ต้องระบุ key' });
    const result = await r2.presignDownload(key, expiresIn);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/r2/status', (req, res) => {
  const cfg        = r2.R2_CONFIG;
  const configured = !!(cfg.ACCOUNT_ID && cfg.ACCESS_KEY_ID && cfg.SECRET_ACCESS_KEY && cfg.BUCKET);
  res.json({ ok: configured, configured, bucket: cfg.BUCKET || null, accountId: cfg.ACCOUNT_ID ? cfg.ACCOUNT_ID.slice(0, 6) + '...' : null, publicUrl: cfg.PUBLIC_URL || null });
});

// ══════════════════════════════════════════
// PRETTY FILE URL  — /f/<folder>/<filename>
// ══════════════════════════════════════════
app.get('/f/*', async (req, res) => {
  const rawPath = decodeURIComponent(req.params[0] || '');
  if (!rawPath) return res.status(400).send('ต้องระบุ path ของไฟล์');

  const lastSlash = rawPath.lastIndexOf('/');
  const folder    = lastSlash > 0 ? rawPath.slice(0, lastSlash) : '';
  const name      = path.basename(rawPath);
  if (!name) return res.status(400).send('ชื่อไฟล์ไม่ถูกต้อง');

  const key = folder ? `${folder}/${name}` : name;

  try {
    const obj = await r2.downloadObject(key);
    const ct = (!obj.contentType || obj.contentType === 'application/octet-stream')
      ? r2.guessMime(name, 'application/octet-stream')
      : obj.contentType;
    res.set('Content-Type', ct);
    res.set('Content-Disposition', `inline; filename="${name}"`);
    if (obj.contentLength) res.set('Content-Length', obj.contentLength);
    res.set('Cache-Control', 'private, max-age=3600');
    return res.send(obj.buffer);
  } catch (e) {
    if (e.$metadata?.httpStatusCode !== 404 && e.name !== 'NoSuchKey') {
      return res.status(500).send('เกิดข้อผิดพลาด: ' + e.message);
    }
  }

  const dir = safeFolderPath(folder);
  const fp  = path.join(dir, name);
  if (fp.startsWith(UPLOAD_DIR) && fs.existsSync(fp)) return res.sendFile(fp);

  res.status(404).send('ไม่พบไฟล์: ' + rawPath);
});

// ══════════════════════════════════════════
// ROUTES — Stats & Audit Log (PostgreSQL)
// ══════════════════════════════════════════

// middleware: ตรวจ site session ก่อนเข้า stats/events
async function requireAuth(req, res, next) {
  // ถ้าไม่ได้ตั้ง SITE_PASSWORD ข้ามการตรวจ
  if (!SITE_PASSWORD) return next();
  const token = req.cookies?.fv_token || req.headers['x-fv-token'];
  const ok = token ? await checkToken(token) : false;
  if (!ok) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 1), 365);
    if (!await db.isHealthy()) {
      return res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
    const [daily, total] = await Promise.all([db.getStats({ days }), db.getTotalStats()]);
    res.json({ ok: true, daily, total, days });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// valid event types สำหรับ filter
const VALID_EVENT_TYPES = new Set(['upload', 'download', 'delete', 'move', 'rename', 'folder_create', 'folder_delete']);

app.get('/api/events', requireAuth, async (req, res) => {
  try {
    if (!await db.isHealthy()) {
      return res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
    const { folder, type, limit = '50', offset = '0', since, until } = req.query;

    // validate event type
    if (type && !VALID_EVENT_TYPES.has(type)) {
      return res.status(400).json({ ok: false, error: `type ไม่ถูกต้อง — ใช้ได้: ${[...VALID_EVENT_TYPES].join(', ')}` });
    }

    // validate date
    const sinceDate = since ? new Date(since) : undefined;
    const untilDate = until ? new Date(until) : undefined;
    if (sinceDate && isNaN(sinceDate)) return res.status(400).json({ ok: false, error: 'since รูปแบบวันที่ไม่ถูกต้อง' });
    if (untilDate && isNaN(untilDate)) return res.status(400).json({ ok: false, error: 'until รูปแบบวันที่ไม่ถูกต้อง' });

    const limitNum  = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    const events = await db.getFileEvents({
      folder,
      eventType: type,
      limit:     limitNum,
      offset:    offsetNum,
      since:     sinceDate,
      until:     untilDate,
    });
    res.json({ ok: true, events, limit: limitNum, offset: offsetNum });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/db/health', async (req, res) => {
  const healthy = await db.isHealthy();
  res.status(healthy ? 200 : 503).json({ ok: healthy, database: healthy ? 'connected' : 'unavailable' });
});


const SHUTDOWN_TOKEN = process.env.FV_SHUTDOWN_TOKEN || '';

async function gracefulShutdown(reason = 'manual') {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Shutting down... (${reason})`);
  try { await sendOffline?.(); } catch {}
  try { await db.close(); } catch {}
  const server = app.get('server');
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}

app.post('/api/shutdown', async (req, res) => {
  const token = req.headers['x-shutdown-token'] || req.body?.token || '';
  if (SHUTDOWN_TOKEN && token !== SHUTDOWN_TOKEN) return res.status(403).json({ ok: false, error: 'token ไม่ถูกต้อง' });
  res.json({ ok: true, message: '🛑 กำลังปิด server...' });
  setTimeout(() => gracefulShutdown('api'), 500);
});

// ── Error handler ──
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: `ไฟล์ใหญ่เกิน (สูงสุด ${formatSize(FILE_SIZE_BYTES)})` });
  res.status(500).json({ ok: false, error: err.message });
});

// ══════════════════════════════════════════
// START
// ══════════════════════════════════════════
function startServer(port) {
  const httpServer = http.createServer(app);
  app.set('server', httpServer);

  httpServer.listen(port, '0.0.0.0', async () => {
    console.log(`\n  ☁  FileVault Server`);
    console.log(`  Local  :  http://localhost:${port}`);
    console.log(`  Network:  http://0.0.0.0:${port}\n`);

    try { await sendOnline?.(); setShutdownCallback?.(() => gracefulShutdown('discord')); }
    catch (e) { console.log('Discord error:', e.message); }

    // ── PostgreSQL: migrate → load locks ──
    const dbReady = await db.runMigrations();
    if (dbReady) {
      await loadLocksFromDB();
      // ล้าง sessions หมดอายุทุก 6 ชั่วโมง
      setInterval(() => db.cleanExpiredSessions().catch(() => {}), 6 * 60 * 60 * 1000);
    } else {
      // fallback: โหลด locks จาก R2 เหมือนเดิม
      await loadLocksFromR2();
    }
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') { console.log(`Port ${port} busy → trying ${port + 1}`); startServer(port + 1); }
    else console.error(err);
  });
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

startServer(PORT);

module.exports = { CONFIG, STORAGE_LIMIT_BYTES, FILE_SIZE_BYTES, formatSize };
