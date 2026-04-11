require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");
const os = require("os");
const https = require("https");
const http = require("http");
const r2 = require("./r2");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const token = process.env.DISCORD_TOKEN;
const channelId = process.env.CHANNEL_ID;
const domain = process.env.DOMAIN;
const imageFolder = process.env.DISCORD_IMAGE_FOLDER || "discord-images";

// ───────────────
// 📥 DOWNLOAD URL TO BUFFER
// ───────────────
function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers["content-type"] || "application/octet-stream" }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

let message = null;
let startTime = Date.now();
let interval = null;

// stats object — server.js จะ inject ผ่าน setStats()
let stats = { r2_uploads: 0, r2_downloads: 0, r2_deletes: 0 };

// ── Persist message ID to disk so we can delete it even after crash/kill ──
const nodePath = require("path");
const nodeFs   = require("fs");
const MSG_ID_FILE = nodePath.join(__dirname, "data", ".discord-msg-id.json");

function saveMessageId(chId, msgId) {
  try {
    nodeFs.mkdirSync(nodePath.dirname(MSG_ID_FILE), { recursive: true });
    nodeFs.writeFileSync(MSG_ID_FILE, JSON.stringify({ channelId: chId, messageId: msgId }));
  } catch {}
}
function clearMessageId() { try { nodeFs.unlinkSync(MSG_ID_FILE); } catch {} }
function loadMessageId()  { try { return JSON.parse(nodeFs.readFileSync(MSG_ID_FILE, "utf8")); } catch { return null; } }

// ───────────────
// 🕒 TIME
// ───────────────
function getThaiTime() {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

// ───────────────
// ⏱️ UPTIME
// ───────────────
function uptime() {
  const sec = Math.floor((Date.now() - startTime) / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ${sec % 60}s`;
}

// ───────────────
// 🧠 MEMORY USAGE
// ───────────────
function memoryUsage() {
  const mem = process.memoryUsage().heapUsed / 1024 / 1024;
  return `${mem.toFixed(2)} MB`;
}

// ───────────────
// 💻 CPU USAGE (simple load avg)
// ───────────────
function cpuUsage() {
  const load = os.loadavg()[0];
  return `${load.toFixed(2)}%`;
}

// ───────────────
// 🌐 IP
// ───────────────
function getLocalIP() {
  const nets = os.networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return `https://${net.address}:3000`;
      }
    }
  }
  return "Unknown";
}

// ───────────────
// 📊 BUILD EMBED
// ───────────────
function buildEmbed() {
  return {
    title: "📊 REALTIME SERVER DASHBOARD",
    color: 0x3498db,
    fields: [
      { name: "⚙️ Status", value: "🟢 Online", inline: true },
      { name: "🕒 Time",   value: getThaiTime(), inline: true },
      { name: "⏱️ Uptime", value: uptime(),      inline: true },

      { name: "☁️ R2 Uploads",   value: String(stats.r2_uploads   || 0), inline: true },
      { name: "⬇️ R2 Downloads", value: String(stats.r2_downloads || 0), inline: true },
      { name: "🗑️ R2 Deletes",   value: String(stats.r2_deletes   || 0), inline: true },

      ...(domain ? [{ name: "🔗 Domain", value: domain, inline: false }] : []),
    ],
    footer: { text: "Auto-updating every 5 seconds" },
    timestamp: new Date(),
  };
}

// ───────────────
// 🚀 INIT DASHBOARD
// ───────────────
async function startDashboard(channel) {
  startTime = Date.now();

  message = await channel.send({
    embeds: [buildEmbed()],
  });

  // Save message ID to disk — survives crashes
  saveMessageId(channel.id, message.id);
  console.log("✅ Dashboard created:", message.id);

  interval = setInterval(async () => {
    try {
      await message.edit({
        embeds: [buildEmbed()],
      });
    } catch (e) {
      console.log("❌ Update error:", e.message);
      // message may have been deleted externally — clear saved ID
      clearMessageId();
      message = null;
      clearInterval(interval);
    }
  }, 5000);
}

// ───────────────
// 🧹 CLEAN STOP
// ───────────────
async function stop() {
  if (interval) { clearInterval(interval); interval = null; }
  if (message) {
    await message.delete().catch(() => {});
    message = null;
  }
  clearMessageId();
  console.log("🛑 Dashboard stopped");
}

