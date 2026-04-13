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
 */

require('dotenv').config();
const {
  Client, GatewayIntentBits,
  Events, SlashCommandBuilder, REST, Routes,
} = require('discord.js');
const axios = require('axios');
const path  = require('path');
const fs    = require('fs');
const r2    = require('./r2');

// ── Config ──
const FV_SERVER_URL = process.env.FV_SERVER_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
const token         = process.env.DISCORD_TOKEN;
const channelId     = process.env.CHANNEL_ID;
const imageFolder   = process.env.DISCORD_IMAGE_FOLDER || 'discord-images';
const fileFolder    = process.env.DISCORD_FILE_FOLDER  || 'discord-files';
const ADMIN_IDS     = (process.env.DISCORD_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

// ── ANSI ──
const R   = '\x1b[0m', B = '\x1b[1m';
const GRN = '\x1b[32m', RED = '\x1b[31m', CYN = '\x1b[36m', GRY = '\x1b[90m';

// ── Client ──
const INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent];
const client  = new Client({ intents: INTENTS });

// ── Helpers ──
function isAdmin(userId) { return !ADMIN_IDS.length || ADMIN_IDS.includes(userId); }

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

// ── Bot Ready ──
client.once('ready', async () => {
  console.log(`\n${B}${CYN}🤖 [FileVault Bot] Logged in as ${client.user.tag}${R}`);
  await registerCommands();
});

// ── Slash Commands ──
async function registerCommands() {
  const commands = [
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
    new SlashCommandBuilder().setName('locks').setDescription('ดาวน์โหลดไฟล์ folder-locks.json'),
    new SlashCommandBuilder().setName('shutdown').setDescription('ปิด FileVault Server'),
    new SlashCommandBuilder().setName('help').setDescription('แสดง commands ทั้งหมด'),
  ];
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands.map(c => c.toJSON()) });
  console.log(`${GRN}✅ [FileVault] Registered slash commands${R}`);
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user } = interaction;

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
      await Promise.all(old.map(f => r2.deleteObject(f.key)));
      await interaction.editReply({ content: `🗑️ ลบ **${old.length}** ไฟล์ที่เก่ากว่า ${days} วันแล้ว` });
    } catch (e) { await interaction.editReply({ content: '❌ Error: ' + e.message }); }
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

  if (commandName === 'shutdown') {
    if (!isAdmin(user.id)) { await interaction.reply({ content: '❌ คุณไม่มีสิทธิ์สั่งปิด server', flags: 64 }); return; }
    await interaction.reply({ content: '🛑 กำลังส่งคำสั่งปิด FileVault Server...', flags: 64 });
    try {
      const tk = process.env.FV_SHUTDOWN_TOKEN || '';
      await axios.post(`${FV_SERVER_URL}/api/shutdown`, { token: tk }, {
        headers: tk ? { 'x-shutdown-token': tk } : {},
        timeout: 5000,
      });
    } catch { console.log(`🛑 Shutdown sent by ${user.tag}`); }
    return;
  }

  if (commandName === 'help') {
    await interaction.reply({
      content: [
        '**📋 FileVault Bot Commands**',
        '`/r2stats`                      — ดูจำนวนไฟล์และขนาดรวมใน R2',
        '`/r2list [folder] [limit]`      — list ไฟล์ล่าสุดใน R2',
        '`/r2delete <key>`               — ลบไฟล์ใน R2 (admin)',
        '`/purge <days> [folder]`        — ลบไฟล์เก่าเกิน N วัน (admin)',
        '`/locks`                        — ดาวน์โหลด folder-locks.json (admin)',
        '`/shutdown`                     — ปิด server (admin)',
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

// ── Graceful Shutdown ──
process.on('SIGINT',  () => { console.log(`\n🛑 [Bot] Shutting down...`); process.exit(0); });
process.on('SIGTERM', () => { console.log(`\n🛑 [Bot] Shutting down...`); process.exit(0); });

// ── Login ──
console.log(`\n${B}${CYN}  🤖  FileVault Bot${R}`);
console.log(`  ${B}Channel:${R} ${channelId || '(ไม่ได้ตั้งค่า)'}`);

if (!token) {
  console.error(`${RED}❌ DISCORD_TOKEN ไม่ได้ตั้งค่า${R}`);
} else {
  client.login(token);
}
