# FileVault v2.0

## ติดตั้งและใช้งาน

```bash

npm install express --no-bin-links
npm install
node server.js

cd ~/filevault-server

node server.js

nano ~/.bashrc

pkill node
```
## โครงสร้าง

```
filevault/
├── server.js          # Express server + API
├── package.json
├── public/
│   ├── index.html     # UI หลัก
│   ├── styles.css     # iPhone-style CSS
│   └── app.js         # Frontend logic
├── uploads/           # ไฟล์ที่อัปโหลด (auto-created)
```