// ───────────────
// 🗑 DELETE OLD STATUS ON STARTUP
// ───────────────
async function deleteOldDashboard() {
  const saved = loadMessageId();
  if (!saved) return;
  try {
    const ch = await client.channels.fetch(saved.channelId).catch(() => null);
    if (!ch) { clearMessageId(); return; }
    const oldMsg = await ch.messages.fetch(saved.messageId).catch(() => null);
    if (oldMsg) {
      await oldMsg.delete().catch(() => {});
      console.log("🗑 Deleted old dashboard message:", saved.messageId);
    }
  } catch (e) {
    console.log("⚠ Could not delete old dashboard:", e.message);
  }
  clearMessageId();
}

// ───────────────
// 🧹 SCAN & CLEANUP — ลบ dashboard เก่าถ้าเกิน 2 อัน
// ───────────────
async function cleanupExtraDashboards(channel) {
  try {
    // ดึง 100 ข้อความล่าสุด
    const fetched = await channel.messages.fetch({ limit: 100 });

    // กรองเฉพาะ embed ที่เป็น DASHBOARD ของ bot เรา
    const dashboards = fetched
      .filter(m =>
        m.author.id === client.user.id &&
        m.embeds?.length > 0 &&
        m.embeds[0]?.title?.includes('REALTIME SERVER DASHBOARD')
      )
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp); // เก่าสุดก่อน

    // ถ้ามีเกิน 2 อัน → ลบอันที่เก่าที่สุดออกจนเหลือ 1 (เพราะจะสร้างใหม่อีกอัน)
    const toDelete = dashboards.size > 1 ? [...dashboards.values()].slice(0, dashboards.size - 1) : [];
    for (const m of toDelete) {
      await m.delete().catch(() => {});
      console.log("🗑 Cleaned up extra dashboard:", m.id);
    }
  } catch (e) {
    console.log("⚠ cleanupExtraDashboards:", e.message);
  }
}

// ───────────────
// 🤖 BOT READY
// ───────────────
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return console.log("❌ Channel not found");

  // ลบ dashboard เก่าจาก file + scan หาอันที่ค้างอยู่
  await deleteOldDashboard();
  await cleanupExtraDashboards(channel);

  await startDashboard(channel);
});

// ───────────────
// 🧯 SAFE EXIT
// ───────────────
process.on("SIGINT", async () => {
  await stop();
  process.exit();
});

process.on("SIGTERM", async () => {
  await stop();
  process.exit();
});

// ───────────────
// 💬 COMMAND HANDLER (!shutdown, !status)
// ───────────────
const ADMIN_IDS = (process.env.DISCORD_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

function isAdmin(userId) {
  // ถ้าไม่ได้ตั้ง DISCORD_ADMIN_IDS → ทุกคนใน channel สั่งได้
  if (!ADMIN_IDS.length) return true;
  return ADMIN_IDS.includes(userId);
}

let shutdownCallback = null; // server.js จะ inject callback นี้

// helper: ลบ message หลังหน่วงเวลา (ms)
function deleteAfter(m, ms) {
  setTimeout(() => m.delete().catch(() => {}), ms);
}

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  if (msg.channelId !== channelId) return;
  if (!msg.content.startsWith('!')) return;

  const cmd = msg.content.trim().toLowerCase();

  // ── !shutdown ──
  if (cmd === '!shutdown') {
    if (!isAdmin(msg.author.id)) {
      const reply = await msg.reply('❌ คุณไม่มีสิทธิ์สั่งปิด server').catch(() => null);
      deleteAfter(msg, 5_000);
      if (reply) deleteAfter(reply, 5_000);
      return;
    }
    const reply = await msg.reply('🛑 กำลังปิด FileVault Server...').catch(() => null);
    deleteAfter(msg, 3_000);
    if (reply) deleteAfter(reply, 3_000);
    console.log(`🛑 Shutdown triggered by Discord: ${msg.author.tag}`);
    setTimeout(() => {
      if (shutdownCallback) shutdownCallback();
      else process.kill(process.pid, 'SIGTERM');
    }, 3_500);
    return;
  }

  // ── !status ──
  if (cmd === '!status') {
    const reply = await msg.reply({ embeds: [buildEmbed()] }).catch(() => null);
    deleteAfter(msg, 10_000);
    if (reply) deleteAfter(reply, 10_000);
    return;
  }

  // ── !locks ──
  if (cmd === '!locks') {
    if (!isAdmin(msg.author.id)) {
      const reply = await msg.reply('❌ คุณไม่มีสิทธิ์').catch(() => null);
      deleteAfter(msg, 5_000);
      if (reply) deleteAfter(reply, 5_000);
      return;
    }
    try {
      const fp = nodePath.join(__dirname, 'data', 'folder-locks.json');
      if (!nodeFs.existsSync(fp)) {
        const reply = await msg.reply('📂 ยังไม่มี folder lock').catch(() => null);
        deleteAfter(msg, 10_000);
        if (reply) deleteAfter(reply, 10_000);
        return;
      }
      const reply = await msg.reply({
        content: '🔒 **folder-locks.json** (ลบข้อความนี้หลังบันทึกแล้วนะ)',
        files: [{ attachment: fp, name: 'folder-locks.json' }],
      }).catch(() => null);
      deleteAfter(msg, 20_000);
      if (reply) deleteAfter(reply, 20_000);
    } catch (e) {
      const reply = await msg.reply('❌ Error: ' + e.message).catch(() => null);
      deleteAfter(msg, 10_000);
      if (reply) deleteAfter(reply, 10_000);
    }
    return;
  }

  // ── !help ──
  if (cmd === '!help') {
    const reply = await msg.reply([
      '**📋 FileVault Bot Commands**',
      '`!shutdown` — ปิด server',
      '`!status`   — ดูสถานะ server',
      '`!locks`    — ดาวน์โหลด folder-locks.json',
      '`!help`     — แสดง commands',
    ].join('\n')).catch(() => null);
    deleteAfter(msg, 15_000);        // ลบคำสั่งหลัง 1 นาที
    if (reply) deleteAfter(reply, 15_000); // ลบ reply หลัง 1 นาที
    return;
  }
});

