# ☁️ FileVault

ระบบจัดการไฟล์ผ่านเว็บ เชื่อมต่อ **Cloudflare R2** พร้อม **Discord Bot** — รันบน Node.js/Express

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)

---

## ✨ Features

| | |
|---|---|
| 📁 | จัดการไฟล์/โฟลเดอร์ผ่าน Web UI |
| ☁️ | เก็บไฟล์บน **Cloudflare R2** (S3-compatible) |
| 🔒 | ล็อครหัสผ่านทั้งเว็บ และล็อค PIN รายโฟลเดอร์ |
| 🤖 | **Discord Bot** — realtime dashboard + slash commands + auto-upload attachment → R2 |
| 📊 | Stats sync กับ R2 อัตโนมัติ — ข้อมูลไม่หายเมื่อ restart |
| 🖼️ | Preview รูปภาพ / PDF / วิดีโอ / เสียง |
| 🔍 | ค้นหา + กรองไฟล์ (ขนาด, วันที่, ประเภท) |
| 📡 | Monitor bot — ตรวจสอบ uptime URL ภายนอก |
| 🛑 | Graceful shutdown พร้อม auto-archive ไฟล์ |

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/castermisaki11/FileVault.git
cd FileVault
npm install
```

### 2. ตั้งค่า Environment

```bash
cp .env.example .env
# แก้ .env ใส่ค่าของคุณ
```

### 3. Run

```bash
npm start
```

เปิดเบราว์เซอร์ที่ `http://localhost:3000`

---

## ⚙️ Environment Variables

### Server

| Variable | Default | คำอธิบาย |
|---|---|---|
| `FV_PORT` | `3000` | Port ที่ใช้รัน |
| `FV_STORAGE_LIMIT` | `0` | จำกัดพื้นที่รวม (`0` = ไม่จำกัด) เช่น `5gb`, `500mb` |
| `FV_FILE_LIMIT` | `200mb` | จำกัดขนาดต่อไฟล์ |
| `FV_STATUS_MS` | `5000` | interval แสดง status ใน terminal (ms) |
| `FV_SITE_PASSWORD` | _(ว่าง)_ | รหัสผ่านเข้าเว็บทั้งหมด (ว่าง = ไม่ล็อค) |
| `FV_DEFAULT_FOLDER` | `upload/cloud` | โฟลเดอร์ default ใน R2 |
| `FV_SHUTDOWN_TOKEN` | _(ว่าง)_ | Token สำหรับ `POST /api/shutdown` |

### Cloudflare R2

| Variable | คำอธิบาย |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Access Key |
| `R2_BUCKET` | ชื่อ Bucket |
| `R2_PUBLIC_URL` | _(optional)_ Custom domain สำหรับ public URL |

### Stats Sync

| Variable | Default | คำอธิบาย |
|---|---|---|
| `FV_STATS_KEY` | `system/stats.json` | Key ใน R2 สำหรับเก็บ stats |
| `FV_STATS_SYNC_MS` | `15000` | Sync interval (ms) |

### Discord Bot

| Variable | คำอธิบาย |
|---|---|
| `DISCORD_TOKEN` | Bot Token หลัก (FileVault dashboard) |
| `DISCORD_CLIENT_ID` | Application ID ของ bot หลัก |
| `CHANNEL_ID` | Channel ID สำหรับแสดง realtime dashboard |
| `DISCORD_ADMIN_IDS` | User ID ที่มีสิทธิ์ใช้คำสั่ง admin (คั่นด้วย `,`) |
| `DISCORD_IMAGE_FOLDER` | `discord-images` — โฟลเดอร์ใน R2 สำหรับรูปจาก Discord |
| `DISCORD_FILE_FOLDER` | `discord-files` — โฟลเดอร์ใน R2 สำหรับไฟล์อื่น |
| `DOMAIN` | Domain แสดงใน Discord embed |

## 🤖 Discord Bot Commands

