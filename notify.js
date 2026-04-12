require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");
const os = require("os");
const axios = require("axios");
const https = require("https");
const http = require("http");
const r2 = require("./r2");

// ───────────────
// 🔧 CONFIG — FileVault bot
// ───────────────
const token       = process.env.DISCORD_TOKEN;
const channelId   = process.env.CHANNEL_ID;
const domain      = process.env.DOMAIN;
const imageFolder = process.env.DISCORD_IMAGE_FOLDER || "discord-images";
const fileFolder  = process.env.DISCORD_FILE_FOLDER  || "discord-files";

// ───────────────
// 🔧 CONFIG — Monitor bot (จาก bot.js)
// ───────────────
const MONITOR_TOKEN     = process.env.MTDISCORD_TOKEN;
const MONITOR_CLIENT_ID = process.env.DISCORD_CLIENT_ID2;
const MONITOR_CHANNEL   = process.env.MTDISCORD_CHANNEL_ID;
const MONITOR_URLS      = (process.env.MONITOR_URLS || "").split(",").filter(Boolean);

// ───────────────
// 🤖 CLIENTS
// ───────────────
// Client หลัก — FileVault dashboard + image upload (client เดียว = ไม่ duplicate)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Client monitor — /start /stop site checker (token แยก)
const monitorClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

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

// ───────────────
// 📊 DASHBOARD STATE
// ───────────────
let message   = null;
let startTime = Date.now();
let interval  = null;
let stats     = { r2_uploads: 0, r2_downloads: 0, r2_deletes: 0 };

const nodePath    = require("path");
const nodeFs      = require("fs");
const MSG_ID_FILE = nodePath.join(__dirname, "data", ".discord-msg-id.json");

function saveMessageId(chId, msgId) {
  try { nodeFs.mkdirSync(nodePath.dirname(MSG_ID_FILE), { recursive: true }); nodeFs.writeFileSync(MSG_ID_FILE, JSON.stringify({ channelId: chId, messageId: msgId })); } catch {}
}
function clearMessageId() { try { nodeFs.unlinkSync(MSG_ID_FILE); } catch {} }
function loadMessageId()  { try { return JSON.parse(nodeFs.readFileSync(MSG_ID_FILE, "utf8")); } catch { return null; } }

