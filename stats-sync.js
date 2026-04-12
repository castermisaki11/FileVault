// stats-sync.js — sync stats object กับ Cloudflare R2
// บันทึกขึ้น R2 ทุก interval และโหลดกลับมาตอน server start

const r2 = require('./r2');

const STATS_KEY      = process.env.FV_STATS_KEY      || 'system/stats.json';
const SYNC_INTERVAL  = parseInt(process.env.FV_STATS_SYNC_MS || '15000', 10); // default 15s

let _stats    = null;
let _interval = null;
let _dirty    = false; // มีการเปลี่ยนแปลงค้างอยู่ไหม

// ── Load stats จาก R2 ──
async function loadStats(fallback = {}) {
  try {
    const obj = await r2.downloadObject(STATS_KEY);
    const remote = JSON.parse(obj.buffer.toString('utf8'));
    console.log('📥 [stats-sync] Loaded stats from R2:', STATS_KEY);
    // merge: remote เป็น base, fallback ครอบ key ที่ remote ไม่มี
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

// ── Save stats ขึ้น R2 ──
async function saveStats(statsObj) {
  try {
    const buf = Buffer.from(JSON.stringify(statsObj, null, 2), 'utf8');
    await r2.uploadObject(STATS_KEY, buf, 'application/json');
    _dirty = false;
  } catch (e) {
    console.warn('⚠ [stats-sync] Save error:', e.message);
  }
}

// ── เริ่ม auto-sync ──
// statsRef: object reference ที่ server.js ใช้ (เดิม = stats)
function startSync(statsRef) {
  _stats = statsRef;

  // patch: intercept property changes เพื่อ mark dirty
  // (optional — หรือจะ push ทุก interval เลยก็ได้)
  _interval = setInterval(async () => {
    if (_stats) await saveStats(_stats);
  }, SYNC_INTERVAL);

  console.log(`☁  [stats-sync] Auto-sync started → R2:${STATS_KEY} every ${SYNC_INTERVAL/1000}s`);
}

// ── หยุด sync และ flush ครั้งสุดท้าย ──
async function stopSync() {
  if (_interval) { clearInterval(_interval); _interval = null; }
  if (_stats)    { await saveStats(_stats); console.log('💾 [stats-sync] Final flush → R2'); }
}

// ── Force save ทันที ──
async function flushNow() {
  if (_stats) await saveStats(_stats);
}

module.exports = { loadStats, saveStats, startSync, stopSync, flushNow, STATS_KEY };
