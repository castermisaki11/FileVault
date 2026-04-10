require("dotenv").config();

const axios = require("axios");
const os = require("os");

// ───────────────
// ENV
// ───────────────
const webhook = process.env.WEBHOOK_URL;
const domain = process.env.DOMAIN;

let messageId = null;
let interval = null;
let startTime = Date.now();

// ───────────────
// 🕒 TIME TH
// ───────────────
function getThaiTime() {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

// ───────────────
// 📅 DAY
// ───────────────
function getDay() {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];
}

// ───────────────
// 🌐 IP
// ───────────────
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "Unknown";
}

// ───────────────
// ⏱️ UPTIME
// ───────────────
function formatUptime() {
  const sec = Math.floor((Date.now() - startTime) / 1000);

  const m = Math.floor(sec / 60);
  const s = sec % 60;

  if (m < 1) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

// ───────────────
// 🧹 DELETE MSG
// ───────────────
async function deleteMessage() {
  if (!messageId) return;

  try {
    await axios.delete(`${webhook}/messages/${messageId}`);
  } catch (e) {
    console.log("Delete error:", e.message);
  }

  messageId = null;
}

// ───────────────
// 🟢 ONLINE
// ───────────────
async function sendOnline() {
  try {
    await deleteMessage();

    startTime = Date.now();

    const res = await axios.post(webhook + "?wait=true", {
      embeds: [
        {
          title: "🟢 Server Online",
          color: 0x2ecc71,
          fields: [
            { name: "📅 Day", value: getDay(), inline: true },
            { name: "🕒 Time (TH)", value: getThaiTime(), inline: false },
            { name: "⏱️ Uptime", value: "0s", inline: true },
            { name: "🌐 IP", value: getLocalIP(), inline: false },
            ...(domain ? [{ name: "🔗 Domain", value: filevault-wiu1.onrender.com }] : [])
          ]
        }
      ]
    });

    messageId = res.data.id;
    startOnlineLoop();

  } catch (e) {
    console.log("Online error:", e.message);
  }
}

// ───────────────
// 🔁 UPDATE 10s
// ───────────────
function startOnlineLoop() {
  if (interval) clearInterval(interval);

  interval = setInterval(async () => {
    if (!messageId) return;

    try {
      await axios.patch(`${webhook}/messages/${messageId}`, {
        embeds: [
          {
            title: "🟢 Server Online",
            color: 0x2ecc71,
            fields: [
              { name: "📅 Day", value: getDay(), inline: true },
              { name: "🕒 Time (TH)", value: getThaiTime(), inline: false },
              { name: "⏱️ Uptime", value: formatUptime(), inline: true },
              { name: "🌐 IP", value: getLocalIP(), inline: false },
              ...(domain ? [{ name: "🔗 Domain", value: domain }] : [])
            ]
          }
        ]
      });
    } catch (e) {
      console.log("Update error:", e.message);
    }
  }, 10000);
}

// ───────────────
// 🔴 OFFLINE
// ───────────────
async function sendOffline() {
  try {
    if (interval) clearInterval(interval);

    const res = await axios.post(webhook + "?wait=true", {
      embeds: [
        {
          title: "🔴 Server Offline",
          color: 0xe74c3c,
          fields: [
            { name: "⏱️ Countdown", value: "3", inline: true }
          ]
        }
      ]
    });

    const id = res.data.id;

    for (let i = 3; i >= 1; i--) {
      await new Promise(r => setTimeout(r, 1000));

      await axios.patch(`${webhook}/messages/${id}`, {
        embeds: [
          {
            title: "🔴 Server Offline",
            color: 0xe74c3c,
            fields: [
              { name: "⏱️ Countdown", value: `${i}`, inline: true }
            ]
          }
        ]
      });
    }

    await new Promise(r => setTimeout(r, 1000));
    await axios.delete(`${webhook}/messages/${id}`);

    await deleteMessage();

  } catch (e) {
    console.log("Offline error:", e.message);
  }
}

module.exports = { sendOnline, sendOffline };