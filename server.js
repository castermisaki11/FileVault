require('dotenv').config();
const express      = require('express');
const multer       = require('multer');
const path         = require('path');
const fs           = require('fs');
const cors         = require('cors');
const os           = require('os');
const http         = require('http');
const crypto       = require('crypto');
const readline     = require('readline');
const { execSync } = require('child_process');
const { sendOnline, sendOffline, setShutdownCallback, setStats } = require('./notify');
const r2           = require('./r2');
const statsSync    = require('./stats-sync');

const app = express();

// ══════════════════════════════════════════
// SSE — Server-Sent Events
// ══════════════════════════════════════════
const sseClients = new Set();

function sseEmit(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  sseClients.add(res);

  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(keepAlive); sseClients.delete(res); }
  }, 25_000);

  req.on('close', () => { sseClients.delete(res); clearInterval(keepAlive); });
});

// ══════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════
const PORT = process.env.FV_PORT || 3000;

let CONSOLE_MODE = (process.env.FV_CONSOLE || '').toLowerCase();

// ANSI Colors
const R   = '\x1b[0m';
const B   = '\x1b[1m';
const DIM = '\x1b[2m';
const GRN = '\x1b[32m';
const YLW = '\x1b[33m';
const RED = '\x1b[31m';
const CYN = '\x1b[36m';
const MAG = '\x1b[35m';
const BLU = '\x1b[34m';
const GRY = '\x1b[90m';
const WHT = '\x1b[97m';

const CONFIG = {
  STORAGE_LIMIT:   process.env.FV_STORAGE_LIMIT || '5gb',
  FILE_SIZE_LIMIT: process.env.FV_FILE_LIMIT    || '200mb',
  STATUS_INTERVAL: parseInt(process.env.FV_STATUS_MS) || 5000,
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

// ── Storage helpers (cache dir size สั้น ๆ เพื่อลด I/O) ──
let _dirSizeCache = null;
let _dirSizeCacheAt = 0;
const DIR_CACHE_TTL = 2000; // 2s

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

function getUploadDirSize(force = false) {
  const now = Date.now();
  if (!force && _dirSizeCache !== null && now - _dirSizeCacheAt < DIR_CACHE_TTL) return _dirSizeCache;
  _dirSizeCache   = getDirSizeRecursive(UPLOAD_DIR);
  _dirSizeCacheAt = now;
  return _dirSizeCache;
}

function invalidateDirCache() { _dirSizeCache = null; }

function getStorageInfo() {
  const used = getUploadDirSize(), limit = STORAGE_LIMIT_BYTES, unlimited = limit === 0;
  const free = unlimited ? null : Math.max(0, limit - used);
  const pct  = unlimited ? null : Math.min(100, (used / limit) * 100);
  let diskFree = null;
  try { const s = fs.statfsSync?.(UPLOAD_DIR); if (s) diskFree = s.bfree * s.bsize; } catch {}
  return { used, limit, unlimited, free, pct, diskFree };
}

// ── Persistent data ──
const dataFile  = n => path.join(DATA_DIR, n + '.json');
const readData  = (n, d) => { try { return JSON.parse(fs.readFileSync(dataFile(n), 'utf8')); } catch { return d; } };
const writeData = (n, v) => fs.writeFileSync(dataFile(n), JSON.stringify(v, null, 2));

let stats = readData('stats', { requests:0, uploads:0, downloads:0, deletes:0, errors:0, moves:0, r2_uploads:0, r2_downloads:0, r2_deletes:0 });
setInterval(() => writeData('stats', stats), 10_000);

// ── Shutdown ──
let isShuttingDown = false;
function archiveAndShutdown(server) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  try { execSync(`zip -r "${path.join(DUMP_DIR, 'filevault-dump-' + ts + '.zip')}" "${UPLOAD_DIR}"`, { stdio: 'pipe' }); } catch {
    try { execSync(`tar -czf "${path.join(DUMP_DIR, 'filevault-dump-' + ts + '.tar.gz')}" -C "${UPLOAD_DIR}" .`, { stdio: 'pipe' }); } catch {}
  }
  server.close(() => { writeData('stats', stats); process.exit(0); });
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
    res.status(507).json({ ok: false, error: `พื้นที่เต็ม! ${formatSize(used)}/${formatSize(STORAGE_LIMIT_BYTES)}`, storage: getStorageInfo() });
    setImmediate(() => archiveAndShutdown(req.app.get('server')));
    return;
  }
  next();
}

