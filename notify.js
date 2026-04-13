/**
 * notify.js — shim สำหรับ server.js
 *
 * Bot ย้ายไปอยู่ใน bot.js แล้ว ไฟล์นี้เป็น stub
 * เพื่อไม่ให้ server.js ต้อง require อะไรเพิ่ม
 *
 * server.js จะ require('./notify') แล้วใช้:
 *   sendOnline()          → no-op (bot จัดการเอง)
 *   sendOffline()         → no-op
 *   setShutdownCallback() → no-op
 *   setStats()            → no-op
 */

async function sendOnline()  {}
async function sendOffline() {}
function setShutdownCallback(cb) {}
function setStats(s) {}

module.exports = { sendOnline, sendOffline, setShutdownCallback, setStats };
