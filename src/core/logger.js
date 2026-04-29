/**
 * logger.js — Structured logging for FileVault
 *
 * Features:
 *  - Levels: DEBUG | INFO | WARN | ERROR
 *  - Namespaced loggers (e.g. logger.child('auth'))
 *  - Coloured console output
 *  - Rotating file output  (logs/app-YYYY-MM-DD.log)
 *  - "save log" command  → flushes a timestamped snapshot to logs/saved/
 *  - HTTP request middleware with response-time
 *  - Compatible with the existing console.log / console.warn / console.error
 *    calls throughout the project (monkey-patched when INTERCEPT_CONSOLE=true)
 *
 * env:
 *   LOG_LEVEL          — debug | info | warn | error  (default: info)
 *   LOG_DIR            — directory for log files       (default: <root>/logs)
 *   LOG_TO_FILE        — true | false                  (default: true)
 *   LOG_TO_CONSOLE     — true | false                  (default: true)
 *   LOG_MAX_DAYS       — days to keep rotated files    (default: 14)
 *   INTERCEPT_CONSOLE  — true | false                  (default: true)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs   = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_LABEL = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };
const LEVEL_COLOR = { debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';
const DIM   = '\x1b[2m';
const BOLD  = '\x1b[1m';

const CFG = {
  level:            (process.env.LOG_LEVEL    || 'info').toLowerCase(),
  dir:               process.env.LOG_DIR      || path.join(__dirname, '..', '..', 'logs'),
  toFile:           (process.env.LOG_TO_FILE      ?? 'true') === 'true',
  toConsole:        (process.env.LOG_TO_CONSOLE   ?? 'true') === 'true',
  maxDays:           parseInt(process.env.LOG_MAX_DAYS || '14', 10),
  interceptConsole: (process.env.INTERCEPT_CONSOLE ?? 'true') === 'true',
};

// ── Directory setup ─────────────────────────────────────────────────────────
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(CFG.dir);
ensureDir(path.join(CFG.dir, 'saved'));

// ── Current log file ─────────────────────────────────────────────────────────
let _currentDate = '';
let _fileStream  = null;

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getFileStream() {
  if (!CFG.toFile) return null;
  const today = todayStr();
  if (today !== _currentDate || !_fileStream) {
    if (_fileStream) { try { _fileStream.end(); } catch {} }
    _currentDate = today;
    const fp = path.join(CFG.dir, `app-${today}.log`);
    _fileStream = fs.createWriteStream(fp, { flags: 'a', encoding: 'utf8' });
    _fileStream.on('error', e => {
      // eslint-disable-next-line no-console
      process.stderr.write(`[logger] File stream error: ${e.message}\n`);
    });
  }
  return _fileStream;
}

// ── Formatter ────────────────────────────────────────────────────────────────
function isoNow() { return new Date().toISOString(); }

function formatConsole(level, ns, message, meta) {
  const ts    = `${DIM}${isoNow()}${RESET}`;
  const lvl   = `${LEVEL_COLOR[level]}${BOLD}${LEVEL_LABEL[level]}${RESET}`;
  const nsStr = ns ? ` ${DIM}[${ns}]${RESET}` : '';
  const msg   = message;
  const metaStr = meta && Object.keys(meta).length
    ? ' ' + DIM + JSON.stringify(meta) + RESET
    : '';
  return `${ts} ${lvl}${nsStr} ${msg}${metaStr}`;
}

function formatFile(level, ns, message, meta) {
  const entry = {
    ts:      isoNow(),
    level,
    ns:      ns || undefined,
    message,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };
  return JSON.stringify(entry);
}

// ── Write ─────────────────────────────────────────────────────────────────────
function write(level, ns, message, meta) {
  if ((LEVELS[level] ?? 99) < (LEVELS[CFG.level] ?? 1)) return;

  if (CFG.toConsole) {
    const line = formatConsole(level, ns, message, meta);
    if (level === 'error') process.stderr.write(line + '\n');
    else                   process.stdout.write(line + '\n');
  }

  if (CFG.toFile) {
    const stream = getFileStream();
    if (stream) stream.write(formatFile(level, ns, message, meta) + '\n');
  }
}

// ── Logger factory ───────────────────────────────────────────────────────────
function createLogger(namespace) {
  return {
    debug: (msg, meta) => write('debug', namespace, msg, meta),
    info:  (msg, meta) => write('info',  namespace, msg, meta),
    warn:  (msg, meta) => write('warn',  namespace, msg, meta),
    error: (msg, meta) => write('error', namespace, msg, meta),
    /** Create a child logger with a sub-namespace */
    child: (sub) => createLogger(namespace ? `${namespace}:${sub}` : sub),
  };
}

