require('dotenv').config();
console.log('ENV CHECK:', {
  account: process.env.R2_ACCOUNT_ID ? 'ok' : 'missing',
  key: process.env.R2_ACCESS_KEY_ID ? 'ok' : 'missing',
  secret: process.env.R2_SECRET_ACCESS_KEY ? 'ok' : 'missing',
  bucket: process.env.R2_BUCKET ? 'ok' : 'missing',
});
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const cors    = require('cors');
const os      = require('os');
const http    = require('http');
const { execSync } = require('child_process');


// ── R2 Module ──
const r2 = require('./r2');

const CONFIG = {
  PORT:            process.env.FV_PORT          || 3000,
  STORAGE_LIMIT:   process.env.FV_STORAGE_LIMIT || '5gb',
  FILE_SIZE_LIMIT: process.env.FV_FILE_LIMIT    || '200mb',
  STATUS_INTERVAL: process.env.FV_STATUS_MS     || 5000,
};

function parseSize(str) {
  if (!str || str === '0') return 0;
  const s = String(str).trim().toLowerCase(), n = parseFloat(s);
  if (s.endsWith('pb')) return Math.floor(n * 1024**5);
  if (s.endsWith('tb')) return Math.floor(n * 1024**4);
  if (s.endsWith('gb')) return Math.floor(n * 1024**3);
  if (s.endsWith('mb')) return Math.floor(n * 1024**2);
  if (s.endsWith('kb')) return Math.floor(n * 1024);
  return Math.floor(n);
}
function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024)      return bytes + ' B';
  if (bytes < 1024**2)   return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1024**3)   return (bytes/1024**2).toFixed(2) + ' MB';
  if (bytes < 1024**4)   return (bytes/1024**3).toFixed(2) + ' GB';
  if (bytes < 1024**5)   return (bytes/1024**4).toFixed(2) + ' TB';
  return (bytes/1024**5).toFixed(2) + ' PB';
}

const STORAGE_LIMIT_BYTES = parseSize(CONFIG.STORAGE_LIMIT);
const FILE_SIZE_BYTES     = parseSize(CONFIG.FILE_SIZE_LIMIT);