// ───────────────
// 🕒 HELPERS
// ───────────────
function getThaiTime() {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}
function uptime() {
  const sec = Math.floor((Date.now() - startTime) / 1000);
  const min = Math.floor(sec / 60);
  const hr  = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ${sec % 60}s`;
}

// ───────────────
// 📊 FILEVAULT DASHBOARD EMBED
// ───────────────
function buildEmbed() {
  return {
    title: "📊 REALTIME SERVER DASHBOARD",
    color: 0x3498db,
    fields: [
      { name: "⚙️ Status", value: "🟢 Online",  inline: true },
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
// 🚀 FILEVAULT DASHBOARD LIFECYCLE
// ───────────────
async function startDashboard(channel) {
  startTime = Date.now();
  message = await channel.send({ embeds: [buildEmbed()] });
  saveMessageId(channel.id, message.id);
  console.log("✅ Dashboard created:", message.id);
  interval = setInterval(async () => {
    try { await message.edit({ embeds: [buildEmbed()] }); }
    catch (e) { console.log("❌ Update error:", e.message); clearMessageId(); message = null; clearInterval(interval); }
  }, 5000);
}

async function stop() {
  if (interval) { clearInterval(interval); interval = null; }
  if (message)  { await message.delete().catch(() => {}); message = null; }
  clearMessageId();
  console.log("🛑 Dashboard stopped");
}

async function deleteOldDashboard() {
  const saved = loadMessageId();
  if (!saved) return;
  try {
    const ch = await client.channels.fetch(saved.channelId).catch(() => null);
    if (!ch) { clearMessageId(); return; }
    const oldMsg = await ch.messages.fetch(saved.messageId).catch(() => null);
    if (oldMsg) { await oldMsg.delete().catch(() => {}); console.log("🗑 Deleted old dashboard:", saved.messageId); }
  } catch (e) { console.log("⚠ Could not delete old dashboard:", e.message); }
  clearMessageId();
}

async function cleanupExtraDashboards(channel) {
  try {
    const fetched = await channel.messages.fetch({ limit: 100 });
    const dashboards = fetched
      .filter(m => m.author.id === client.user.id && m.embeds?.length > 0 && m.embeds[0]?.title?.includes("REALTIME SERVER DASHBOARD"))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const toDelete = dashboards.size > 1 ? [...dashboards.values()].slice(0, dashboards.size - 1) : [];
    for (const m of toDelete) { await m.delete().catch(() => {}); console.log("🗑 Cleaned up extra dashboard:", m.id); }
  } catch (e) { console.log("⚠ cleanupExtraDashboards:", e.message); }
}

// ───────────────
// 🤖 FILEVAULT CLIENT — READY
// ───────────────
client.once("ready", async () => {
  console.log(`🤖 [FileVault] Logged in as ${client.user.tag}`);
  await registerFileVaultCommands();
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return console.log("❌ Channel not found");
  await deleteOldDashboard();
  await cleanupExtraDashboards(channel);
  await startDashboard(channel);
});

// ───────────────
// 📋 REGISTER FILEVAULT COMMANDS
// ───────────────
async function registerFileVaultCommands() {
  const commands = [
    new SlashCommandBuilder().setName("shutdown").setDescription("ปิด FileVault Server"),
    new SlashCommandBuilder().setName("status").setDescription("ดูสถานะ server แบบ realtime"),
    new SlashCommandBuilder().setName("locks").setDescription("ดาวน์โหลดไฟล์ folder-locks.json"),
    new SlashCommandBuilder().setName("r2stats").setDescription("ดูจำนวนไฟล์และขนาดรวมใน R2"),
    new SlashCommandBuilder().setName("r2list")
      .setDescription("แสดง list ไฟล์ล่าสุดใน R2")
      .addStringOption((o) => o.setName("folder").setDescription("folder prefix (เว้นว่าง = ทั้งหมด)").setRequired(false))
      .addIntegerOption((o) => o.setName("limit").setDescription("จำนวนสูงสุด (default 10)").setRequired(false)),
    new SlashCommandBuilder().setName("r2delete")
      .setDescription("ลบไฟล์ใน R2 ด้วย key")
      .addStringOption((o) => o.setName("key").setDescription("R2 key ของไฟล์").setRequired(true)),
    new SlashCommandBuilder().setName("purge")
      .setDescription("ลบไฟล์ใน R2 ที่เก่าเกิน N วัน")
      .addIntegerOption((o) => o.setName("days").setDescription("จำนวนวัน (เช่น 30)").setRequired(true))
      .addStringOption((o) => o.setName("folder").setDescription("folder prefix (เว้นว่าง = ทั้งหมด)").setRequired(false)),
    new SlashCommandBuilder().setName("help").setDescription("แสดง commands ทั้งหมด"),
  ];
  const rest = new REST({ version: "10" }).setToken(token);
  const clientId = process.env.DISCORD_CLIENT_ID;
  await rest.put(Routes.applicationCommands(clientId), { body: commands.map((c) => c.toJSON()) });
  console.log("✅ [FileVault] Registered Slash Commands (/shutdown /status /locks /r2stats /r2list /r2delete /purge /help)");
}

// ───────────────
// 💬 FILEVAULT SLASH COMMANDS
// ───────────────
const ADMIN_IDS = (process.env.DISCORD_ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
function isAdmin(userId) { return !ADMIN_IDS.length || ADMIN_IDS.includes(userId); }

let shutdownCallback = null;

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user } = interaction;

  if (commandName === "shutdown") {
    if (!isAdmin(user.id)) { await interaction.reply({ content: "❌ คุณไม่มีสิทธิ์สั่งปิด server", flags: 64 }); return; }
    await interaction.reply({ content: "🛑 กำลังปิด FileVault Server...", flags: 64 });
    console.log(`🛑 Shutdown triggered by Discord: ${user.tag}`);
    setTimeout(() => { if (shutdownCallback) shutdownCallback(); else process.kill(process.pid, "SIGTERM"); }, 3_500);
    return;
  }
  if (commandName === "status") { await interaction.reply({ embeds: [buildEmbed()], flags: 64 }); return; }
  if (commandName === "locks") {
    if (!isAdmin(user.id)) { await interaction.reply({ content: "❌ คุณไม่มีสิทธิ์", flags: 64 }); return; }
    try {
      const fp = nodePath.join(__dirname, "data", "folder-locks.json");
      if (!nodeFs.existsSync(fp)) { await interaction.reply({ content: "📂 ยังไม่มี folder lock", flags: 64 }); return; }
      await interaction.reply({ content: "🔒 **folder-locks.json** (ลบข้อความนี้หลังบันทึกแล้วนะ)", files: [{ attachment: fp, name: "folder-locks.json" }], flags: 64 });
    } catch (e) { await interaction.reply({ content: "❌ Error: " + e.message, flags: 64 }); }
    return;
  }
  // ─── /r2stats ───
  if (commandName === "r2stats") {
    await interaction.deferReply({ flags: 64 });
    try {
      const files = await r2.listObjects("");
      const count = files.length;
      const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0);
      const fmt = (b) => b >= 1_073_741_824 ? (b/1_073_741_824).toFixed(2)+" GB"
                       : b >= 1_048_576      ? (b/1_048_576).toFixed(2)+" MB"
                       : b >= 1024           ? (b/1024).toFixed(1)+" KB"
                       : b+" B";
      await interaction.editReply({ content: `**☁️ R2 Stats**\n📦 ไฟล์ทั้งหมด: **${count}** ไฟล์\n💾 ขนาดรวม: **${fmt(totalBytes)}**` });
    } catch (e) { await interaction.editReply({ content: "❌ Error: " + e.message }); }
    return;
  }

  // ─── /r2list ───
  if (commandName === "r2list") {
    await interaction.deferReply({ flags: 64 });
    try {
      const folder = interaction.options.getString("folder") || "";
      const limit  = interaction.options.getInteger("limit") || 10;
      const files  = await r2.listObjects(folder);
      if (!files.length) { await interaction.editReply({ content: "📂 ไม่พบไฟล์" }); return; }
      const recent = files.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified)).slice(0, limit);
      const fmt = (b) => b >= 1_048_576 ? (b/1_048_576).toFixed(1)+"MB" : b >= 1024 ? (b/1024).toFixed(0)+"KB" : b+"B";
      const lines = recent.map((f, i) => `\`${i+1}.\` \`${f.key}\` — ${fmt(f.size||0)}`);
      await interaction.editReply({ content: `**📋 R2 Files** (${recent.length}/${files.length})\n${lines.join("\n")}` });
    } catch (e) { await interaction.editReply({ content: "❌ Error: " + e.message }); }
    return;
  }

  // ─── /r2delete ───
  if (commandName === "r2delete") {
    if (!isAdmin(user.id)) { await interaction.reply({ content: "❌ คุณไม่มีสิทธิ์", flags: 64 }); return; }
    await interaction.deferReply({ flags: 64 });
    try {
      const key = interaction.options.getString("key");
      await r2.deleteObject(key);
      await interaction.editReply({ content: `🗑️ ลบแล้ว: \`${key}\`` });
    } catch (e) { await interaction.editReply({ content: "❌ Error: " + e.message }); }
    return;
  }

  // ─── /purge ───
  if (commandName === "purge") {
    if (!isAdmin(user.id)) { await interaction.reply({ content: "❌ คุณไม่มีสิทธิ์", flags: 64 }); return; }
    await interaction.deferReply({ flags: 64 });
    try {
      const days   = interaction.options.getInteger("days");
      const folder = interaction.options.getString("folder") || "";
      const cutoff = Date.now() - days * 86_400_000;
      const files  = await r2.listObjects(folder);
      const old    = files.filter((f) => new Date(f.lastModified).getTime() < cutoff);
      if (!old.length) { await interaction.editReply({ content: `✅ ไม่มีไฟล์เก่ากว่า ${days} วัน` }); return; }
      for (const f of old) await r2.deleteObject(f.key);
      await interaction.editReply({ content: `🗑️ ลบ **${old.length}** ไฟล์ที่เก่ากว่า ${days} วันแล้ว` });
    } catch (e) { await interaction.editReply({ content: "❌ Error: " + e.message }); }
    return;
  }

  if (commandName === "help") {
    await interaction.reply({
      content: [
        "**📋 FileVault Bot Commands**",
        "`/shutdown`        — ปิด server",
        "`/status`          — ดูสถานะ server",
        "`/locks`           — ดาวน์โหลด folder-locks.json",
        "`/r2stats`         — ดูจำนวนไฟล์และขนาดรวมใน R2",
        "`/r2list [folder] [limit]` — list ไฟล์ล่าสุดใน R2",
        "`/r2delete <key>`  — ลบไฟล์ใน R2",
        "`/purge <days> [folder]`   — ลบไฟล์เก่าเกิน N วัน",
        "`/help`            — แสดง commands",
      ].join("\n"),
      flags: 64,
    });
    return;
  }
});