const rootLogger = createLogger('');

// ── Console interception ─────────────────────────────────────────────────────
// Redirects native console.* calls so all existing log lines go through
// the unified pipeline (coloured + written to file).
let _consolePatched = false;
function patchConsole() {
  if (_consolePatched || !CFG.interceptConsole) return;
  _consolePatched = true;

  const _orig = {
    log:   console.log.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug?.bind(console),
  };

  function toStr(args) {
    return args.map(a =>
      (typeof a === 'string') ? a
      : (a instanceof Error)  ? `${a.message}\n${a.stack}`
      : JSON.stringify(a)
    ).join(' ');
  }

  console.log   = (...args) => write('info',  'console', toStr(args));
  console.info  = (...args) => write('info',  'console', toStr(args));
  console.warn  = (...args) => write('warn',  'console', toStr(args));
  console.error = (...args) => write('error', 'console', toStr(args));
  console.debug = (...args) => write('debug', 'console', toStr(args));

  // Expose originals in case anything truly needs them
  console._orig = _orig;
}

// ── HTTP request middleware ──────────────────────────────────────────────────
const httpLogger = createLogger('http');

function requestMiddleware(req, res, next) {
  const start = Date.now();

  // Skip noisy health-check endpoints unless debug level
  const quiet = ['/api/db/health', '/api/r2/status'];
  const isQuiet = quiet.some(p => req.path === p);

  res.on('finish', () => {
    const ms     = Date.now() - start;
    const status = res.statusCode;
    const level  = status >= 500 ? 'error' : status >= 400 ? 'warn' : isQuiet ? 'debug' : 'info';
    const ip     = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();

    httpLogger[level](`${req.method} ${req.path} ${status}`, {
      ms,
      ip,
      uid: req.user?.id ?? undefined,
      ua:  req.headers['user-agent']?.slice(0, 80) ?? undefined,
    });
  });

  next();
}

// ── Log rotation: delete files older than maxDays ────────────────────────────
function rotateOldLogs() {
  const cutoff = Date.now() - CFG.maxDays * 86_400_000;
  try {
    for (const f of fs.readdirSync(CFG.dir)) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const fp = path.join(CFG.dir, f);
      if (fs.statSync(fp).mtimeMs < cutoff) {
        fs.unlinkSync(fp);
        rootLogger.info(`Rotated old log file: ${f}`, { ns: 'logger' });
      }
    }
  } catch (e) {
    rootLogger.warn('Log rotation error', { error: e.message });
  }
}

// ── "save log" command ───────────────────────────────────────────────────────
/**
 * saveLog(label?)
 *   Copies the current day's log file into logs/saved/
 *   with a timestamped filename.
 *   Also emits a SAVE_LOG event entry in the log itself.
 *
 *   Trigger: call saveLog() from any module, OR hit POST /api/logs/save
 */
