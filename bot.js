/**
 * bot.js — FileVault Discord Bot (standalone process)
 *
 * รันแยกจาก server.js:  node bot.js
 *
 * env ที่ต้องการ:
 *   DISCORD_TOKEN, DISCORD_CLIENT_ID, CHANNEL_ID
 *   DISCORD_ADMIN_IDS      — comma-separated user IDs (optional)
 *   DISCORD_IMAGE_FOLDER   — R2 folder สำหรับรูป  (default: discord-images)
 *   DISCORD_FILE_FOLDER    — R2 folder สำหรับไฟล์ (default: discord-files)
 *   DOMAIN                 — URL ของ server (optional)
 *   MTDISCORD_TOKEN, DISCORD_CLIENT_ID2, MTDISCORD_CHANNEL_ID
 *   MONITOR_URLS           — comma-separated URLs
 *   FV_SERVER_URL          — default: http://localhost:3000
 */

require('dotenv').config();
const {
  Client, GatewayIntentBits, EmbedBuilder,
  Events, SlashCommandBuilder, REST, Routes,
} = require('discord.js');
const os   = require('os');
const axios = require('axios');
const https = require('https');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');
const r2    = require('./r2');

// ── Config ──
// บน Render: ใช้ FV_SERVER_URL ที่ตั้งค่าไว้ หรือ RENDER_EXTERNAL_URL ที่ Render inject อัตโนมัติ
const FV_SERVER_URL = process.env.FV_SERVER_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
const token         = process.env.DISCORD_TOKEN;
const channelId     = process.env.CHANNEL_ID;
const domain        = process.env.DOMAIN;
const imageFolder   = process.env.DISCORD_IMAGE_FOLDER || 'discord-images';
const fileFolder    = process.env.DISCORD_FILE_FOLDER  || 'discord-files';
const ADMIN_IDS     = (process.env.DISCORD_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

const MONITOR_TOKEN     = process.env.MTDISCORD_TOKEN;
const MONITOR_CLIENT_ID = process.env.DISCORD_CLIENT_ID2;
const MONITOR_CHANNEL   = process.env.MTDISCORD_CHANNEL_ID;
const MONITOR_URLS      = (process.env.MONITOR_URLS || '').split(',').filter(Boolean);

// ── ANSI ──
const R   = '\x1b[0m', B = '\x1b[1m';
const GRN = '\x1b[32m', RED = '\x1b[31m', CYN = '\x1b[36m', GRY = '\x1b[90m', YLW = '\x1b[33m';

// ── Clients ──
const INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent];
const client        = new Client({ intents: INTENTS });
const monitorClient = new Client({ intents: INTENTS });

// ── Helpers ──
function isAdmin(userId) { return !ADMIN_IDS.length || ADMIN_IDS.includes(userId); }

function getThaiTime() {
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}

// ใช้ axios แทน manual http.get เพื่อความสอดคล้องกับส่วนอื่น
function downloadToBuffer(url) {
  return axios.get(url, { responseType: 'arraybuffer', timeout: 30_000 })
    .then(res => ({ buffer: Buffer.from(res.data), contentType: res.headers['content-type'] || 'application/octet-stream' }));
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(i >= 2 ? 2 : 1)) + ' ' + units[i];
}

// ── Stats polling ──
let cachedStats = { requests:0, uploads:0, downloads:0, deletes:0, errors:0, moves:0, r2_uploads:0, r2_downloads:0, r2_deletes:0 };
let serverOnline = false;

async function fetchStats() {
  try {
    const res = await axios.get(`${FV_SERVER_URL}/api/stats`, { timeout: 3000 });
    if (res.data?.ok) { cachedStats = res.data.stats; serverOnline = true; }
  } catch { serverOnline = false; }
}
setInterval(fetchStats, 5000);
fetchStats();

// ── Dashboard ──
let dashMessage  = null;
let dashInterval = null;
let botStartTime = Date.now();

const DATA_DIR    = path.join(__dirname, 'data');
const MSG_ID_FILE = path.join(DATA_DIR, '.discord-msg-id.json');