const upload    = multer({ storage,    limits: { fileSize: FILE_SIZE_BYTES || undefined } });
const uploadMem = multer({ storage: memStorage, limits: { fileSize: FILE_SIZE_BYTES || undefined } });

// ── Local IP (cache ผล) ──
let _localIP = null;
function getLocalIP() {
  if (_localIP) return _localIP;
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets) {
      if (n.family === 'IPv4' && !n.internal) { _localIP = n.address; return _localIP; }
    }
  }
  return 'localhost';
}

// ══════════════════════════════════════════
// MIDDLEWARE
// ══════════════════════════════════════════
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',       // cache static assets
  etag:   true,
  lastModified: true,
}));
app.use((req, res, next) => { stats.requests++; next(); });

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
const siteTokens    = new Set();
function genToken() { return crypto.randomBytes(32).toString('hex'); }

if (SITE_PASSWORD) {
  app.use((req, res, next) => {
    if (req.path === '/api/site-auth' || req.path.startsWith('/api/')) return next();
    const token = req.cookies?.fv_token || req.headers['x-fv-token'] || new URLSearchParams(req.url.split('?')[1] || '').get('fv_token');
    if (token && siteTokens.has(token)) return next();
    // lock page (minified inline)
    res.send(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>FileVault — ล็อค</title><style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1117;font-family:'Segoe UI',sans-serif}.card{background:#1a1d27;border:1px solid #2a2d3a;border-radius:20px;padding:40px 36px;max-width:360px;width:100%;text-align:center;box-shadow:0 8px 40px #0008}.logo{font-size:2.8rem;margin-bottom:12px}h1{color:#e2e8f0;font-size:1.3rem;font-weight:700;margin-bottom:4px}.sub{color:#64748b;font-size:.85rem;margin-bottom:28px}input{width:100%;padding:12px 16px;border-radius:12px;border:1.5px solid #2a2d3a;background:#0f1117;color:#e2e8f0;font-size:1rem;margin-bottom:14px;outline:none;text-align:center;letter-spacing:3px;transition:border .2s}input:focus{border-color:#6366f1}button{width:100%;padding:13px;border-radius:12px;border:none;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:1rem;font-weight:600;cursor:pointer;transition:opacity .2s}button:hover{opacity:.9}.err{color:#f87171;font-size:.82rem;margin-top:8px;display:none}</style></head><body><div class="card"><div class="logo">🔐</div><h1>FileVault</h1><p class="sub">กรุณาใส่รหัสผ่านเพื่อเข้าใช้งาน</p><input id="pw" type="password" placeholder="รหัสผ่าน..." onkeydown="if(event.key==='Enter')auth()"/><button onclick="auth()">เข้าสู่ระบบ</button><div class="err" id="err">❌ รหัสผ่านไม่ถูกต้อง</div></div><script>async function auth(){const pw=document.getElementById('pw').value;const r=await fetch('/api/site-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});const d=await r.json();if(d.ok){document.cookie='fv_token='+d.token+'; path=/; max-age=2592000; samesite=strict';location.reload();}else{document.getElementById('err').style.display='block';document.getElementById('pw').value='';document.getElementById('pw').focus();}}document.getElementById('pw').focus();</script></body></html>`);
  });
}

app.post('/api/site-auth', (req, res) => {
  const { password } = req.body || {};
  if (!SITE_PASSWORD) return res.json({ ok: true, token: 'no-lock' });
  if (password === SITE_PASSWORD) { const t = genToken(); siteTokens.add(t); return res.json({ ok: true, token: t }); }
  res.status(401).json({ ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
});

// ══════════════════════════════════════════
// CONSOLE STATUS
// ══════════════════════════════════════════
function makeBar(pct, w = 20) {
  const f = Math.round(pct / 100 * w);
  const c = pct >= 90 ? RED : pct >= 70 ? YLW : GRN;
  return c + '█'.repeat(f) + GRY + '░'.repeat(w - f) + R;
}

// cache countFiles ไม่ให้ readdirSync ทุก status interval
let _fileCount = 0, _fileCountAt = 0;
function countFiles(dir) {
  const now = Date.now();
  if (now - _fileCountAt < 4000) return _fileCount; // reuse ถ้า < 4s
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
      else n++;
    }
  } catch {}
  _fileCount   = n;
  _fileCountAt = now;
  return n;
}

function printStatus() {
  if (isShuttingDown || CONSOLE_MODE === 'off') return;

  const info  = getStorageInfo();
  const up    = process.uptime();
  const pad   = n => String(Math.floor(n)).padStart(2, '0');
  const upt   = `${pad(up / 3600)}:${pad((up % 3600) / 60)}:${pad(up % 60)}`;
  const memMB = (process.memoryUsage().rss / 1024 ** 2).toFixed(1);
  const fc    = countFiles(UPLOAD_DIR);

  if (CONSOLE_MODE === 'minimal') {
    const pctStr = info.unlimited
      ? `${GRY}unlimited${R}`
      : `${info.pct >= 90 ? RED : info.pct >= 70 ? YLW : GRN}${info.pct.toFixed(1)}%${R}`;
    process.stdout.write(`\r  ${GRY}[${upt}]${R}  📦${fc}  💾${formatSize(info.used)} ${pctStr}  ↑${stats.uploads} ↓${stats.downloads} 🗑${stats.deletes}  Req:${stats.requests}  Mem:${memMB}MB  ${GRY}...${R}   `);
    return;
  }

  const sl = info.unlimited
    ? `${B}พื้นที่:${R} ${formatSize(info.used)} ${GRY}/ ไม่จำกัด${R}`
    : `${B}พื้นที่:${R} [${makeBar(info.pct)}] ${info.pct >= 90 ? RED : info.pct >= 70 ? YLW : GRN}${info.pct.toFixed(1)}%${R}  ${formatSize(info.used)} / ${formatSize(info.limit)}  ${GRY}(เหลือ ${formatSize(info.free)})${R}`;

  const ip    = getLocalIP();
  const r2ok  = !!(r2?.R2_CONFIG?.ACCOUNT_ID && r2?.R2_CONFIG?.BUCKET);
  const r2Str = r2ok ? `${GRN}✓ ${r2.R2_CONFIG.BUCKET}${R}` : `${RED}✗ ยังไม่ตั้งค่า${R}`;

  const lines = [
    ``,
    `  ${B}${CYN}☁  FileVault${R}   ${GRY}${upt}${R}`,
    `  ${GRY}${'─'.repeat(46)}${R}`,
    `  ${sl}`,
    info.diskFree != null ? `  ${GRY}ดิสก์ว่าง: ${formatSize(info.diskFree)}${R}` : null,
    `  ${B}ไฟล์:${R} ${WHT}${fc}${R}  ${B}Mem:${R} ${memMB} MB  ${B}R2:${R} ${r2Str}`,
    `  ${GRY}${'─'.repeat(46)}${R}`,
    `  ${B}Requests:${R} ${stats.requests}   ${GRN}↑${stats.uploads}${R} ${BLU}↓${stats.downloads}${R} ${RED}🗑${stats.deletes}${R}   ${B}Errors:${R} ${stats.errors || 0}`,
    `  ${B}R2:${R} ${GRN}↑${stats.r2_uploads || 0}${R} ${BLU}↓${stats.r2_downloads || 0}${R} ${RED}🗑${stats.r2_deletes || 0}${R}`,
    ``,
  ].filter(v => v !== null);

  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);
  process.stdout.write(lines.join('\n'));
}