async function saveLog(label = '') {
  const ts       = new Date().toISOString().replace(/[:.]/g, '-');
  const srcDate  = todayStr();
  const srcFile  = path.join(CFG.dir, `app-${srcDate}.log`);
  const saveDir  = path.join(CFG.dir, 'saved');
  const suffix   = label ? `_${label.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
  const destFile = path.join(saveDir, `log-${ts}${suffix}.log`);

  // Always log the save-log event itself first (so it appears in the saved copy)
  rootLogger.info('💾 save log command executed', {
    savedAs:  path.basename(destFile),
    label:    label || undefined,
    srcFile:  path.basename(srcFile),
    trigger:  new Error().stack.split('\n')[2]?.trim() ?? 'unknown',
  });

  // Flush any pending writes by closing & re-opening the stream
  if (_fileStream) {
    await new Promise(resolve => {
      _fileStream.once('drain', resolve);
      if (!_fileStream.writableNeedDrain) resolve();
    });
  }

  ensureDir(saveDir);

  try {
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      rootLogger.info(`✅ Log saved: logs/saved/${path.basename(destFile)}`);
    } else {
      // No file yet (file logging disabled or no logs today) — write a manifest
      const manifest = JSON.stringify({
        savedAt: new Date().toISOString(),
        label:   label || null,
        note:    'No log file found — file logging may be disabled',
      }, null, 2);
      fs.writeFileSync(destFile, manifest, 'utf8');
      rootLogger.warn('save log: no source log file found; wrote manifest instead');
    }
  } catch (e) {
    rootLogger.error('save log: copy failed', { error: e.message });
    throw e;
  }

  return destFile;
}

/**
 * getSavedLogs() — list files in logs/saved/
 */
function getSavedLogs() {
  const saveDir = path.join(CFG.dir, 'saved');
  ensureDir(saveDir);
  return fs.readdirSync(saveDir)
    .filter(f => f.endsWith('.log'))
    .map(f => {
      const fp = path.join(saveDir, f);
      const st = fs.statSync(fp);
      return { name: f, size: st.size, createdAt: st.birthtimeMs || st.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ── Express routes (mounted by server.js) ───────────────────────────────────
function createLogRoutes(app) {
  const routeLogger = createLogger('log-api');

  // POST /api/logs/save  — trigger a save-log snapshot
  app.post('/api/logs/save', async (req, res) => {
    try {
      const label   = req.body?.label || req.query.label || '';
      const outFile = await saveLog(label);
      routeLogger.info('save log via API', { label, file: path.basename(outFile), user: req.user?.id });
      res.json({ ok: true, savedAs: path.basename(outFile) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/logs/saved  — list saved snapshots
  app.get('/api/logs/saved', (req, res) => {
    try {
      res.json({ ok: true, files: getSavedLogs() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/logs/saved/:name  — download a saved snapshot
  app.get('/api/logs/saved/:name', (req, res) => {
    const name = path.basename(req.params.name); // strip any path traversal
    if (!name.endsWith('.log')) return res.status(400).json({ ok: false, error: 'Invalid filename' });
    const fp = path.join(CFG.dir, 'saved', name);
    if (!fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'Not found' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.sendFile(fp);
  });

  // GET /api/logs/today  — stream today's raw log (last N lines)
  app.get('/api/logs/today', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 2000);
    const fp    = path.join(CFG.dir, `app-${todayStr()}.log`);
    if (!fs.existsSync(fp)) return res.json({ ok: true, lines: [] });

    try {
      const raw   = fs.readFileSync(fp, 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean).slice(-limit)
        .map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      res.json({ ok: true, lines, count: lines.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

// ── Graceful close ───────────────────────────────────────────────────────────
function close() {
  return new Promise(resolve => {
    if (_fileStream) {
      _fileStream.end(() => { _fileStream = null; resolve(); });
    } else {
      resolve();
    }
  });
}

// ── Module exports ───────────────────────────────────────────────────────────
module.exports = {
  // Core logger (root)
  ...rootLogger,
  // Factory
  createLogger,
  child: rootLogger.child,
  // Middleware
  requestMiddleware,
  // Console patch (call once at startup)
  patchConsole,
  // Maintenance
  rotateOldLogs,
  close,
  // Save-log command
  saveLog,
  getSavedLogs,
  // Routes
  createLogRoutes,
  // Config inspection
  CFG,
};
