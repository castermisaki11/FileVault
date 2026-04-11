# ☁ FileVault

ระบบจัดการไฟล์ผ่านเว็บ เชื่อมต่อ Cloudflare R2 และ Discord Bot

## Features

- 📁 จัดการไฟล์/โฟลเดอร์ผ่านหน้าเว็บ
- ☁ เก็บไฟล์บน Cloudflare R2
- 🔒 ล็อครหัสผ่านทั้งเว็บ และล็อครายโฟลเดอร์
- 🤖 Discord Bot — แสดง status server และ auto-upload รูปภาพจาก Discord → R2
- 🖼️ Preview รูปภาพ / PDF / วิดีโอ / เสียง
- 🔍 ค้นหา + กรองไฟล์ (ขนาด, วันที่, ประเภท)

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/your-username/filevault-server.git
cd filevault-server
npm install
```

### 2. ตั้งค่า Environment

```bash
cp .env.example .env
# แก้ไข .env ใส่ค่าให้ครบ
```

### 3. Discord Bot Permissions

Bot ต้องมี permission:
- `Read Messages / View Channels`
- `Send Messages`
- `Add Reactions`
- `Read Message History`

Privileged Intents ที่ต้องเปิดใน Discord Developer Portal:
- ✅ **Message Content Intent**

### 4. Run

```bash
npm start
```

## Environment Variables

| Variable | Default | คำอธิบาย |
|---|---|---|
| `FV_PORT` | `3000` | Port ที่ใช้รัน |
| `FV_STORAGE_LIMIT` | `5gb` | จำกัดพื้นที่รวม (0 = ไม่จำกัด) |
| `FV_FILE_LIMIT` | `200mb` | จำกัดขนาดต่อไฟล์ |
| `FV_SITE_PASSWORD` | _(ว่าง)_ | รหัสผ่านเข้าเว็บ (ถ้าว่าง = ไม่ล็อค) |
| `FV_DEFAULT_FOLDER` | `uploads` | โฟลเดอร์ default ใน R2 |
| `R2_ACCOUNT_ID` | — | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | — | R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | — | R2 Secret Key |
| `R2_BUCKET` | — | ชื่อ Bucket |
| `R2_PUBLIC_URL` | _(ว่าง)_ | Custom domain สำหรับ public URL |
| `DISCORD_TOKEN` | — | Bot Token |
| `CHANNEL_ID` | — | Channel ID สำหรับ status |
| `DISCORD_IMAGE_FOLDER` | `discord-images` | โฟลเดอร์ใน R2 สำหรับรูปจาก Discord |
| `DOMAIN` | _(ว่าง)_ | Domain แสดงใน Discord embed |

## License

MIT