const app        = express();
const PORT       = CONFIG.PORT;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR   = path.join(__dirname, 'data');
const DUMP_DIR   = path.join(__dirname, 'dumps');
[UPLOAD_DIR, DATA_DIR, DUMP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Folder helpers ──
function safeFolderPath(folder) {
  if (!folder || folder === '/' || folder === '.') return UPLOAD_DIR;
  const clean = folder.replace(/\.\./g,'').replace(/[^a-zA-Z0-9_\-ก-๙/]/g,'_').replace(/\/+/g,'/').replace(/^\//,'');
  const full  = path.join(UPLOAD_DIR, clean);
  if (full !== UPLOAD_DIR && !full.startsWith(UPLOAD_DIR + path.sep)) return UPLOAD_DIR;
  return full;
}
function ensureFolder(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function getDirStats(dir) {
  let fileCount = 0, size = 0;
  try { for (const e of fs.readdirSync(dir,{withFileTypes:true})) if (!e.isDirectory()) { fileCount++; try { size += fs.statSync(path.join(dir,e.name)).size; } catch {} } } catch {}
  return { fileCount, size };
}
function getFolderList(dir = UPLOAD_DIR, base = '') {
  const results = [];
  try {
    for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
      if (e.isDirectory()) {
        const rel = base ? base+'/'+e.name : e.name;
        const fp  = path.join(dir, e.name);
        results.push({ path: rel, name: e.name, ...getDirStats(fp) });
        results.push(...getFolderList(fp, rel));
      }
    }
  } catch {}
  return results;
}
function getDirSizeRecursive(dir) {
  let total = 0;
  try { for (const e of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if (e.isDirectory()) total+=getDirSizeRecursive(p); else try{total+=fs.statSync(p).size;}catch{} } } catch {}
  return total;
}

// ── Data / Stats ──
const dataFile  = n => path.join(DATA_DIR, n+'.json');
const readData  = (n,d) => { try { return JSON.parse(fs.readFileSync(dataFile(n),'utf8')); } catch { return d; } };
const writeData = (n,v) => fs.writeFileSync(dataFile(n), JSON.stringify(v,null,2));
let stats = readData('stats', { requests:0, uploads:0, downloads:0, deletes:0, errors:0, moves:0, r2_uploads:0, r2_downloads:0, r2_deletes:0 });
setInterval(() => writeData('stats', stats), 10_000);

// ── Storage ──
function getUploadDirSize() { return getDirSizeRecursive(UPLOAD_DIR); }
function getStorageInfo() {
  const used=getUploadDirSize(), limit=STORAGE_LIMIT_BYTES, unlimited=limit===0;
  const free=unlimited?null:Math.max(0,limit-used), pct=unlimited?null:Math.min(100,(used/limit)*100);
  let diskFree=null; try{const s=fs.statfsSync?.(UPLOAD_DIR); if(s) diskFree=s.bfree*s.bsize;}catch{}
  return { used, limit, unlimited, free, pct, diskFree };
}

// ── Archive ──
let isShuttingDown = false;
function archiveAndShutdown(server) {
  if (isShuttingDown) return; isShuttingDown = true;
  const ts=new Date().toISOString().replace(/[:.]/g,'-');
  try { execSync(`zip -r "${path.join(DUMP_DIR,'filevault-dump-'+ts+'.zip')}" "${UPLOAD_DIR}"`,{stdio:'pipe'}); } catch {
    try { execSync(`tar -czf "${path.join(DUMP_DIR,'filevault-dump-'+ts+'.tar.gz')}" -C "${UPLOAD_DIR}" .`,{stdio:'pipe'}); } catch {}
  }
  server.close(() => { writeData('stats', stats); process.exit(0); });
  setTimeout(() => process.exit(0), 5000);
}

// ── Multer ──
const storage = multer.diskStorage({
  destination: (req,file,cb) => { const d=safeFolderPath(req.query.folder||''); ensureFolder(d); cb(null,d); },
  filename: (req,file,cb) => {
    const dir=safeFolderPath(req.query.folder||'');
    const safe=file.originalname.replace(/[^a-zA-Z0-9._\-ก-๙]/g,'_');
    if (fs.existsSync(path.join(dir,safe))) { const e=path.extname(safe),b=path.basename(safe,e); cb(null,`${b}_${Date.now()}${e}`); }
    else cb(null,safe);
  }
});
const memStorage = multer.memoryStorage();
function checkStorageLimit(req,res,next) {
  if (!STORAGE_LIMIT_BYTES) return next();
  const used=getUploadDirSize();
  if (used>=STORAGE_LIMIT_BYTES) { res.status(507).json({ok:false,error:`พื้นที่เต็ม! ${formatSize(used)}/${formatSize(STORAGE_LIMIT_BYTES)}`,storage:getStorageInfo()}); setImmediate(()=>archiveAndShutdown(req.app.get('server'))); return; }
  next();
}
const upload    = multer({ storage,    limits: { fileSize: FILE_SIZE_BYTES||undefined } });
const uploadMem = multer({ storage: memStorage, limits: { fileSize: FILE_SIZE_BYTES||undefined } });

// ── Network ──
function getLocalIP() {
  for (const nets of Object.values(os.networkInterfaces())) for (const n of nets) if (n.family==='IPv4'&&!n.internal) return n.address;
  return 'localhost';
}

// ── Middleware ──
app.use(cors()); app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));
app.use((req,res,next)=>{ stats.requests++; next(); });

// ── Colors ──
const RESET='\x1b[0m',BOLD='\x1b[1m',GREEN='\x1b[32m',YELLOW='\x1b[33m',RED='\x1b[31m',CYAN='\x1b[36m',GRAY='\x1b[90m';
function makeBar(pct,w=20){const f=Math.round(pct/100*w),c=pct>=90?RED:pct>=70?YELLOW:GREEN;return c+'█'.repeat(f)+GRAY+'░'.repeat(w-f)+RESET;}