function saveMessageId(chId, msgId) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(MSG_ID_FILE, JSON.stringify({ channelId: chId, messageId: msgId })); } catch {} }
function clearMessageId()           { try { fs.unlinkSync(MSG_ID_FILE); } catch {} }
function loadMessageId()            { try { return JSON.parse(fs.readFileSync(MSG_ID_FILE, 'utf8')); } catch { return null; } }

function uptime() {
  const sec = Math.floor((Date.now() - botStartTime) / 1000);
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;
}

function buildEmbed() {
  const s = cachedStats;
  const embed = {
    title: '📊 REALTIME SERVER DASHBOARD',
    color: serverOnline ? 0x3498db : 0xe74c3c,
    fields: [
      { name: '⚙️ Status',       value: serverOnline ? '🟢 Online' : '🔴 Offline', inline: true },
      { name: '🕒 Time',         value: getThaiTime(),                              inline: true },
      { name: '⏱️ Uptime',       value: uptime(),                                  inline: true },
      { name: '📨 Requests',     value: String(s.requests    || 0),                inline: true },
      { name: '📤 Uploads',      value: String(s.uploads     || 0),                inline: true },
      { name: '↔️ Moves',        value: String(s.moves       || 0),                inline: true },
      { name: '☁️ R2 Uploads',   value: String(s.r2_uploads  || 0),                inline: true },
      { name: '⬇️ R2 Downloads', value: String(s.r2_downloads|| 0),                inline: true },
      { name: '🗑️ R2 Deletes',   value: String(s.r2_deletes  || 0),                inline: true },
      ...(domain ? [{ name: '🔗 Domain', value: domain, inline: false }] : []),
    ],
    footer: { text: `Auto-updating every 5s • Bot: ${client.user?.tag || '...'} • Server: ${FV_SERVER_URL}` },
    timestamp: new Date(),
  };
  return embed;
}

async function startDashboard(channel) {
  botStartTime = Date.now();
  dashMessage  = await channel.send({ embeds: [buildEmbed()] });
  saveMessageId(channel.id, dashMessage.id);
  console.log(`${GRN}✅ [FileVault] Dashboard created:${R}`, dashMessage.id);
  dashInterval = setInterval(async () => {
    try { await dashMessage.edit({ embeds: [buildEmbed()] }); }
    catch (e) { console.log(`${RED}❌ Dashboard update error:${R}`, e.message); clearMessageId(); dashMessage = null; clearInterval(dashInterval); }
  }, 5000);
}

async function stopDashboard() {
  if (dashInterval) { clearInterval(dashInterval); dashInterval = null; }
  if (dashMessage)  { await dashMessage.delete().catch(() => {}); dashMessage = null; }
  clearMessageId();
  console.log(`${YLW}🛑 [FileVault] Dashboard stopped${R}`);
}

async function deleteOldDashboard() {
  const saved = loadMessageId();
  if (!saved) return;
  try {
    const ch = await client.channels.fetch(saved.channelId).catch(() => null);
    if (!ch) { clearMessageId(); return; }
    const oldMsg = await ch.messages.fetch(saved.messageId).catch(() => null);
    if (oldMsg) { await oldMsg.delete().catch(() => {}); console.log(`${GRY}🗑 Deleted old dashboard: ${saved.messageId}${R}`); }
  } catch (e) { console.log(`⚠ Could not delete old dashboard: ${e.message}`); }
  clearMessageId();
}

async function cleanupExtraDashboards(channel) {
  try {
    const fetched = await channel.messages.fetch({ limit: 100 });
    const dbs = fetched
      .filter(m => m.author.id === client.user.id && m.embeds?.length > 0 && m.embeds[0]?.title?.includes('REALTIME SERVER DASHBOARD'))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const toDelete = dbs.size > 1 ? [...dbs.values()].slice(0, dbs.size - 1) : [];
    for (const m of toDelete) { await m.delete().catch(() => {}); console.log(`${GRY}🗑 Cleaned extra dashboard: ${m.id}${R}`); }
  } catch (e) { console.log(`⚠ cleanupExtraDashboards: ${e.message}`); }
}

