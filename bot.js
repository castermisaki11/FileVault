require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');

const axios = require('axios');
const https = require('https');
const http = require('http');
const r2 = require('./r2');

// ===== CONFIG =====
const TOKEN = process.env.MTDISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID2;
const CHANNEL_ID = process.env.MTDISCORD_CHANNEL_ID;
const URLS = process.env.MONITOR_URLS.split(',');

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

let dashboard = null;
let interval = null;

// ===== REGISTER SLASH COMMANDS =====
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('start')
      .setDescription('เริ่ม monitor'),

    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('หยุด monitor')
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );

  console.log("✅ Registered Slash Commands");
}

// ===== CHECK SITE =====
async function checkSite(url) {
  try {
    const res = await axios.get(url);

    return {
      url,
      up: true,
      code: res.status
    };

  } catch {
    return {
      url,
      up: false,
      code: "DOWN"
    };
  }
}

// ===== BUILD DASHBOARD =====
function makeEmbed(results) {
  return new EmbedBuilder()
    .setTitle("📡 SERVER DASHBOARD")
    .setColor(0x3498db)
    .setDescription(
      results.map(r =>
        `${r.up ? "🟢" : "🔴"} ${r.url} | ${r.code}`
      ).join("\n")
    )
    .setTimestamp();
}

// ===== START MONITOR =====
async function startMonitor() {
  const channel = await client.channels.fetch(CHANNEL_ID);

  const results = [];

  for (const url of URLS) {
    results.push(await checkSite(url));
  }

  dashboard = await channel.send({
    embeds: [makeEmbed(results)]
  });

  interval = setInterval(async () => {

    const updated = [];

    for (const url of URLS) {
      updated.push(await checkSite(url));
    }

    await dashboard.edit({
      embeds: [makeEmbed(updated)]
    });

  }, 10000);
}

// ===== STOP MONITOR =====
async function stopMonitor() {
  clearInterval(interval);

  if (dashboard) {
    await dashboard.delete().catch(() => {});
    dashboard = null;
  }
}

// ===== READY =====
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  await registerCommands();
});

// ===== HANDLE COMMAND =====
client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) return;

    // START
    if (interaction.commandName === 'start') {

        console.log(`[COMMAND] /start by ${interaction.user.tag}`);

        await interaction.deferReply({
            flags: 64
        });

        await startMonitor();

        await interaction.editReply("✅ Monitor Started");

        setTimeout(async () => {
            await interaction.deleteReply().catch(() => {});
        }, 3000);
    }


    // STOP
    if (interaction.commandName === 'stop') {

        console.log(`[COMMAND] /stop by ${interaction.user.tag}`);

        await interaction.deferReply({
            flags: 64
        });

        await stopMonitor();

        await interaction.editReply("🛑 Monitor Stopped");

        setTimeout(async () => {
            await interaction.deleteReply().catch(() => {});
        }, 3000);
    }

});

// ===== DOWNLOAD URL TO BUFFER =====
function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: res.headers['content-type'] || 'application/octet-stream'
      }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ===== AUTO-UPLOAD DISCORD IMAGES TO R2 =====
const IMAGE_MIME = ['image/png','image/jpeg','image/gif','image/webp','image/bmp','image/tiff','image/avif','image/heic','image/svg+xml'];
const imageFolder = process.env.DISCORD_IMAGE_FOLDER || 'discord-images';

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  if (!msg.attachments.size) return;

  const images = [...msg.attachments.values()].filter(a => {
    const ct = a.contentType || '';
    const ext = a.name?.split('.').pop()?.toLowerCase() || '';
    return IMAGE_MIME.some(m => ct.startsWith(m.split('/')[0] + '/' + m.split('/')[1])) ||
           ['png','jpg','jpeg','gif','webp','bmp','avif','heic','svg'].includes(ext);
  });

  if (!images.length) return;

  let uploaded = 0;
  for (const att of images) {
    try {
      const { buffer, contentType: rawCt } = await downloadToBuffer(att.url);
      const timestamp = Date.now();
      const safeName = att.name.replace(/[^a-zA-Z0-9.\-ก-๙]/g, '_');
      const key = `${imageFolder}/${timestamp}_${safeName}`;
      const ext = safeName.split('.').pop().toLowerCase();
      const mimeMap = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', avif:'image/avif', heic:'image/heic', svg:'image/svg+xml' };
      const contentType = mimeMap[ext] || rawCt || 'application/octet-stream';
      await r2.uploadObject(key, buffer, contentType);
      uploaded++;
      console.log(`☁ [bot.js] Discord image uploaded → R2: ${key} [${contentType}]`);
    } catch (e) {
      console.error(`❌ [bot.js] Failed to upload Discord image: ${att.name}`, e.message);
    }
  }

  if (uploaded > 0) {
    try { await msg.react('☁'); } catch {}

    setTimeout(async () => {
      try {
        await msg.delete();
        console.log(`🗑 [bot.js] ลบรูปใน Discord แล้ว (message: ${msg.id})`);
      } catch (e) {
        console.error(`❌ [bot.js] ลบ message ไม่ได้: ${e.message}`);
      }
    }, 10_000);
  }
});

// ===== LOGIN =====
client.login(TOKEN);