// ── Status ──
let statusLineCount=0;
function printStatus() {
  if (isShuttingDown) return;
  const info=getStorageInfo(), up=process.uptime(), pad=n=>String(Math.floor(n)).padStart(2,'0');
  const uptStr=`${pad(up/3600)}:${pad((up%3600)/60)}:${pad(up%60)}`, memMB=(process.memoryUsage().rss/1024**2).toFixed(1);
  let fc=0; const cf=d=>{try{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory())cf(path.join(d,e.name));else fc++;}}catch{}};cf(UPLOAD_DIR);
  const sl = info.unlimited ? `${BOLD}พื้นที่:${RESET} ${formatSize(info.used)}/${CYAN}ไม่จำกัด${RESET}`
    : `${BOLD}พื้นที่:${RESET} [${makeBar(info.pct)}] ${info.pct>=90?RED:info.pct>=70?YELLOW:GREEN}${info.pct.toFixed(1)}%${RESET} ${formatSize(info.used)}/${formatSize(info.limit)} (เหลือ ${formatSize(info.free)})`;
  const r2Line = `${BOLD}R2:${RESET} ↑${stats.r2_uploads||0} ↓${stats.r2_downloads||0} 🗑${stats.r2_deletes||0}`;
  const lines=[
    `  ${sl}`,
    info.diskFree!==null?`  ${GRAY}ดิสก์ว่าง: ${formatSize(info.diskFree)}${RESET}`:null,
    `  ${BOLD}ไฟล์:${RESET} ${fc} ไฟล์  ${BOLD}Uptime:${RESET} ${uptStr}  ${BOLD}Mem:${RESET} ${memMB} MB`,
    `  ${BOLD}Requests:${RESET} ${stats.requests}  ↑${stats.uploads} ↓${stats.downloads} 🗑${stats.deletes}`,
    `  ${r2Line}`,
  ].filter(Boolean);
  if (statusLineCount>0) process.stdout.write(`\x1b[${statusLineCount}A\x1b[0J`);
  process.stdout.write(lines.map(l=>`${l}\n`).join(''));
  statusLineCount=lines.length;
}

// ═══════════════════════════════════════════════
// ── LOCAL ROUTES (เหมือนเดิมทุกอย่าง) ──
// ═══════════════════════════════════════════════

// STATS
app.get('/api/stats',(req,res)=>res.json({ok:true,stats,storage:getStorageInfo()}));
app.post('/api/stats/reset',(req,res)=>{Object.assign(stats,{requests:0,uploads:0,downloads:0,deletes:0,errors:0,moves:0,r2_uploads:0,r2_downloads:0,r2_deletes:0});res.json({ok:true});});