// ── FileVault Bot: Ready ──
client.once('ready', async () => {
  console.log(`\n${B}${CYN}🤖 [FileVault Bot] Logged in as ${client.user.tag}${R}`);
  await registerFileVaultCommands();
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return console.log(`${RED}❌ Channel not found: ${channelId}${R}`);
  await deleteOldDashboard();
  await cleanupExtraDashboards(channel);
  await startDashboard(channel);
});

// ── Slash Commands ──
async function registerFileVaultCommands() {
  const commands = [
    new SlashCommandBuilder().setName('shutdown').setDescription('ปิด FileVault Server'),
    new SlashCommandBuilder().setName('status').setDescription('ดูสถานะ server แบบ realtime'),
    new SlashCommandBuilder().setName('locks').setDescription('ดาวน์โหลดไฟล์ folder-locks.json'),
    new SlashCommandBuilder().setName('r2stats').setDescription('ดูจำนวนไฟล์และขนาดรวมใน R2'),
    new SlashCommandBuilder().setName('r2list')
      .setDescription('แสดง list ไฟล์ล่าสุดใน R2')
      .addStringOption(o => o.setName('folder').setDescription('folder prefix (เว้นว่าง = ทั้งหมด)').setRequired(false))
      .addIntegerOption(o => o.setName('limit').setDescription('จำนวนสูงสุด (default 10)').setRequired(false)),
    new SlashCommandBuilder().setName('r2delete')
      .setDescription('ลบไฟล์ใน R2 ด้วย key')
      .addStringOption(o => o.setName('key').setDescription('R2 key ของไฟล์').setRequired(true)),
    new SlashCommandBuilder().setName('purge')
      .setDescription('ลบไฟล์ใน R2 ที่เก่าเกิน N วัน')
      .addIntegerOption(o => o.setName('days').setDescription('จำนวนวัน (เช่น 30)').setRequired(true))
      .addStringOption(o => o.setName('folder').setDescription('folder prefix (เว้นว่าง = ทั้งหมด)').setRequired(false)),
    new SlashCommandBuilder().setName('serverstats').setDescription('ดู stats รายละเอียดจาก server'),
    new SlashCommandBuilder().setName('help').setDescription('แสดง commands ทั้งหมด'),
  ];
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands.map(c => c.toJSON()) });
  console.log(`${GRN}✅ [FileVault] Registered slash commands${R}`);
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user } = interaction;

  if (commandName === 'shutdown') {
    if (!isAdmin(user.id)) { await interaction.reply({ content: '❌ คุณไม่มีสิทธิ์สั่งปิด server', flags: 64 }); return; }
    await interaction.reply({ content: '🛑 กำลังส่งคำสั่งปิด FileVault Server...', flags: 64 });
    try {
      const tk = process.env.FV_SHUTDOWN_TOKEN || '';
      await axios.post(`${FV_SERVER_URL}/api/shutdown`, { token: tk }, {
        headers: tk ? { 'x-shutdown-token': tk } : {},
        timeout: 5000,
      });
    } catch { console.log(`${YLW}🛑 Shutdown sent by ${user.tag}${R}`); }
    return;
  }

  if (commandName === 'status') {
    await interaction.reply({ embeds: [buildEmbed()], flags: 64 });
    return;
  }

  if (commandName === 'serverstats') {
    await interaction.deferReply({ flags: 64 });
    try {
      const res = await axios.get(`${FV_SERVER_URL}/api/stats`, { timeout: 5000 });
      const { stats: s, storage } = res.data;
      const pct = storage.unlimited ? 'ไม่จำกัด' : `${storage.pct?.toFixed(1)}%`;
      await interaction.editReply({
        content: [
          `**📊 FileVault Server Stats**`,
          `🖥️ Server: \`${FV_SERVER_URL}\` 🟢 Online`,
          ``,
          `💾 Storage: \`${formatSize(storage.used)}\` / \`${storage.unlimited ? 'ไม่จำกัด' : formatSize(storage.limit)}\` (${pct})`,
          ``,
          `📨 Requests: **${s.requests}**  📤 Uploads: **${s.uploads}**  ⬇️ Downloads: **${s.downloads}**`,
          `🗑️ Deletes: **${s.deletes}**  ↔️ Moves: **${s.moves || 0}**  ❌ Errors: **${s.errors || 0}**`,
          ``,
          `☁️ R2 ↑${s.r2_uploads || 0}  ↓${s.r2_downloads || 0}  🗑${s.r2_deletes || 0}`,
        ].join('\n'),
      });
    } catch (e) { await interaction.editReply({ content: `❌ ไม่สามารถเชื่อมต่อ server: ${e.message}` }); }
    return;
  }

  if (commandName === 'locks') {
    if (!isAdmin(user.id)) { await interaction.reply({ content: '❌ คุณไม่มีสิทธิ์', flags: 64 }); return; }
    try {
      const fp = path.join(__dirname, 'data', 'folder-locks.json');
      if (!fs.existsSync(fp)) { await interaction.reply({ content: '📂 ยังไม่มี folder lock', flags: 64 }); return; }
      await interaction.reply({ content: '🔒 **folder-locks.json**', files: [{ attachment: fp, name: 'folder-locks.json' }], flags: 64 });
    } catch (e) { await interaction.reply({ content: '❌ Error: ' + e.message, flags: 64 }); }
    return;
  }

  if (commandName === 'r2stats') {
    await interaction.deferReply({ flags: 64 });
    try {
      const files = await r2.searchObjects('');
      const total = files.reduce((s, f) => s + (f.size || 0), 0);
      await interaction.editReply({ content: `**☁️ R2 Stats**\n📦 ไฟล์: **${files.length}** ไฟล์\n💾 รวม: **${formatSize(total)}**` });
    } catch (e) { await interaction.editReply({ content: '❌ Error: ' + e.message }); }
    return;
  }

  if (commandName === 'r2list') {
    await interaction.deferReply({ flags: 64 });
    try {
      const folder = interaction.options.getString('folder') || '';
      const limit  = interaction.options.getInteger('limit') || 10;
      const result = await r2.listObjects(folder);
      if (!result.files.length) { await interaction.editReply({ content: '📂 ไม่พบไฟล์' }); return; }
      const recent = result.files.sort((a, b) => new Date(b.modified) - new Date(a.modified)).slice(0, limit);
      const fmt    = b => b >= 1_048_576 ? (b / 1_048_576).toFixed(1) + 'MB' : b >= 1024 ? (b / 1024).toFixed(0) + 'KB' : b + 'B';
      const lines  = recent.map((f, i) => `\`${i + 1}.\` \`${f.key}\` — ${fmt(f.size || 0)}`);
      await interaction.editReply({ content: `**📋 R2 Files** (${recent.length}/${result.files.length})\n${lines.join('\n')}` });
    } catch (e) { await interaction.editReply({ content: '❌ Error: ' + e.message }); }
    return;
  }

  if (commandName === 'r2delete') {
    if (!isAdmin(user.id)) { await interaction.reply({ content: '❌ คุณไม่มีสิทธิ์', flags: 64 }); return; }
    await interaction.deferReply({ flags: 64 });
    try {
      const key = interaction.options.getString('key');
      await r2.deleteObject(key);
      await interaction.editReply({ content: `🗑️ ลบแล้ว: \`${key}\`` });
    } catch (e) { await interaction.editReply({ content: '❌ Error: ' + e.message }); }
    return;
  }

  if (commandName === 'purge') {
    if (!isAdmin(user.id)) { await interaction.reply({ content: '❌ คุณไม่มีสิทธิ์', flags: 64 }); return; }
    await interaction.deferReply({ flags: 64 });
    try {
      const days   = interaction.options.getInteger('days');
      const folder = interaction.options.getString('folder') || '';
      const cutoff = Date.now() - days * 86_400_000;
      const files  = await r2.searchObjects(folder);
      const old    = files.filter(f => new Date(f.modified).getTime() < cutoff);
      if (!old.length) { await interaction.editReply({ content: `✅ ไม่มีไฟล์เก่ากว่า ${days} วัน` }); return; }
      // ลบแบบ parallel
      await Promise.all(old.map(f => r2.deleteObject(f.key)));
      await interaction.editReply({ content: `🗑️ ลบ **${old.length}** ไฟล์ที่เก่ากว่า ${days} วันแล้ว` });
    } catch (e) { await interaction.editReply({ content: '❌ Error: ' + e.message }); }
    return;
  }

  if (commandName === 'help') {
    await interaction.reply({
      content: [
        '**📋 FileVault Bot Commands**',
        '`/status`                       — ดูสถานะ (embed)',
        '`/serverstats`                  — ดู stats รายละเอียด',
        '`/shutdown`                     — ปิด server (admin)',
        '`/locks`                        — ดาวน์โหลด folder-locks.json (admin)',
        '`/r2stats`                      — ดูจำนวนไฟล์และขนาดรวมใน R2',
        '`/r2list [folder] [limit]`      — list ไฟล์ล่าสุดใน R2',
        '`/r2delete <key>`               — ลบไฟล์ใน R2 (admin)',
        '`/purge <days> [folder]`        — ลบไฟล์เก่าเกิน N วัน (admin)',
        '`/help`                         — แสดง commands',
      ].join('\n'),
      flags: 64,
    });
    return;
  }
});