// ══════════════════════════════════════════
// ROUTES — Stats
// ══════════════════════════════════════════
app.get('/api/stats', (req, res) => res.json({ ok: true, stats, storage: getStorageInfo() }));

app.post('/api/stats/reset', (req, res) => {
  Object.assign(stats, { requests:0, uploads:0, downloads:0, deletes:0, errors:0, moves:0, r2_uploads:0, r2_downloads:0, r2_deletes:0 });
  res.json({ ok: true });
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
    sseEmit('change', { action: 'mkdir', folder: name });
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
    // ลบพร้อมกัน (parallel) แทนการ for-await ทีละตัว
    await Promise.all(toDelete.map(f => r2.deleteObject(f.key)));
    stats.deletes++;
    res.json({ ok: true, deleted: toDelete.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ══════════════════════════════════════════
// ROUTES — Folder locks
// ══════════════════════════════════════════
let folderLocks = readData('folder-locks', {});
const LOCKS_KEY = process.env.FV_LOCKS_KEY || 'system/folder-locks.json';

function hashPin(pin) { return crypto.createHash('sha256').update('fv-lock:' + pin).digest('hex'); }

// debounce saveLocks เพื่อไม่ให้ upload R2 ทุกครั้ง
let _lockSaveTimer = null;
async function saveLocks() {
  writeData('folder-locks', folderLocks);
  clearTimeout(_lockSaveTimer);
  _lockSaveTimer = setTimeout(async () => {
    try {
      await r2.uploadObject(LOCKS_KEY, Buffer.from(JSON.stringify(folderLocks, null, 2), 'utf8'), 'application/json');
    } catch (e) { console.warn('⚠ [locks] R2 save error:', e.message); }
  }, 300); // debounce 300ms
}

async function loadLocksFromR2() {
  try {
    const obj    = await r2.downloadObject(LOCKS_KEY);
    const remote = JSON.parse(obj.buffer.toString('utf8'));
    Object.assign(folderLocks, remote);
    writeData('folder-locks', folderLocks);
    if (CONSOLE_MODE !== 'off') console.log(`🔒 [locks] Loaded ${Object.keys(folderLocks).length} locks from R2`);
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 404 || e.name === 'NoSuchKey' || e.Code === 'NoSuchKey') {
      if (CONSOLE_MODE !== 'off') console.log('🔒 [locks] No remote locks — using local');
    } else {
      console.warn('⚠ [locks] R2 load error:', e.message);
    }
  }
}

app.get('/api/lock', (req, res) => {
  res.json({ ok: true, locks: Object.keys(folderLocks).map(f => ({ folder: f, hint: folderLocks[f].hint || '' })) });
});
app.post('/api/lock', async (req, res) => {
  const { folder, pin, hint } = req.body || {};
  if (!folder) return res.status(400).json({ ok: false, error: 'ต้องระบุ folder' });
  const pinStr = String(pin || '');
  if (!/^\d{4}$/.test(pinStr)) return res.status(400).json({ ok: false, error: 'รหัสต้องเป็นตัวเลข 4 หลัก' });
  folderLocks[folder] = { hash: hashPin(pinStr), hint: hint || '' };
  await saveLocks();
  res.json({ ok: true });
});
app.delete('/api/lock', async (req, res) => {
  const { folder, pin } = req.body || {};
  if (!folder) return res.status(400).json({ ok: false, error: 'ต้องระบุ folder' });
  const lock = folderLocks[folder];
  if (!lock) return res.status(404).json({ ok: false, error: 'folder นี้ไม่มีรหัส' });
  if (!pin || hashPin(String(pin)) !== lock.hash) return res.status(403).json({ ok: false, error: 'รหัสไม่ถูกต้อง' });
  delete folderLocks[folder];
  await saveLocks();
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
    res.json({ ok: true, files: [...folders, ...files], folder: folder || '', storage: getStorageInfo() });
  } catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
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
  if (!req.files?.length) { stats.errors++; return res.status(400).json({ ok: false, error: 'ไม่มีไฟล์' }); }
  if (STORAGE_LIMIT_BYTES > 0 && getUploadDirSize(true) > STORAGE_LIMIT_BYTES) {
    req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    stats.errors++;
    res.status(507).json({ ok: false, error: 'พื้นที่เกินกำหนด', storage: getStorageInfo() });
    setImmediate(() => archiveAndShutdown(req.app.get('server')));
    return;
  }
  stats.uploads += req.files.length;
  invalidateDirCache(); // invalidate cache หลัง upload
  const folder   = req.query.folder || '';
  const r2Folder = folder || (process.env.FV_DEFAULT_FOLDER || 'cloud');

  // อัพโหลดขึ้น R2 แบบ parallel
  await Promise.all(req.files.map(async f => {
    try {
      const key    = `${r2Folder}/${f.filename}`;
      const buffer = fs.readFileSync(f.path);
      await r2.uploadObject(key, buffer, f.mimetype);
      stats.r2_uploads++;
    } catch (e) { console.error('R2 upload error:', e.message); }
  }));

  const savedFiles = req.files.map(f => ({ name: f.filename, size: f.size }));
  sseEmit('change', { action: 'upload', folder: folder || '', files: savedFiles.map(f => f.name) });
  res.json({ ok: true, saved: savedFiles, folder, storage: getStorageInfo() });
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
    if (copy) { fs.copyFileSync(src, dst); stats.uploads++; } else { fs.renameSync(src, dst); stats.moves = (stats.moves || 0) + 1; }
    invalidateDirCache();
    sseEmit('change', { action: 'move', folder: fromFolder || '' });
    res.json({ ok: true, name: dstName, toFolder: toFolder || '' });
  } catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
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
    stats.moves = (stats.moves || 0) + 1;
    sseEmit('change', { action: 'rename', folder: folder || '' });
    res.json({ ok: true, name: safe });
  } catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/download/:name', async (req, res) => {
  const folder = req.query.folder || '', name = path.basename(req.params.name);
  const key    = folder ? `${folder}/${name}` : name;
  try {
    const obj = await r2.downloadObject(key);
    stats.downloads++; stats.r2_downloads++;
    const ct = (!obj.contentType || obj.contentType === 'application/octet-stream')
      ? r2.guessMime(name, 'application/octet-stream')
      : obj.contentType;
    res.set('Content-Type', ct);
    res.set('Content-Disposition', `inline; filename="${name}"`);
    if (obj.contentLength) res.set('Content-Length', obj.contentLength);
    // เพิ่ม cache header สำหรับ static assets
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(obj.buffer);
  } catch (e) {
    const dir = safeFolderPath(folder), fp = path.join(dir, name);
    if (fs.existsSync(fp)) { stats.downloads++; return res.download(fp); }
    stats.errors++;
    res.status(404).json({ ok: false, error: 'ไม่พบไฟล์' });
  }
});