// ───────────────
// 🖼️ AUTO-UPLOAD DISCORD ATTACHMENTS TO R2  (รูป → imageFolder, ไฟล์อื่น → fileFolder)
// ───────────────
const IMAGE_MIME     = ["image/png","image/jpeg","image/gif","image/webp","image/bmp","image/tiff","image/avif","image/heic","image/svg+xml"];
const IMAGE_EXT      = ["png","jpg","jpeg","gif","webp","bmp","avif","heic","svg"];

// MIME map ครอบคลุมไฟล์ทั่วไป (fallback ถ้า Discord ไม่ส่ง contentType)
const MIME_MAP = {
  // images
  jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", gif:"image/gif",
  webp:"image/webp", bmp:"image/bmp", avif:"image/avif", heic:"image/heic", svg:"image/svg+xml",
  // documents
  pdf:"application/pdf",
  doc:"application/msword", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:"application/vnd.ms-excel", xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt:"application/vnd.ms-powerpoint", pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // text / code
  txt:"text/plain", md:"text/markdown", csv:"text/csv", json:"application/json",
  html:"text/html", htm:"text/html", xml:"application/xml", yaml:"text/yaml", yml:"text/yaml",
  js:"text/javascript", ts:"text/typescript", py:"text/x-python",
  // archives
  zip:"application/zip", rar:"application/vnd.rar", "7z":"application/x-7z-compressed",
  gz:"application/gzip", tar:"application/x-tar",
  // media
  mp4:"video/mp4", mov:"video/quicktime", avi:"video/x-msvideo", mkv:"video/x-matroska",
  mp3:"audio/mpeg", wav:"audio/wav", ogg:"audio/ogg", flac:"audio/flac",
};