// ── Auto-upload attachments → R2 ──
const IMAGE_MIME = new Set(['image/png','image/jpeg','image/gif','image/webp','image/bmp','image/tiff','image/avif','image/heic','image/svg+xml']);
const IMAGE_EXT  = new Set(['png','jpg','jpeg','gif','webp','bmp','avif','heic','svg']);
const MIME_MAP   = {
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp',
  bmp:'image/bmp', avif:'image/avif', heic:'image/heic', svg:'image/svg+xml',
  pdf:'application/pdf',
  doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:'application/vnd.ms-powerpoint', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt:'text/plain', md:'text/markdown', csv:'text/csv', json:'application/json',
  html:'text/html', htm:'text/html', xml:'application/xml', yaml:'text/yaml', yml:'text/yaml',
  js:'text/javascript', ts:'text/typescript', py:'text/x-python',
  zip:'application/zip', rar:'application/vnd.rar', '7z':'application/x-7z-compressed',
  gz:'application/gzip', tar:'application/x-tar',
  mp4:'video/mp4', mov:'video/quicktime', avi:'video/x-msvideo', mkv:'video/x-matroska',
  mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac',
};

function isImage(att) {
  const ct  = att.contentType || '';
  const ext = att.name?.split('.').pop()?.toLowerCase() || '';
  return [...IMAGE_MIME].some(m => ct.startsWith(m)) || IMAGE_EXT.has(ext);
}

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || msg.channel.id !== channelId || !msg.attachments.size) return;

  const ts = Date.now();
  // อัพโหลดทุก attachment แบบ parallel
  const results = await Promise.allSettled(
    [...msg.attachments.values()].map(async att => {
      const { buffer, contentType: rawCt } = await downloadToBuffer(att.url);
      const safeName    = att.name.replace(/[^a-zA-Z0-9._\-ก-๙]/g, '_');
      const ext         = safeName.split('.').pop().toLowerCase();
      const contentType = MIME_MAP[ext] || rawCt || att.contentType || 'application/octet-stream';
      const folder      = isImage(att) ? imageFolder : fileFolder;
      const key         = `${folder}/${ts}_${safeName}`;
      await r2.uploadObject(key, buffer, contentType);
      console.log(`${CYN}☁ Discord → R2: ${key} [${contentType}]${R}`);
    })
  );

  const uploaded = results.filter(r => r.status === 'fulfilled').length;
  results.filter(r => r.status === 'rejected').forEach((r, i) => {
    console.error(`${RED}❌ Upload failed [${i}]: ${r.reason?.message}${R}`);
  });

  if (uploaded > 0) {
    try { await msg.react('☁'); } catch {}
    setTimeout(async () => {
      try { await msg.delete(); console.log(`${GRY}🗑 ลบ message ใน Discord: ${msg.id}${R}`); }
      catch (e) { console.error(`${RED}❌ ลบ message ไม่ได้: ${e.message}${R}`); }
    }, 10_000);
  }
});