app.delete('/api/delete/:name', async (req, res) => {
  const folder = req.query.folder || '', name = path.basename(req.params.name);
  const dir    = safeFolderPath(folder), fp = path.join(dir, name);
  if (!fp.startsWith(UPLOAD_DIR)) { stats.errors++; return res.status(400).json({ ok: false, error: 'path ไม่ถูกต้อง' }); }
  if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch {} }
  try {
    const key = folder ? `${folder}/${name}` : name;
    await r2.deleteObject(key);
    stats.r2_deletes++;
  } catch (e) { console.error('R2 delete error:', e.message); }
  stats.deletes++;
  invalidateDirCache();
  sseEmit('change', { action: 'delete', folder: folder || '' });
  res.json({ ok: true, storage: getStorageInfo() });
});

// ── File read/write ──
app.get('/api/files/:name', (req, res) => {
  const dir = safeFolderPath(req.query.folder || ''), fp = path.join(dir, path.basename(req.params.name));
  if (!fp.startsWith(UPLOAD_DIR)) return res.status(400).json({ ok: false, error: 'path ไม่ถูกต้อง' });
  if (!fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'ไม่พบไฟล์' });
  try { res.json({ ok: true, content: fs.readFileSync(fp, 'utf8') }); }
  catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
});

app.put('/api/files/:name', (req, res) => {
  const dir  = safeFolderPath(req.query.folder || ''); ensureFolder(dir);
  const safe = path.basename(req.params.name).replace(/[^a-zA-Z0-9._\-ก-๙]/g, '_');
  const fp   = path.join(dir, safe);
  if (!fp.startsWith(UPLOAD_DIR)) return res.status(400).json({ ok: false, error: 'path ไม่ถูกต้อง' });
  try { fs.writeFileSync(fp, req.body.content ?? '', 'utf8'); invalidateDirCache(); res.json({ ok: true, name: safe }); }
  catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
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
  catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/r2/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ ok: true, files: [] });
    const files = await r2.searchObjects(q);
    res.json({ ok: true, files, query: q });
  } catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/r2/upload', uploadMem.array('files'), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ ok: false, error: 'ไม่มีไฟล์' });
  try {
    const prefix = (req.query.prefix || req.query.folder || '').replace(/^\//, '');
    // อัพโหลดแบบ parallel
    const saved = await Promise.all(req.files.map(async f => {
      const key    = prefix ? `${prefix}/${f.originalname}` : f.originalname;
      const result = await r2.uploadObject(key, f.buffer, f.mimetype);
      stats.r2_uploads++;
      return { name: f.originalname, key: result.key, size: f.size, publicUrl: result.publicUrl };
    }));
    res.json({ ok: true, saved, prefix: prefix || '' });
  } catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/r2/download/*', async (req, res) => {
  const key = req.params[0];
  if (!key) return res.status(400).json({ ok: false, error: 'ต้องระบุ key' });
  try {
    const obj = await r2.downloadObject(key);
    stats.r2_downloads++;
    res.set('Content-Type', obj.contentType || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${path.basename(key)}"`);
    if (obj.contentLength) res.set('Content-Length', obj.contentLength);
    res.send(obj.buffer);
  } catch (e) {
    stats.errors++;
    const code = e.$metadata?.httpStatusCode;
    res.status(code === 404 ? 404 : 500).json({ ok: false, error: code === 404 ? 'ไม่พบไฟล์' : e.message });
  }
});

app.delete('/api/r2/delete/*', async (req, res) => {
  const key = req.params[0];
  if (!key) return res.status(400).json({ ok: false, error: 'ต้องระบุ key' });
  try { await r2.deleteObject(key); stats.r2_deletes++; res.json({ ok: true, key }); }
  catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/r2/move', async (req, res) => {
  try {
    const { sourceKey, destKey, copy = false } = req.body;
    if (!sourceKey || !destKey) return res.status(400).json({ ok: false, error: 'ต้องระบุ sourceKey และ destKey' });
    const result = await r2.copyObject(sourceKey, destKey, !copy);
    if (!copy) stats.r2_deletes++;
    stats.r2_uploads++;
    res.json({ ok: true, ...result, action: copy ? 'copy' : 'move' });
  } catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/r2/head/*', async (req, res) => {
  const key = req.params[0];
  if (!key) return res.status(400).json({ ok: false, error: 'ต้องระบุ key' });
  try {
    const info = await r2.headObject(key);
    if (!info.exists) return res.status(404).json({ ok: false, error: 'ไม่พบไฟล์' });
    res.json({ ok: true, key, ...info });
  } catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/r2/presign/upload', async (req, res) => {
  try {
    const { key, expiresIn = 3600, contentType } = req.body;
    if (!key) return res.status(400).json({ ok: false, error: 'ต้องระบุ key' });
    const result = await r2.presignUpload(key, expiresIn, contentType);
    res.json({ ok: true, ...result });
  } catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/r2/presign/download', async (req, res) => {
  try {
    const { key, expiresIn = 3600 } = req.body;
    if (!key) return res.status(400).json({ ok: false, error: 'ต้องระบุ key' });
    const result = await r2.presignDownload(key, expiresIn);
    res.json({ ok: true, ...result });
  } catch (e) { stats.errors++; res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/r2/status', (req, res) => {
  const cfg        = r2.R2_CONFIG;
  const configured = !!(cfg.ACCOUNT_ID && cfg.ACCESS_KEY_ID && cfg.SECRET_ACCESS_KEY && cfg.BUCKET);
  res.json({ ok: configured, configured, bucket: cfg.BUCKET || null, accountId: cfg.ACCOUNT_ID ? cfg.ACCOUNT_ID.slice(0, 6) + '...' : null, publicUrl: cfg.PUBLIC_URL || null, stats: { uploads: stats.r2_uploads || 0, downloads: stats.r2_downloads || 0, deletes: stats.r2_deletes || 0 } });
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
    stats.downloads++; stats.r2_downloads++;
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
      stats.errors++;
      return res.status(500).send('เกิดข้อผิดพลาด: ' + e.message);
    }
  }

  // fallback: local disk
  const dir = safeFolderPath(folder);
  const fp  = path.join(dir, name);
  if (fp.startsWith(UPLOAD_DIR) && fs.existsSync(fp)) {
    stats.downloads++;
    return res.sendFile(fp);
  }

  res.status(404).send('ไม่พบไฟล์: ' + rawPath);
});

// ══════════════════════════════════════════
// SHUTDOWN
// ══════════════════════════════════════════
const SHUTDOWN_TOKEN = process.env.FV_SHUTDOWN_TOKEN || '';

async function gracefulShutdown(reason = 'manual') {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (CONSOLE_MODE !== 'off') console.log(`\n🛑 Shutting down... (${reason})`);
  writeData('stats', stats);
  try { await statsSync.stopSync(); } catch {}
  try { await sendOffline?.(); } catch {}
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
  stats.errors++;
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: `ไฟล์ใหญ่เกิน (สูงสุด ${formatSize(FILE_SIZE_BYTES)})` });
  res.status(500).json({ ok: false, error: err.message });
});

// ══════════════════════════════════════════
// START
// ══════════════════════════════════════════
function printBanner(port) {
  const ip   = getLocalIP();
  const info = getStorageInfo();
  const r2ok = !!(r2?.R2_CONFIG?.ACCOUNT_ID && r2?.R2_CONFIG?.BUCKET);
  if (CONSOLE_MODE === 'off') return;
  if (CONSOLE_MODE === 'minimal') {
    console.log(`\n  ${CYN}☁ FileVault${R}  http://${ip}:${port}  R2:${r2ok ? GRN + '✓' : RED + '✗'}${R}  [FV_CONSOLE=status/minimal/off]\n`);
    return;
  }
  console.log(`\n${B}${CYN}  ☁  FileVault Server${R}`);
  console.log(`${GRY}  ${'═'.repeat(44)}${R}`);
  console.log(`  ${B}Local  :${R}  http://localhost:${port}`);
  console.log(`  ${B}Network:${R}  ${GRN}http://${ip}:${port}${R}`);
  console.log(`${GRY}  ${'─'.repeat(44)}${R}`);
  console.log(`  ${B}Storage:${R} ${CYN}${info.unlimited ? 'ไม่จำกัด' : formatSize(info.limit)}${R}   Per-file: ${CYN}${CONFIG.FILE_SIZE_LIMIT || 'ไม่จำกัด'}${R}`);
  console.log(`  ${B}R2     :${R} ${r2ok ? GRN + '✓ ' + r2.R2_CONFIG.BUCKET : RED + '✗ ยังไม่ได้ตั้งค่า env'}${R}`);
  console.log(`${GRY}  ${'─'.repeat(44)}${R}`);
  console.log(`  ${GRY}Console mode: ${B}${CONSOLE_MODE}${R}${GRY}  (FV_CONSOLE=status|minimal|off)${R}`);
  console.log(`  ${GRY}[Ctrl+C เพื่อหยุด]${R}\n`);
}

function startServer(port) {
  const httpServer = http.createServer(app);
  app.set('server', httpServer);

  httpServer.listen(port, '0.0.0.0', async () => {
    printBanner(port);

    try { await sendOnline?.(); setStats?.(stats); setShutdownCallback?.(() => gracefulShutdown('discord')); }
    catch (e) { if (CONSOLE_MODE !== 'off') console.log('Discord error:', e.message); }

    // R2 stats sync
    try {
      const remote = await statsSync.loadStats(stats);
      for (const k of Object.keys(remote)) {
        if (typeof remote[k] === 'number' && typeof stats[k] === 'number') stats[k] = Math.max(stats[k], remote[k]);
      }
      writeData('stats', stats);
      statsSync.startSync(stats);
    } catch (e) {
      if (CONSOLE_MODE !== 'off') console.warn('⚠ R2 stats sync init failed:', e.message);
    }

    await loadLocksFromR2();

    if (CONSOLE_MODE !== 'off' && CONSOLE_MODE !== 'minimal' && CONFIG.STATUS_INTERVAL > 0) {
      setTimeout(() => { printStatus(); setInterval(printStatus, CONFIG.STATUS_INTERVAL); }, 1500);
    } else if (CONSOLE_MODE === 'minimal' && CONFIG.STATUS_INTERVAL > 0) {
      setInterval(printStatus, CONFIG.STATUS_INTERVAL);
    }
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') { console.log(`Port ${port} busy → trying ${port + 1}`); startServer(port + 1); }
    else console.error(err);
  });
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ══════════════════════════════════════════
// STARTUP — เลือก Console Mode
// ══════════════════════════════════════════
const VALID_MODES = ['status', 'minimal', 'off'];

function promptConsoleMode() {
  return new Promise((resolve) => {
    if (VALID_MODES.includes(CONSOLE_MODE)) return resolve(CONSOLE_MODE);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    process.stdout.write('\n');
    process.stdout.write('  \x1b[1m\x1b[36m☁  FileVault Server\x1b[0m\n');
    process.stdout.write('  \x1b[90m' + '─'.repeat(40) + '\x1b[0m\n\n');
    process.stdout.write('  เลือกโหมด Console:\n\n');
    process.stdout.write('  \x1b[1m\x1b[32m[1]\x1b[0m \x1b[1mstatus\x1b[0m   \x1b[90m— dashboard เต็ม อัปเดตทุก 5s\x1b[0m\n');
    process.stdout.write('  \x1b[1m\x1b[36m[2]\x1b[0m \x1b[1mminimal\x1b[0m  \x1b[90m— single line ไม่กระพริบ\x1b[0m\n');
    process.stdout.write('  \x1b[1m\x1b[90m[3]\x1b[0m \x1b[1moff\x1b[0m      \x1b[90m— ไม่แสดง log\x1b[0m\n\n');

    const ask = () => {
      rl.question('  \x1b[1mเลือก [1/2/3] (default: 1):\x1b[0m ', (ans) => {
        const map = { '1':'status', '2':'minimal', '3':'off', '':'status', 'status':'status', 'minimal':'minimal', 'off':'off' };
        const chosen = map[ans.trim().toLowerCase()];
        if (chosen) {
          rl.close();
          process.stdout.write('\n  \x1b[90mMode: \x1b[1m' + chosen + '\x1b[0m  \x1b[90m(ตั้ง FV_CONSOLE=' + chosen + ' เพื่อข้ามขั้นตอนนี้)\x1b[0m\n\n');
          resolve(chosen);
        } else {
          process.stdout.write('  \x1b[31mกรุณาพิมพ์ 1, 2, หรือ 3\x1b[0m\n');
          ask();
        }
      });
    };
    ask();
  });
}

promptConsoleMode().then((mode) => {
  CONSOLE_MODE = mode;
  startServer(PORT);
});

module.exports = { CONFIG, STORAGE_LIMIT_BYTES, FILE_SIZE_BYTES, formatSize, stats };