// FOLDERS
app.get('/api/folders',(req,res)=>{
  try{res.json({ok:true,folders:getFolderList()});}catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/folders',(req,res)=>{
  try {
    const name=req.body?.name||req.query.name; if(!name) return res.status(400).json({ok:false,error:'ต้องระบุชื่อ'});
    const fp=safeFolderPath(name); ensureFolder(fp);
    res.json({ok:true,path:path.relative(UPLOAD_DIR,fp)});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.delete('/api/folders', (req,res) => {
  try {
    const name=req.body?.name||req.query.name; if(!name) return res.status(400).json({ok:false,error:'ต้องระบุชื่อ'});
    const fp=safeFolderPath(name); if(fp===UPLOAD_DIR) return res.status(400).json({ok:false,error:'ไม่สามารถลบ root ได้'});
    if(!fs.existsSync(fp)) return res.status(404).json({ok:false,error:'ไม่พบ folder'});
    fs.rmSync(fp,{recursive:true,force:true}); stats.deletes++;
    res.json({ok:true});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// FILES LIST
app.get('/api/files', (req,res) => {
  try {
    const folder=req.query.folder||'', dir=safeFolderPath(folder);
    if(!fs.existsSync(dir)) return res.status(404).json({ok:false,error:'ไม่พบ folder'});
    const items=fs.readdirSync(dir,{withFileTypes:true}).map(e=>{
      const fp=path.join(dir,e.name), st=fs.statSync(fp), isDir=e.isDirectory();
      const r={name:e.name,size:st.size,modified:st.mtimeMs,isDir,folder:folder||''};
      if(isDir){const ds=getDirStats(fp);r.fileCount=ds.fileCount;r.dirSize=ds.size;}
      return r;
    });
    res.json({ok:true,files:items,folder:folder||'',storage:getStorageInfo()});
  } catch(e){stats.errors++;res.status(500).json({ok:false,error:e.message});}
});

// SEARCH
app.get('/api/search', (req,res) => {
  try {
    const q=(req.query.q||'').toLowerCase().trim();
    if(!q) return res.json({ok:true,files:[]});
    const results=[];
    const walk=(dir,rel)=>{
      try{for(const e of fs.readdirSync(dir,{withFileTypes:true})){
        const fp=path.join(dir,e.name);
        if(e.isDirectory()) walk(fp,rel?rel+'/'+e.name:e.name);
        else if(e.name.toLowerCase().includes(q)){const st=fs.statSync(fp);results.push({name:e.name,size:st.size,modified:st.mtimeMs,isDir:false,folder:rel});}
      }}catch{}
    };
    walk(UPLOAD_DIR,'');
    res.json({ok:true,files:results,query:q});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// UPLOAD
app.post('/api/upload', checkStorageLimit, upload.array('files'), async (req,res)=>{
  if(!req.files?.length){stats.errors++;return res.status(400).json({ok:false,error:'ไม่มีไฟล์'});}
  if(STORAGE_LIMIT_BYTES>0&&getUploadDirSize()>STORAGE_LIMIT_BYTES){
    req.files.forEach(f=>{try{fs.unlinkSync(f.path);}catch{}});stats.errors++;
    res.status(507).json({ok:false,error:`พื้นที่เกินกำหนด`,storage:getStorageInfo()});
    setImmediate(()=>archiveAndShutdown(req.app.get('server'))); return;
  }
  stats.uploads+=req.files.length;
  const folder = req.query.folder||'';
  for (const f of req.files) {
    try {
      const key = folder ? `${folder}/${f.filename}` : f.filename;
      const buffer = fs.readFileSync(f.path);
      await r2.uploadObject(key, buffer, f.mimetype);
      stats.r2_uploads++;
    } catch(e) { console.error('R2 upload error:', e.message); }
  }
  res.json({ok:true,saved:req.files.map(f=>({name:f.filename,size:f.size})),folder:folder,storage:getStorageInfo()});
});

// MOVE / COPY
app.post('/api/move', (req,res)=>{
  try {
    const{name,fromFolder,toFolder,copy}=req.body;
    if(!name) return res.status(400).json({ok:false,error:'ต้องระบุชื่อไฟล์'});
    const srcDir=safeFolderPath(fromFolder||''), dstDir=safeFolderPath(toFolder||'');
    const src=path.join(srcDir,path.basename(name));
    ensureFolder(dstDir);
    if(!src.startsWith(UPLOAD_DIR)) return res.status(400).json({ok:false,error:'path ไม่ถูกต้อง'});
    if(!fs.existsSync(src)) return res.status(404).json({ok:false,error:'ไม่พบไฟล์'});
    let dstName=path.basename(name), dst=path.join(dstDir,dstName);
    if(fs.existsSync(dst)){const e=path.extname(dstName),b=path.basename(dstName,e);dstName=`${b}_${Date.now()}${e}`;dst=path.join(dstDir,dstName);}
    if(!dst.startsWith(UPLOAD_DIR)) return res.status(400).json({ok:false,error:'destination ไม่ถูกต้อง'});
    if(copy){fs.copyFileSync(src,dst);stats.uploads++;}else{fs.renameSync(src,dst);stats.moves=(stats.moves||0)+1;}
    res.json({ok:true,name:dstName,toFolder:toFolder||''});
  } catch(e){stats.errors++;res.status(500).json({ok:false,error:e.message});}
});

// RENAME FILE
app.patch('/api/rename', (req,res)=>{
  try {
    const{name,newName,folder}=req.body;
    if(!name||!newName) return res.status(400).json({ok:false,error:'ต้องระบุ name และ newName'});
    const dir=safeFolderPath(folder||'');
    const src=path.join(dir,path.basename(name));
    const safe=path.basename(newName).replace(/[^a-zA-Z0-9._\-ก-๙]/g,'_');
    const dst=path.join(dir,safe);
    if(!src.startsWith(UPLOAD_DIR)||!dst.startsWith(UPLOAD_DIR)) return res.status(400).json({ok:false,error:'path ไม่ถูกต้อง'});
    if(!fs.existsSync(src)) return res.status(404).json({ok:false,error:'ไม่พบไฟล์'});
    if(fs.existsSync(dst)) return res.status(409).json({ok:false,error:'มีไฟล์ชื่อนี้อยู่แล้ว'});
    fs.renameSync(src,dst); stats.moves=(stats.moves||0)+1;
    res.json({ok:true,name:safe});
  } catch(e){stats.errors++;res.status(500).json({ok:false,error:e.message});}
});

// DOWNLOAD
app.get('/api/download/:name', async (req,res)=>{
  const folder=req.query.folder||'', name=path.basename(req.params.name);
  const key = folder ? `${folder}/${name}` : name;
  try {
    const obj = await r2.downloadObject(key);
    stats.downloads++; stats.r2_downloads++;
    res.set('Content-Type', obj.contentType||'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    if(obj.contentLength) res.set('Content-Length', obj.contentLength);
    res.send(obj.buffer);
  } catch(e) {
    // fallback ดึงจาก disk ถ้า R2 ไม่มี
    const dir=safeFolderPath(folder), fp=path.join(dir,name);
    if(fs.existsSync(fp)){ stats.downloads++; return res.download(fp); }
    stats.errors++; res.status(404).json({ok:false,error:'ไม่พบไฟล์'});
  }
});

// DUMP
app.get('/api/dump/latest',(req,res)=>{
  try{const files=fs.readdirSync(DUMP_DIR).filter(f=>f.startsWith('filevault-dump-')).map(f=>({name:f,mtime:fs.statSync(path.join(DUMP_DIR,f)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
  if(!files.length) return res.status(404).json({ok:false,error:'ไม่มี dump'});res.download(path.join(DUMP_DIR,files[0].name));}catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.get('/api/dump/list',(req,res)=>{
  try{const files=fs.readdirSync(DUMP_DIR).filter(f=>f.startsWith('filevault-dump-')).map(f=>{const s=fs.statSync(path.join(DUMP_DIR,f));return{name:f,size:s.size,created:s.mtimeMs};}).sort((a,b)=>b.created-a.created);res.json({ok:true,dumps:files});}catch(e){res.status(500).json({ok:false,error:e.message});}
});

// READ / WRITE FILE CONTENT
app.get('/api/files/:name',(req,res)=>{
  const dir=safeFolderPath(req.query.folder||''), fp=path.join(dir,path.basename(req.params.name));
  if(!fp.startsWith(UPLOAD_DIR)) return res.status(400).json({ok:false,error:'path ไม่ถูกต้อง'});
  if(!fs.existsSync(fp)) return res.status(404).json({ok:false,error:'ไม่พบไฟล์'});
  try{res.json({ok:true,content:fs.readFileSync(fp,'utf8')});}catch(e){stats.errors++;res.status(500).json({ok:false,error:e.message});}
});
app.put('/api/files/:name',(req,res)=>{
  const dir=safeFolderPath(req.query.folder||''); ensureFolder(dir);
  const safe=path.basename(req.params.name).replace(/[^a-zA-Z0-9._\-ก-๙]/g,'_'), fp=path.join(dir,safe);
  if(!fp.startsWith(UPLOAD_DIR)) return res.status(400).json({ok:false,error:'path ไม่ถูกต้อง'});
  try{fs.writeFileSync(fp,req.body.content??'','utf8');res.json({ok:true,name:safe});}catch(e){stats.errors++;res.status(500).json({ok:false,error:e.message});}
});

// DELETE FILE
app.delete('/api/delete/:name', async (req,res)=>{
  const folder=req.query.folder||'', name=path.basename(req.params.name);
  const dir=safeFolderPath(folder), fp=path.join(dir,name);
  if(!fp.startsWith(UPLOAD_DIR)){stats.errors++;return res.status(400).json({ok:false,error:'path ไม่ถูกต้อง'});}
  // ลบจาก disk (ถ้ามี)
  if(fs.existsSync(fp)){ try{fs.unlinkSync(fp);}catch{} }
  // ลบจาก R2
  try {
    const key = folder ? `${folder}/${name}` : name;
    await r2.deleteObject(key);
    stats.r2_deletes++;
  } catch(e) { console.error('R2 delete error:', e.message); }
  stats.deletes++; res.json({ok:true,storage:getStorageInfo()});
});

// ═══════════════════════════════════════════════
// ── R2 ROUTES (/api/r2/*) ──
// ═══════════════════════════════════════════════

// GET /api/r2/files?prefix=folder/
//   ดูรายการไฟล์ใน R2 bucket (prefix คือ folder path)
app.get('/api/r2/files', async (req,res) => {
  try {
    const prefix = req.query.prefix || req.query.folder || '';
    const result = await r2.listObjects(prefix);
    res.json({ ok:true, ...result });
  } catch(e) { stats.errors++; res.status(500).json({ ok:false, error:e.message }); }
});

// GET /api/r2/search?q=keyword
//   ค้นหาไฟล์ใน R2 ทั้ง bucket
app.get('/api/r2/search', async (req,res) => {
  try {
    const q = (req.query.q||'').trim();
    if (!q) return res.json({ ok:true, files:[] });
    const files = await r2.searchObjects(q);
    res.json({ ok:true, files, query:q });
  } catch(e) { stats.errors++; res.status(500).json({ ok:false, error:e.message }); }
});

// POST /api/r2/upload?prefix=folder/
//   อัปโหลดไฟล์ขึ้น R2 (multipart, field name = "files")
app.post('/api/r2/upload', uploadMem.array('files'), async (req,res) => {
  if (!req.files?.length) return res.status(400).json({ ok:false, error:'ไม่มีไฟล์' });
  try {
    const prefix = (req.query.prefix||req.query.folder||'').replace(/^\//,'');
    const saved = [];
    for (const f of req.files) {
      const key = prefix ? `${prefix}/${f.originalname}` : f.originalname;
      const result = await r2.uploadObject(key, f.buffer, f.mimetype);
      saved.push({ name:f.originalname, key:result.key, size:f.size, publicUrl:result.publicUrl });
      stats.r2_uploads++;
    }
    res.json({ ok:true, saved, prefix:prefix||'' });
  } catch(e) { stats.errors++; res.status(500).json({ ok:false, error:e.message }); }
});

// GET /api/r2/download/:key (key อาจมี / ได้ ใช้ wildcard)
//   ดาวน์โหลดไฟล์จาก R2 ผ่าน server
app.get('/api/r2/download/*', async (req,res) => {
  const key = req.params[0];
  if (!key) return res.status(400).json({ ok:false, error:'ต้องระบุ key' });
  try {
    const obj = await r2.downloadObject(key);
    stats.r2_downloads++;
    res.set('Content-Type', obj.contentType || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${path.basename(key)}"`);
    if (obj.contentLength) res.set('Content-Length', obj.contentLength);
    res.send(obj.buffer);
  } catch(e) {
    stats.errors++;
    const code = e.$metadata?.httpStatusCode;
    res.status(code===404?404:500).json({ ok:false, error: code===404?'ไม่พบไฟล์':e.message });
  }
});

// DELETE /api/r2/delete/*
//   ลบไฟล์จาก R2
app.delete('/api/r2/delete/*', async (req,res) => {
  const key = req.params[0];
  if (!key) return res.status(400).json({ ok:false, error:'ต้องระบุ key' });
  try {
    await r2.deleteObject(key);
    stats.r2_deletes++;
    res.json({ ok:true, key });
  } catch(e) { stats.errors++; res.status(500).json({ ok:false, error:e.message }); }
});

// POST /api/r2/move
//   ย้าย/คัดลอกไฟล์ใน R2
//   body: { sourceKey, destKey, copy? }
app.post('/api/r2/move', async (req,res) => {
  try {
    const { sourceKey, destKey, copy=false } = req.body;
    if (!sourceKey||!destKey) return res.status(400).json({ ok:false, error:'ต้องระบุ sourceKey และ destKey' });
    const result = await r2.copyObject(sourceKey, destKey, !copy);
    if (!copy) stats.r2_deletes++;
    stats.r2_uploads++;
    res.json({ ok:true, ...result, action: copy?'copy':'move' });
  } catch(e) { stats.errors++; res.status(500).json({ ok:false, error:e.message }); }
});

// GET /api/r2/head/*
//   ดู metadata ของไฟล์ใน R2 โดยไม่ดาวน์โหลด
app.get('/api/r2/head/*', async (req,res) => {
  const key = req.params[0];
  if (!key) return res.status(400).json({ ok:false, error:'ต้องระบุ key' });
  try {
    const info = await r2.headObject(key);
    if (!info.exists) return res.status(404).json({ ok:false, error:'ไม่พบไฟล์' });
    res.json({ ok:true, key, ...info });
  } catch(e) { stats.errors++; res.status(500).json({ ok:false, error:e.message }); }
});

// POST /api/r2/presign/upload
//   สร้าง presigned URL สำหรับอัปโหลดตรงจาก browser
//   body: { key, expiresIn?, contentType? }
app.post('/api/r2/presign/upload', async (req,res) => {
  try {
    const { key, expiresIn=3600, contentType } = req.body;
    if (!key) return res.status(400).json({ ok:false, error:'ต้องระบุ key' });
    const result = await r2.presignUpload(key, expiresIn, contentType);
    res.json({ ok:true, ...result });
  } catch(e) { stats.errors++; res.status(500).json({ ok:false, error:e.message }); }
});

// POST /api/r2/presign/download
//   สร้าง presigned URL สำหรับดาวน์โหลดตรงจาก browser
//   body: { key, expiresIn? }
app.post('/api/r2/presign/download', async (req,res) => {
  try {
    const { key, expiresIn=3600 } = req.body;
    if (!key) return res.status(400).json({ ok:false, error:'ต้องระบุ key' });
    const result = await r2.presignDownload(key, expiresIn);
    res.json({ ok:true, ...result });
  } catch(e) { stats.errors++; res.status(500).json({ ok:false, error:e.message }); }
});

// GET /api/r2/status
//   ตรวจสอบสถานะ R2 config
app.get('/api/r2/status', (req,res) => {
  const cfg = r2.R2_CONFIG;
  const configured = !!(cfg.ACCOUNT_ID && cfg.ACCESS_KEY_ID && cfg.SECRET_ACCESS_KEY && cfg.BUCKET);
  res.json({
    ok: configured,
    configured,
    bucket:    cfg.BUCKET     || null,
    accountId: cfg.ACCOUNT_ID ? cfg.ACCOUNT_ID.slice(0,6)+'...' : null,
    publicUrl: cfg.PUBLIC_URL || null,
    stats: { uploads:stats.r2_uploads||0, downloads:stats.r2_downloads||0, deletes:stats.r2_deletes||0 },
  });
});

// ── Error handler ──
app.use((err,req,res,next)=>{
  stats.errors++;
  if(err.code==='LIMIT_FILE_SIZE') return res.status(413).json({ok:false,error:`ไฟล์ใหญ่เกิน (สูงสุด ${formatSize(FILE_SIZE_BYTES)})`});
  res.status(500).json({ok:false,error:err.message});
});

// ── Start ──
const ip=getLocalIP(), httpServer=http.createServer(app);
app.set('server',httpServer);
httpServer.listen(PORT,'0.0.0.0',()=>{
  const info=getStorageInfo();
  console.log(`\n${BOLD}${CYAN}  ☁  FileVault Server${RESET}`);
  console.log(`${GRAY}  
  ─────────────────────────────────────${RESET}`);
  console.log(`  ${BOLD}Local  :${RESET}  http://localhost:${PORT}`);
  console.log(`  ${BOLD}Network:${RESET}  ${GREEN}http://${ip}:${PORT}${RESET}`);
  console.log(`${GRAY}  ─────────────────────────────────────${RESET}`);
  console.log(`  ${BOLD}Storage:${RESET} ${CYAN}${info.unlimited?'ไม่จำกัด':formatSize(info.limit)}${RESET}  Per-file: ${CYAN}${FILE_SIZE_BYTES?formatSize(FILE_SIZE_BYTES):'ไม่จำกัด'}${RESET}`);
  const r2ok = !!(r2.R2_CONFIG.ACCOUNT_ID && r2.R2_CONFIG.BUCKET);
  console.log(`  ${BOLD}R2     :${RESET} ${r2ok ? GREEN+'✓ '+r2.R2_CONFIG.BUCKET : RED+'✗ ยังไม่ได้ตั้งค่า env'}${RESET}`);
  console.log(`${GRAY}  ─────────────────────────────────────${RESET}`);
  console.log(`\n  ${GRAY}[Ctrl+C เพื่อหยุด]${RESET}\n`);
  console.log(process.env.R2_BUCKET);
  if(CONFIG.STATUS_INTERVAL>0){printStatus();setInterval(printStatus,CONFIG.STATUS_INTERVAL);}
});
