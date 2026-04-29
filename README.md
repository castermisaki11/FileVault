# ☁ FileVault

> ระบบจัดการไฟล์ส่วนตัว — Cloudflare R2 + PostgreSQL

FileVault เป็น self-hosted file manager ที่เก็บไฟล์บน **Cloudflare R2** และบันทึกข้อมูลใน **PostgreSQL**

---

## ✨ Features

| หมวด | ฟีเจอร์ |
|---|---|
| **ไฟล์** | อัปโหลด / ดาวน์โหลด / ลบ / ย้าย / เปลี่ยนชื่อ |
| **Folder** | สร้าง / ลบ / ล็อกด้วย PIN 4 หลัก |
| **Storage** | Cloudflare R2 (S3-compatible), presign URL, multipart upload |
| **ฐานข้อมูล** | PostgreSQL — folder locks, sessions, audit log, สถิติรายวัน |
| **ความปลอดภัย** | Site password, folder PIN lock, session token ใน DB |

---

## 📁 โครงสร้างโปรเจกต์

```
filevault/
├── index.js              ← entry point (node index.js)
├── package.json
├── .env                  ← ตั้งค่า secret
├── render.yaml           ← deploy บน Render
│
├── src/
│   ├── core/
│   │   ├── server.js     ← Express API + Multer + R2 routes
│   │   ├── db.js         ← PostgreSQL layer (pool, migrations, queries)
│   │   └── r2.js         ← Cloudflare R2 module (AWS SDK v3)
│   └── sync/
│       └── stats-sync.js ← Legacy R2 stats sync (fallback)
│
└── public/               ← Frontend (HTML/CSS/JS)
    ├── index.html
    ├── app.js
    ├── styles.css
    └── categories.*
```

---

## 🚀 ติดตั้งและรัน

### 1. Clone + ติดตั้ง dependencies

```bash
git clone <your-repo>
cd filevault
npm install
```

### 2. ตั้งค่า `.env`

ค่าที่ **ต้องตั้ง**:

| Key | คำอธิบาย |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Key |
| `R2_BUCKET` | ชื่อ R2 bucket |

### 3. รัน

```bash
npm start
```

### 4. เปิดเบราว์เซอร์

```
http://localhost:3000
```

---

## 🗄️ PostgreSQL

### Connection

ใส่ใน `.env`:
```
DATABASE_URL=postgresql://user:password@host:5432/filevault
```

รองรับทุก provider: **Neon**, **Supabase**, **Render Postgres**, **Railway**, หรือ self-hosted

### Schema (สร้างอัตโนมัติตอน startup)

| ตาราง | เก็บอะไร |
|---|---|
| `folder_locks` | PIN hash + hint ของแต่ละ folder |
| `site_sessions` | Auth token + IP + expiry (30 วัน) |
| `file_events` | Audit log ทุก upload/download/delete |
| `upload_stats` | สถิติรายวัน (นับ + bytes) |

### API endpoints

```
GET  /api/stats          — สถิติรายวัน (query: ?days=30)
GET  /api/events         — audit log   (query: ?type=upload&folder=x&limit=100)
GET  /api/db/health      — สถานะ DB connection
```

---

## ☁️ Deploy บน Render

1. Push code ขึ้น GitHub
2. สร้าง **Web Service** บน [render.com](https://render.com)
3. เชื่อม repo
4. Render จะใช้ `render.yaml` อัตโนมัติ
5. ไปที่ **Environment** → เพิ่ม secret variables:
   - `DATABASE_URL` (สร้าง Render Postgres หรือใช้ Neon)
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`

---

## 🔑 Environment Variables

```env
# Server
PORT=3000
FV_STORAGE_LIMIT=5gb
FV_FILE_LIMIT=200mb
FV_SITE_PASSWORD=          # ล็อกทั้งเว็บด้วย password (ไม่บังคับ)
FV_SHUTDOWN_TOKEN=         # token สำหรับ /api/shutdown

# PostgreSQL
DATABASE_URL=              # postgresql://user:pass@host:5432/db
DB_SSL=auto                # auto | true | false
DB_POOL_MAX=10

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=             # https://pub-xxx.r2.dev (ถ้าเปิด public bucket)
FV_DEFAULT_FOLDER=cloud
FV_SERVER_URL=http://localhost:3000
```

---

## 📜 License

MIT — ดูรายละเอียดใน [LICENSE](LICENSE)