// ───────────────
// 🖼️ AUTO-UPLOAD DISCORD IMAGES TO R2
// ───────────────
const IMAGE_MIME = ["image/png","image/jpeg","image/gif","image/webp","image/bmp","image/tiff","image/avif","image/heic","image/svg+xml"];

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  if (!msg.attachments.size) return;

  const images = [...msg.attachments.values()].filter(a => {
    const ct = a.contentType || "";
    const ext = a.name?.split(".").pop()?.toLowerCase() || "";
    return IMAGE_MIME.some(m => ct.startsWith(m.split("/")[0]+"/"+m.split("/")[1])) ||
           ["png","jpg","jpeg","gif","webp","bmp","avif","heic","svg"].includes(ext);
  });

  if (!images.length) return;

  let uploaded = 0;
  for (const att of images) {
    try {
      // ใช้ URL เต็มรวม query string (Discord CDN ต้องการ signature)
      const { buffer, contentType: rawCt } = await downloadToBuffer(att.url);
      const timestamp = Date.now();
      const safeName = att.name.replace(/[^a-zA-Z0-9._\-ก-๙]/g, "_");
      const key = `${imageFolder}/${timestamp}_${safeName}`;
      // force MIME จาก extension เพื่อให้ browser แสดง thumbnail ได้เสมอ
      const ext = safeName.split('.').pop().toLowerCase();
      const mimeMap = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', avif:'image/avif', heic:'image/heic', svg:'image/svg+xml' };
      const contentType = mimeMap[ext] || rawCt || 'application/octet-stream';
      await r2.uploadObject(key, buffer, contentType);
      uploaded++;
      console.log(`☁ Discord image uploaded → R2: ${key} [${contentType}]`);
    } catch (e) {
      console.error(`❌ Failed to upload Discord image: ${att.name}`, e.message);
    }
  }

  if (uploaded > 0) {
    try {
      await msg.react("☁");
    } catch {}

    // 🗑 ลบรูปใน Discord หลัง upload R2 เสร็จ ภายใน 10 วินาที
    setTimeout(async () => {
      try {
        await msg.delete();
        console.log(`🗑 ลบรูปใน Discord แล้ว (message: ${msg.id})`);
      } catch (e) {
        console.error(`❌ ลบ message ไม่ได้: ${e.message}`);
      }
    }, 10_000);
  }
});

// ───────────────
// 📤 EXPORTS
// ───────────────
async function sendOnline() { /* dashboard created on ready */ }
async function sendOffline() { await stop(); }
function setShutdownCallback(cb) { shutdownCallback = cb; }
function setStats(s) { stats = s; } // server.js ส่ง stats object มาให้ (same reference)
module.exports = { sendOnline, sendOffline, setShutdownCallback, setStats };

client.login(token);