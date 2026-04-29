// stats-sync.js — sync stats กับ Cloudflare R2

const r2 = require('../core/r2');

const STATS_KEY     = process.env.FV_STATS_KEY    || 'system/stats.json';
const SYNC_INTERVAL = parseInt(process.env.FV_STATS_SYNC_MS || '15000', 10);

let _stats    = null;
let _interval = null;
let _saving   = false; // ป้องกัน concurrent save

// ── Load stats จาก R2 ──
async function loadStats(fallback = {}) {
  try {
    const obj    = await r2.downloadObject(STATS_KEY);
    const remote = JSON.parse(obj.buffer.toString('utf8'));
    console.log('📥 [stats-sync] Loaded stats from R2:', STATS_KEY);
    return { ...fallback, ...remote };
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 404 || e.name === 'NoSuchKey' || e.Code === 'NoSuchKey') {
      console.log('📊 [stats-sync] No remote stats found — starting fresh');
    } else {
      console.warn('⚠ [stats-sync] Load error:', e.message, '— using local fallback');
    }
    return fallback;
  }
}

// ── Save (idempotent, skip ถ้ากำลัง save อยู่) ──
async function saveStats(statsObj) {
  if (_saving) return;
  _saving = true;
  try {
    const buf = Buffer.from(JSON.stringify(statsObj, null, 2), 'utf8');
    await r2.uploadObject(STATS_KEY, buf, 'application/json');
  } catch (e) {
    console.warn('⚠ [stats-sync] Save error:', e.message);
  } finally {
    _saving = false;
  }
}

// ── Start auto-sync ──
function startSync(statsRef) {
  _stats    = statsRef;
  _interval = setInterval(async () => {
    if (_stats) await saveStats(_stats);
  }, SYNC_INTERVAL);
  console.log(`☁  [stats-sync] Auto-sync → R2:${STATS_KEY} every ${SYNC_INTERVAL / 1000}s`);
}

// ── Stop + final flush ──
async function stopSync() {
  if (_interval) { clearInterval(_interval); _interval = null; }
  if (_stats)    { await saveStats(_stats); console.log('💾 [stats-sync] Final flush → R2'); }
}

async function flushNow() {
  if (_stats) await saveStats(_stats);
}

module.exports = { loadStats, saveStats, startSync, stopSync, flushNow, STATS_KEY };
