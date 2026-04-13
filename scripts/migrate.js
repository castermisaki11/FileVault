#!/usr/bin/env node
/**
 * scripts/migrate.js — รัน PostgreSQL migrations
 *
 * วิธีใช้:
 *   npm run migrate
 *   node scripts/migrate.js
 *
 * ต้องการ:
 *   DATABASE_URL ใน .env หรือ environment variable
 */

require('dotenv').config();
const db = require('../src/core/db');

async function main() {
  console.log('🐘 [migrate] เริ่ม migration...');

  const pool = db.getPool();
  if (!pool) {
    console.error('❌ [migrate] DATABASE_URL ไม่ได้ตั้งค่า — ตั้งค่าใน .env ก่อน');
    process.exit(1);
  }

  // ตรวจ connection
  const healthy = await db.isHealthy();
  if (!healthy) {
    console.error('❌ [migrate] เชื่อมต่อ PostgreSQL ไม่ได้ — ตรวจสอบ DATABASE_URL');
    process.exit(1);
  }
  console.log('✅ [migrate] เชื่อมต่อ PostgreSQL สำเร็จ');

  // รัน migration
  const ok = await db.runMigrations();
  if (!ok) {
    console.error('❌ [migrate] Migration ล้มเหลว');
    await db.close();
    process.exit(1);
  }

  console.log('✅ [migrate] Migration สำเร็จ — ตาราง ready ทั้งหมด');
  console.log('   • folder_locks');
  console.log('   • site_sessions');
  console.log('   • file_events');
  console.log('   • upload_stats');
  console.log('   • function upsert_daily_stat()');

  await db.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ [migrate] Unexpected error:', err.message);
  process.exit(1);
});