| Command | คำอธิบาย |
|---|---|
| `/status` | ดูสถานะ server แบบ realtime |
| `/shutdown` | ปิด server *(admin only)* |
| `/locks` | ดาวน์โหลด folder-locks.json *(admin only)* |
| `/r2stats` | ดูจำนวนไฟล์และขนาดรวมใน R2 |
| `/r2list [folder] [limit]` | แสดง list ไฟล์ล่าสุดใน R2 |
| `/r2delete <key>` | ลบไฟล์ใน R2 *(admin only)* |
| `/purge <days> [folder]` | ลบไฟล์เก่าเกิน N วัน *(admin only)* |

### การตั้งค่า Bot Permissions

เปิดใน Discord Developer Portal → Bot → Privileged Gateway Intents:

- ✅ `Message Content Intent`

Permissions ที่ต้องการ:
- ✅ Read Messages / View Channels
- ✅ Send Messages
- ✅ Manage Messages *(สำหรับลบ message หลัง upload)*
- ✅ Add Reactions
- ✅ Read Message History

---

## 🔒 ระบบล็อคโฟลเดอร์

- ตั้ง PIN 4 หลักต่อโฟลเดอร์ได้อิสระ
- ไฟล์ใน folder ที่ล็อคจะ **ไม่แสดง thumbnail** และ **ไม่สามารถดาวน์โหลดได้** จนกว่าจะใส่ PIN ถูก
- Server block ทุก request (list / download / delete) ถ้าไม่มี PIN

---

## 📊 Stats Sync

stats (requests, uploads, downloads, R2 operations ฯลฯ) จะถูก:
- โหลดจาก R2 ตอน server start (merge กับ local — เอาค่าที่มากกว่า)
- บันทึกขึ้น R2 ทุก 15 วินาที (ปรับได้ผ่าน `FV_STATS_SYNC_MS`)
- Flush ทันทีตอน graceful shutdown

---

## 📡 API Endpoints

### Files
| Method | Path | คำอธิบาย |
|---|---|---|
| `GET` | `/api/files` | List ไฟล์ใน folder |
| `GET` | `/api/search?q=` | ค้นหาไฟล์ |
| `POST` | `/api/upload` | อัปโหลดไฟล์ |
| `GET` | `/api/download/:name` | ดาวน์โหลดไฟล์ |
| `DELETE` | `/api/delete/:name` | ลบไฟล์ |
| `POST` | `/api/move` | ย้าย/copy ไฟล์ |
| `PATCH` | `/api/rename` | เปลี่ยนชื่อไฟล์ |

### R2 Direct
| Method | Path | คำอธิบาย |
|---|---|---|
| `GET` | `/api/r2/files` | List objects ใน R2 |
| `POST` | `/api/r2/upload` | Upload ตรงไปยัง R2 |
| `GET` | `/api/r2/download/*` | Download จาก R2 ด้วย key |
| `DELETE` | `/api/r2/delete/*` | ลบ object ใน R2 |
| `POST` | `/api/r2/move` | Move/copy object ใน R2 |
| `GET` | `/api/r2/status` | ตรวจสอบการเชื่อมต่อ R2 |
| `POST` | `/api/r2/presign/upload` | สร้าง presigned URL สำหรับ upload |
| `POST` | `/api/r2/presign/download` | สร้าง presigned URL สำหรับ download |

### System
| Method | Path | คำอธิบาย |
|---|---|---|
| `GET` | `/api/stats` | ดู stats |
| `POST` | `/api/stats/reset` | Reset stats |
| `POST` | `/api/shutdown` | ปิด server |
| `GET` | `/api/dump/latest` | ดาวน์โหลด backup ล่าสุด |

---

## 🗂️ Project Structure

```
FileVault/
├── server.js          # Express server หลัก
├── r2.js              # Cloudflare R2 module (AWS SDK v3)
├── notify.js          # Discord bot (FileVault + Monitor)
├── stats-sync.js      # Stats persistence กับ R2
├── public/
│   ├── index.html     # Web UI
│   ├── styles.css
│   ├── categories.css
│   └── categories.js
├── .env.example       # Template environment variables
├── .gitignore
└── package.json
```

---

## 📋 Requirements

- Node.js 18+
- Cloudflare R2 bucket
- Discord Bot Token *(optional)*

---

## License

[MIT](LICENSE) — ใช้งานได้เลย ฟรี ไม่มีข้อจำกัด