// ── Monitor Client ──
let monitorDashboard = null;
let monitorInterval  = null;

async function registerMonitorCommands() {
  const commands = [
    new SlashCommandBuilder().setName('start').setDescription('เริ่ม site monitor'),
    new SlashCommandBuilder().setName('stop').setDescription('หยุด site monitor'),
  ];
  const rest = new REST({ version: '10' }).setToken(MONITOR_TOKEN);
  await rest.put(Routes.applicationCommands(MONITOR_CLIENT_ID), { body: commands });
  console.log(`${GRN}✅ [Monitor] Registered slash commands${R}`);
}

async function checkSite(url) {
  try { const res = await axios.get(url, { timeout: 8000 }); return { url, up: true, code: res.status }; }
  catch { return { url, up: false, code: 'DOWN' }; }
}

function makeMonitorEmbed(results) {
  return new EmbedBuilder()
    .setTitle('📡 SITE MONITOR DASHBOARD')
    .setColor(results.every(r => r.up) ? 0x2ecc71 : 0xe74c3c)
    .setDescription(results.map(r => `${r.up ? '🟢' : '🔴'} \`${r.url}\` — ${r.code}`).join('\n'))
    .setFooter({ text: 'Auto-updating every 10s' })
    .setTimestamp();
}

async function startMonitor() {
  const channel = await monitorClient.channels.fetch(MONITOR_CHANNEL);
  // ตรวจสอบ URLs แบบ parallel
  const results     = await Promise.all(MONITOR_URLS.map(checkSite));
  monitorDashboard  = await channel.send({ embeds: [makeMonitorEmbed(results)] });
  monitorInterval   = setInterval(async () => {
    const updated = await Promise.all(MONITOR_URLS.map(checkSite));
    await monitorDashboard.edit({ embeds: [makeMonitorEmbed(updated)] });
  }, 10_000);
}