function isImage(att) {
  const ct  = att.contentType || "";
  const ext = att.name?.split(".").pop()?.toLowerCase() || "";
  return IMAGE_MIME.some((m) => ct.startsWith(m)) || IMAGE_EXT.includes(ext);
}

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== channelId) return;
  if (!msg.attachments.size) return;

  const attachments = [...msg.attachments.values()];
  let uploaded = 0;

  for (const att of attachments) {
    try {
      const { buffer, contentType: rawCt } = await downloadToBuffer(att.url);
      const timestamp   = Date.now();
      const safeName    = att.name.replace(/[^a-zA-Z0-9._\-ก-๙]/g, "_");
      const ext         = safeName.split(".").pop().toLowerCase();
      const contentType = MIME_MAP[ext] || rawCt || att.contentType || "application/octet-stream";

      // แยก folder: รูป → imageFolder, ไฟล์อื่น → fileFolder
      const folder = isImage(att) ? imageFolder : fileFolder;
      const key    = `${folder}/${timestamp}_${safeName}`;

      await r2.uploadObject(key, buffer, contentType);
      uploaded++;
      console.log(`☁ Discord upload → R2: ${key} [${contentType}]`);
    } catch (e) { console.error(`❌ Failed to upload Discord file: ${att.name}`, e.message); }
  }

  if (uploaded > 0) {
    try { await msg.react("☁"); } catch {}
    setTimeout(async () => {
      try { await msg.delete(); console.log(`🗑 ลบ message ใน Discord แล้ว (${msg.id})`); }
      catch (e) { console.error(`❌ ลบ message ไม่ได้: ${e.message}`); }
    }, 10_000);
  }
});

