/**
 * db.js — PostgreSQL Database Layer for FileVault
 *
 * แทนที่ JSON flat-files ด้วย PostgreSQL สำหรับ:
 *   - folder_locks   (เดิม: data/folder-locks.json)
 *   - upload_stats   (เดิม: data/stats.json ผ่าน stats-sync)
 *   - file_events    (audit log ใหม่)
 *   - sessions       (site-auth tokens เดิมเก็บใน Set)
 *
 * env ที่ต้องการ:
 *   DATABASE_URL     — PostgreSQL connection string (ต้องมี)
 *   DB_SSL           — 'true' | 'false' | 'require' (default: auto)
 *   DB_POOL_MAX      — max connections (default: 10)
 *   DB_POOL_IDLE_MS  — idle timeout ms (default: 30000)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { Pool } = require('pg');

// ── Connection Pool ─────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.warn('⚠  [db] DATABASE_URL ไม่ได้ตั้งค่า — ฟีเจอร์ฐานข้อมูลจะปิดการทำงาน');
}

let pool = null;

function getPool() {
  if (!pool && DATABASE_URL) {
    const sslEnv = process.env.DB_SSL || 'auto';
    let ssl;
    if (sslEnv === 'false') ssl = false;
    else if (sslEnv === 'true' || sslEnv === 'require') ssl = { rejectUnauthorized: false };
    else {
      // auto: เปิด SSL ถ้าเป็น URL ที่ไม่ใช่ localhost
      const isLocal = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1');
      ssl = isLocal ? false : { rejectUnauthorized: false };
    }

    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl,
      max:            parseInt(process.env.DB_POOL_MAX      || '10',    10),
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_MS || '30000', 10),
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('❌ [db] PostgreSQL pool error:', err.message);
    });

    console.log('🐘 [db] PostgreSQL pool สร้างแล้ว');
  }
  return pool;
}

// ── Schema Migration ────────────────────────────────────────────────────────

const SCHEMA_SQL = `
-- ── Folder Locks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS folder_locks (
  folder      TEXT        PRIMARY KEY,
  pin_hash    TEXT        NOT NULL,
  hint        TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Site Auth Sessions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_sessions (
  token       TEXT        PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_sessions_expires ON site_sessions (expires_at);

-- ── File Events (Audit Log) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_events (
  id          BIGSERIAL   PRIMARY KEY,
  event_type  TEXT        NOT NULL,   -- 'upload' | 'download' | 'delete' | 'move' | 'rename' | 'folder_create' | 'folder_delete'
  file_name   TEXT,
  folder      TEXT        NOT NULL DEFAULT '',
  r2_key      TEXT,
  file_size   BIGINT,
  ip          TEXT,
  user_agent  TEXT,
  meta        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_file_events_type       ON file_events (event_type);
CREATE INDEX IF NOT EXISTS idx_file_events_folder     ON file_events (folder);
CREATE INDEX IF NOT EXISTS idx_file_events_created_at ON file_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_events_file_name  ON file_events (file_name);

-- ── Upload Statistics ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS upload_stats (
  id              BIGSERIAL   PRIMARY KEY,
  period_date     DATE        NOT NULL DEFAULT CURRENT_DATE,
  upload_count    BIGINT      NOT NULL DEFAULT 0,
  upload_bytes    BIGINT      NOT NULL DEFAULT 0,
  download_count  BIGINT      NOT NULL DEFAULT 0,
  download_bytes  BIGINT      NOT NULL DEFAULT 0,
  delete_count    BIGINT      NOT NULL DEFAULT 0,
  UNIQUE (period_date)
);
CREATE INDEX IF NOT EXISTS idx_upload_stats_date ON upload_stats (period_date DESC);

-- ── Helper: upsert today's stats row ──────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_daily_stat(
  p_upload_count    BIGINT DEFAULT 0,
  p_upload_bytes    BIGINT DEFAULT 0,
  p_download_count  BIGINT DEFAULT 0,
  p_download_bytes  BIGINT DEFAULT 0,
  p_delete_count    BIGINT DEFAULT 0
) RETURNS VOID AS $$
BEGIN
  INSERT INTO upload_stats (period_date, upload_count, upload_bytes, download_count, download_bytes, delete_count)
  VALUES (CURRENT_DATE, p_upload_count, p_upload_bytes, p_download_count, p_download_bytes, p_delete_count)
  ON CONFLICT (period_date) DO UPDATE SET
    upload_count   = upload_stats.upload_count   + EXCLUDED.upload_count,
    upload_bytes   = upload_stats.upload_bytes   + EXCLUDED.upload_bytes,
    download_count = upload_stats.download_count + EXCLUDED.download_count,
    download_bytes = upload_stats.download_bytes + EXCLUDED.download_bytes,
    delete_count   = upload_stats.delete_count   + EXCLUDED.delete_count;
END;
$$ LANGUAGE plpgsql;
`;

async function runMigrations() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(SCHEMA_SQL);
    console.log('✅ [db] Migration สำเร็จ — ตาราง ready');
    return true;
  } catch (err) {
    console.error('❌ [db] Migration ล้มเหลว:', err.message);
    return false;
  }
}

// ── Health Check ────────────────────────────────────────────────────────────

async function isHealthy() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// ── Folder Locks ────────────────────────────────────────────────────────────

async function getLocks() {
  const p = getPool();
  if (!p) return {};
  const res = await p.query('SELECT folder, pin_hash, hint FROM folder_locks');
  const out = {};
  for (const row of res.rows) {
    out[row.folder] = { hash: row.pin_hash, hint: row.hint || '' };
  }
  return out;
}

async function setLock(folder, pinHash, hint = '') {
  const p = getPool();
  if (!p) return;
  await p.query(
    `INSERT INTO folder_locks (folder, pin_hash, hint, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (folder) DO UPDATE SET
       pin_hash   = EXCLUDED.pin_hash,
       hint       = EXCLUDED.hint,
       updated_at = NOW()`,
    [folder, pinHash, hint]
  );
}

async function removeLock(folder) {
  const p = getPool();
  if (!p) return;
  await p.query('DELETE FROM folder_locks WHERE folder = $1', [folder]);
}

async function getLock(folder) {
  const p = getPool();
  if (!p) return null;
  const res = await p.query(
    'SELECT pin_hash, hint FROM folder_locks WHERE folder = $1',
    [folder]
  );
  if (!res.rows.length) return null;
  return { hash: res.rows[0].pin_hash, hint: res.rows[0].hint || '' };
}

// ── Site Sessions ────────────────────────────────────────────────────────────

async function addSession(token, ip = null) {
  const p = getPool();
  if (!p) return;
  await p.query(
    `INSERT INTO site_sessions (token, ip) VALUES ($1, $2)
     ON CONFLICT (token) DO NOTHING`,
    [token, ip]
  );
}

async function hasSession(token) {
  const p = getPool();
  if (!p) return false;
  const res = await p.query(
    'SELECT 1 FROM site_sessions WHERE token = $1 AND expires_at > NOW()',
    [token]
  );
  return res.rows.length > 0;
}

async function removeSession(token) {
  const p = getPool();
  if (!p) return;
  await p.query('DELETE FROM site_sessions WHERE token = $1', [token]);
}

async function cleanExpiredSessions() {
  const p = getPool();
  if (!p) return 0;
  const res = await p.query('DELETE FROM site_sessions WHERE expires_at <= NOW()');
  return res.rowCount || 0;
}

// ── File Events (Audit Log) ──────────────────────────────────────────────────

async function logFileEvent({ eventType, fileName, folder = '', r2Key, fileSize, ip, userAgent, meta = {} }) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `INSERT INTO file_events
         (event_type, file_name, folder, r2_key, file_size, ip, user_agent, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [eventType, fileName, folder, r2Key, fileSize || null, ip || null, userAgent || null, JSON.stringify(meta)]
    );
  } catch (err) {
    // ไม่ throw เพราะ audit log ไม่ควรทำให้ request หลักล้มเหลว
    console.warn('⚠ [db] logFileEvent error:', err.message);
  }
}

async function getFileEvents({ folder, eventType, limit = 100, offset = 0, since, until } = {}) {
  const p = getPool();
  if (!p) return [];
  const conditions = [];
  const params = [];
  let idx = 1;

  if (folder !== undefined) { conditions.push(`folder = $${idx++}`);      params.push(folder); }
  if (eventType)            { conditions.push(`event_type = $${idx++}`);  params.push(eventType); }
  if (since)                { conditions.push(`created_at >= $${idx++}`); params.push(since); }
  if (until)                { conditions.push(`created_at <= $${idx++}`); params.push(until); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit, offset);

  const res = await p.query(
    `SELECT id, event_type, file_name, folder, r2_key, file_size, ip, created_at, meta
     FROM file_events
     ${where}
     ORDER BY created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    params
  );
  return res.rows;
}

// ── Statistics ───────────────────────────────────────────────────────────────

async function recordStat({ uploadCount = 0, uploadBytes = 0, downloadCount = 0, downloadBytes = 0, deleteCount = 0 } = {}) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      'SELECT upsert_daily_stat($1, $2, $3, $4, $5)',
      [uploadCount, uploadBytes, downloadCount, downloadBytes, deleteCount]
    );
  } catch (err) {
    console.warn('⚠ [db] recordStat error:', err.message);
  }
}

async function getStats({ days = 30 } = {}) {
  const p = getPool();
  if (!p) return [];
  const res = await p.query(
    `SELECT
       period_date,
       upload_count,
       upload_bytes,
       download_count,
       download_bytes,
       delete_count
     FROM upload_stats
     WHERE period_date >= CURRENT_DATE - INTERVAL '${parseInt(days, 10)} days'
     ORDER BY period_date DESC`
  );
  return res.rows;
}

async function getTotalStats() {
  const p = getPool();
  if (!p) return null;
  const res = await p.query(
    `SELECT
       COALESCE(SUM(upload_count),   0)::BIGINT AS total_uploads,
       COALESCE(SUM(upload_bytes),   0)::BIGINT AS total_upload_bytes,
       COALESCE(SUM(download_count), 0)::BIGINT AS total_downloads,
       COALESCE(SUM(download_bytes), 0)::BIGINT AS total_download_bytes,
       COALESCE(SUM(delete_count),   0)::BIGINT AS total_deletes
     FROM upload_stats`
  );
  return res.rows[0];
}

// ── Graceful Close ───────────────────────────────────────────────────────────

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('🐘 [db] Pool ปิดแล้ว');
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getPool,
  runMigrations,
  isHealthy,
  // Locks
  getLocks,
  getLock,
  setLock,
  removeLock,
  // Sessions
  addSession,
  hasSession,
  removeSession,
  cleanExpiredSessions,
  // Events
  logFileEvent,
  getFileEvents,
  // Stats
  recordStat,
  getStats,
  getTotalStats,
  // Lifecycle
  close,
};
