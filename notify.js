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
      { name: "🕒 Time", value: getThaiTime(), inline: true },
      { name: "⏱️ Uptime", value: uptime(), inline: true },

      { name: "🧠 RAM Usage", value: memoryUsage(), inline: true },
      { name: "💻 CPU Load", value: cpuUsage(), inline: true },
      { name: "🌐 IP", value: getLocalIP(), inline: false },

      ...(domain ? [{ name: "🔗 Domain", value: domain, inline: false }] : []),
    ],
    footer: {
      text: "Auto-updating every 5 seconds",
    },
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
// 🤖 BOT READY
// ───────────────
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  // Delete previous status message (handles crash/kill scenarios)
  await deleteOldDashboard();

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return console.log("❌ Channel not found");

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
      const { buffer, contentType } = await downloadToBuffer(att.url.split("?")[0]);
      const timestamp = Date.now();
      const safeName = att.name.replace(/[^a-zA-Z0-9._\-ก-๙]/g, "_");
      const key = `${imageFolder}/${timestamp}_${safeName}`;
      await r2.uploadObject(key, buffer, contentType);
      uploaded++;
      console.log(`☁ Discord image uploaded → R2: ${key}`);
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
module.exports = { sendOnline, sendOffline };

client.login(token);