async function stopMonitor() {
  clearInterval(monitorInterval); monitorInterval = null;
  if (monitorDashboard) { await monitorDashboard.delete().catch(() => {}); monitorDashboard = null; }
}

monitorClient.once('clientReady', async () => {
  console.log(`${B}${CYN}🤖 [Monitor Bot] Logged in as ${monitorClient.user.tag}${R}`);
  await registerMonitorCommands();
});

monitorClient.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'start') {
    await interaction.deferReply({ flags: 64 });
    await startMonitor();
    await interaction.editReply('✅ Monitor Started');
    setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
  }
  if (interaction.commandName === 'stop') {
    await interaction.deferReply({ flags: 64 });
    await stopMonitor();
    await interaction.editReply('🛑 Monitor Stopped');
    setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
  }
});

// ── Graceful Shutdown ──
async function shutdown() {
  console.log(`\n${YLW}🛑 [Bot] Shutting down...${R}`);
  await stopDashboard();
  await stopMonitor();
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ── Login ──
console.log(`\n${B}${CYN}  🤖  FileVault Bot${R}`);
console.log(`${GRY}  ───────────────────────────────${R}`);
console.log(`  ${B}Server URL:${R} ${FV_SERVER_URL}`);
console.log(`  ${B}Channel  :${R} ${channelId || '(ไม่ได้ตั้งค่า)'}`);
console.log(`  ${B}Monitor  :${R} ${MONITOR_TOKEN ? GRN + '✓' + R : GRY + 'disabled' + R}`);
console.log(`${GRY}  ───────────────────────────────${R}\n`);

if (!token) {
  console.error(`${RED}❌ DISCORD_TOKEN ไม่ได้ตั้งค่า — ไม่สามารถเริ่ม FileVault Bot${R}`);
} else {
  client.login(token);
}

if (MONITOR_TOKEN) {
  monitorClient.login(MONITOR_TOKEN);
} else {
  console.warn(`${GRY}⚠ MTDISCORD_TOKEN ไม่ได้ตั้งค่า — Monitor Bot จะไม่ทำงาน${R}`);
}