// ───────────────
// 🔁 SAFE EXIT
// ───────────────
process.on("SIGINT",  async () => { await stop(); process.exit(); });
process.on("SIGTERM", async () => { await stop(); process.exit(); });

// ═══════════════════════════════════════════════════════
// 📡 MONITOR CLIENT (/start /stop) — จาก bot.js
// ═══════════════════════════════════════════════════════
let monitorDashboard = null;
let monitorInterval  = null;

async function registerMonitorCommands() {
  const commands = [
    new SlashCommandBuilder().setName("start").setDescription("เริ่ม monitor"),
    new SlashCommandBuilder().setName("stop").setDescription("หยุด monitor"),
  ];
  const rest = new REST({ version: "10" }).setToken(MONITOR_TOKEN);
  await rest.put(Routes.applicationCommands(MONITOR_CLIENT_ID), { body: commands });
  console.log("✅ [Monitor] Registered Slash Commands (/start /stop)");
}

async function checkSite(url) {
  try { const res = await axios.get(url); return { url, up: true,  code: res.status }; }
  catch { return { url, up: false, code: "DOWN" }; }
}

function makeMonitorEmbed(results) {
  return new EmbedBuilder()
    .setTitle("📡 SERVER DASHBOARD")
    .setColor(0x3498db)
    .setDescription(results.map((r) => `${r.up ? "🟢" : "🔴"} ${r.url} | ${r.code}`).join("\n"))
    .setTimestamp();
}

async function startMonitor() {
  const channel = await monitorClient.channels.fetch(MONITOR_CHANNEL);
  const results = [];
  for (const url of MONITOR_URLS) results.push(await checkSite(url));
  monitorDashboard = await channel.send({ embeds: [makeMonitorEmbed(results)] });
  monitorInterval = setInterval(async () => {
    const updated = [];
    for (const url of MONITOR_URLS) updated.push(await checkSite(url));
    await monitorDashboard.edit({ embeds: [makeMonitorEmbed(updated)] });
  }, 10_000);
}

async function stopMonitor() {
  clearInterval(monitorInterval);
  if (monitorDashboard) { await monitorDashboard.delete().catch(() => {}); monitorDashboard = null; }
}

monitorClient.once("clientReady", async () => {
  console.log(`✅ [Monitor] Logged in as ${monitorClient.user.tag}`);
  await registerMonitorCommands();
});

monitorClient.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "start") {
    console.log(`[COMMAND] /start by ${interaction.user.tag}`);
    await interaction.deferReply({ flags: 64 });
    await startMonitor();
    await interaction.editReply("✅ Monitor Started");
    setTimeout(async () => { await interaction.deleteReply().catch(() => {}); }, 3000);
  }
  if (interaction.commandName === "stop") {
    console.log(`[COMMAND] /stop by ${interaction.user.tag}`);
    await interaction.deferReply({ flags: 64 });
    await stopMonitor();
    await interaction.editReply("🛑 Monitor Stopped");
    setTimeout(async () => { await interaction.deleteReply().catch(() => {}); }, 3000);
  }
});

// ───────────────
// 📤 EXPORTS
// ───────────────
async function sendOnline()  { /* dashboard created on ready */ }
async function sendOffline() { await stop(); }
function setShutdownCallback(cb) { shutdownCallback = cb; }
function setStats(s) { stats = s; }
module.exports = { sendOnline, sendOffline, setShutdownCallback, setStats };

// ───────────────
// 🔑 LOGIN BOTH CLIENTS
// ───────────────
client.login(token);
if (MONITOR_TOKEN) {
  monitorClient.login(MONITOR_TOKEN);
} else {
  console.warn("⚠ MTDISCORD_TOKEN ไม่ได้ตั้งค่า — Monitor bot จะไม่ทำงาน");
}
