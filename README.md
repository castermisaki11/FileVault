# ☁ FileVault

ระบบจัดการไฟล์ผ่านเว็บ เชื่อมต่อ Cloudflare R2 พร้อม Discord Bot

---

## Features

| | |
|---|---|
| 📁 | จัดการไฟล์/โฟลเดอร์ผ่าน Web UI |
| ☁ | เก็บไฟล์บน Cloudflare R2 |
| 🔒 | ล็อครหัสผ่านทั้งเว็บ และล็อครายโฟลเดอร์ |
| 🤖 | Discord Bot — แสดง status server + auto-upload รูปภาพจาก Discord → R2 |
| 🖼️ | Preview รูปภาพ / PDF / วิดีโอ / เสียง |
| 🔍 | ค้นหา + กรองไฟล์ (ขนาด, วันที่, ประเภท) |

---

## Setup

### 1. Install

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

### 3. Discord Bot (ถ้าใช้)

เปิด Permission ใน Discord Developer Portal:
- ✅ `Read Messages / View Channels`
- ✅ `Send Messages`
- ✅ `Add Reactions`
- ✅ `Read Message History`
- ✅ **Message Content Intent** (Privileged Intents)

### 4. Run

```bash
npm start
```

---

## Environment Variables

| Variable | Default | คำอธิบาย |
|---|---|---|
| `FV_PORT` | `3000` | Port ที่ใช้รัน |
| `FV_STORAGE_LIMIT` | `5gb` | จำกัดพื้นที่รวม (`0` = ไม่จำกัด) |
| `FV_FILE_LIMIT` | `200mb` | จำกัดขนาดต่อไฟล์ |
| `FV_SITE_PASSWORD` | _(ว่าง)_ | รหัสผ่านเข้าเว็บทั้งหมด |
| `FV_DEFAULT_FOLDER` | `upload/cloud` | โฟลเดอร์ default ใน R2 |
| `R2_ACCOUNT_ID` | — | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | — | R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | — | R2 Secret Key |
| `R2_BUCKET` | — | ชื่อ Bucket |
| `R2_PUBLIC_URL` | _(ว่าง)_ | Custom domain สำหรับ public URL |
| `DISCORD_TOKEN` | — | Discord Bot Token |
| `CHANNEL_ID` | — | Channel ID สำหรับ status |
| `DISCORD_IMAGE_FOLDER` | `discord-images` | โฟลเดอร์ใน R2 สำหรับรูปจาก Discord |
| `DOMAIN` | _(ว่าง)_ | Domain แสดงใน Discord embed |

---

## ระบบล็อคโฟลเดอร์

เมื่อตั้งรหัส PIN ไว้แล้ว:
- **ไม่สามารถเข้าดูไฟล์ได้เลย** (ทั้ง list และ download)
- **thumbnail ใน sidebar จะไม่แสดง** — แสดงแค่ 🔒 แทน
- ต้องใส่ PIN ถูกต้องก่อนจึงจะเข้าถึงได้
- Server จะ block request ทุก type ที่ไม่มี PIN ส่งมา

---

## Storage Path

ไฟล์ที่อัปโหลดจะถูกเก็บใน R2 ที่ path:

```
upload/cloud/<ชื่อไฟล์>
```

(หรือกำหนด path เองผ่าน `FV_DEFAULT_FOLDER`)

---

## License

MIT
