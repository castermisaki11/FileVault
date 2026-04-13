/**
 * stats-sync.js — DEPRECATED
 *
 * ไฟล์นี้ถูก supersede โดย PostgreSQL (db.js → upload_stats table)
 * เก็บไว้เพื่อ backward-compat เท่านั้น — ไม่เขียนลง R2 อีกต่อไป
 *
 * Migration path:
 *   เดิม: startSync(statsRef) → save JSON → R2:system/stats.json
 *   ใหม่: db.recordStat({...})  → PostgreSQL upload_stats table
 *
 * ถ้ายังมีโค้ดเรียก startSync / stopSync / loadStats อยู่ที่ไหน
 * ฟังก์ชันเหล่านี้จะ no-op โดยไม่ throw error
 */

console.warn('⚠  [stats-sync] DEPRECATED — stats ถูกย้ายไป PostgreSQL (db.recordStat) แล้ว');

const STATS_KEY = process.env.FV_STATS_KEY || 'system/stats.json';

/** @deprecated ใช้ db.getStats() แทน */
async function loadStats(fallback = {}) {
  console.warn('[stats-sync] loadStats() deprecated — ใช้ db.getStats() แทน');
  return fallback;
}

/** @deprecated ใช้ db.recordStat() แทน */
async function saveStats(_statsObj) {
  console.warn('[stats-sync] saveStats() deprecated — ใช้ db.recordStat() แทน');
}

/** @deprecated no-op */
function startSync(_statsRef) {
  console.warn('[stats-sync] startSync() deprecated — stats sync ถูกจัดการโดย PostgreSQL แล้ว');
}

/** @deprecated no-op */
async function stopSync() {}

/** @deprecated no-op */
async function flushNow() {}

module.exports = { loadStats, saveStats, startSync, stopSync, flushNow, STATS_KEY };
