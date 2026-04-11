/**
 * migrate-to-cloud.js
 * ย้ายไฟล์ทั้งหมดใน R2 bucket ที่ยังไม่ได้อยู่ใน upload/cloud/ → upload/cloud/
 *
 * วิธีใช้:
 *   node migrate-to-cloud.js          → dry-run (ดูรายการก่อน ไม่ย้ายจริง)
 *   node migrate-to-cloud.js --run    → ย้ายจริง
 *   node migrate-to-cloud.js --run --folder=photos  → ย้ายเฉพาะ folder นี้
 */

require('dotenv').config();

const {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

// ── Config ──
const CFG = {
  ACCOUNT_ID:        process.env.R2_ACCOUNT_ID        || '',
  ACCESS_KEY_ID:     process.env.R2_ACCESS_KEY_ID      || '',
  SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY  || '',
  BUCKET:            process.env.R2_BUCKET             || '',
};

const TARGET_PREFIX = 'cloud/';

// ── Parse args ──
const args    = process.argv.slice(2);
const DRY_RUN = !args.includes('--run');
const folderArg = (args.find(a => a.startsWith('--folder=')) || '').replace('--folder=', '');

// ── Client ──
const client = new S3Client({
  region:   'auto',
  endpoint: `https://${CFG.ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: CFG.ACCESS_KEY_ID, secretAccessKey: CFG.SECRET_ACCESS_KEY },
  forcePathStyle: true,
});

// ── Helpers ──
const clr = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m',  gray: '\x1b[90m',
};
const log  = (...a) => console.log(...a);
const ok   = s => log(`  ${clr.green}✓${clr.reset} ${s}`);
const skip = s => log(`  ${clr.gray}– ${s}${clr.reset}`);
const warn = s => log(`  ${clr.yellow}⚠ ${s}${clr.reset}`);
const err  = s => log(`  ${clr.red}✗ ${s}${clr.reset}`);

async function listAll(prefix = '') {
  let token, items = [];
  do {
    const params = { Bucket: CFG.BUCKET, MaxKeys: 1000 };
    if (prefix)  params.Prefix = prefix;
    if (token)   params.ContinuationToken = token;
    const res = await client.send(new ListObjectsV2Command(params));
    items.push(...(res.Contents || []));
    token = res.IsTruncated ? res.NextContinuationToken : null;
  } while (token);
  return items;
}

async function copyObject(src, dst) {
  await client.send(new CopyObjectCommand({
    Bucket:     CFG.BUCKET,
    CopySource: `${CFG.BUCKET}/${src}`,
    Key:        dst,
  }));
}

async function deleteObject(key) {
  await client.send(new DeleteObjectCommand({ Bucket: CFG.BUCKET, Key: key }));
}

// ── Main ──
async function main() {
  // Validate config
  const missing = ['ACCOUNT_ID','ACCESS_KEY_ID','SECRET_ACCESS_KEY','BUCKET'].filter(k => !CFG[k]);
  if (missing.length) {
    err(`ขาด env: ${missing.map(k => 'R2_' + k).join(', ')}`);
    process.exit(1);
  }

  log(`\n${clr.bold}${clr.cyan}  ☁  FileVault — Migrate to upload/cloud${clr.reset}`);
  log(`${clr.gray}  ─────────────────────────────────────────${clr.reset}`);
  log(`  Bucket : ${clr.cyan}${CFG.BUCKET}${clr.reset}`);
  log(`  Target : ${clr.cyan}${TARGET_PREFIX}${clr.reset}`);
  if (folderArg) log(`  Filter : ${clr.yellow}${folderArg}/${clr.reset}`);
  log(`  Mode   : ${DRY_RUN ? clr.yellow + 'DRY RUN (ดูอย่างเดียว)' : clr.green + 'LIVE (ย้ายจริง)'}${clr.reset}`);
  log(`${clr.gray}  ─────────────────────────────────────────${clr.reset}\n`);

  if (DRY_RUN) {
    log(`${clr.yellow}  ℹ  เพิ่ม --run เพื่อย้ายจริง${clr.reset}\n`);
  }

  // List all files
  const prefix = folderArg ? folderArg.replace(/\/?$/, '/') : '';
  const allItems = await listAll(prefix);

  // Filter: เอาเฉพาะที่ยังไม่ได้อยู่ใน upload/cloud/
  const toMove = allItems.filter(item => {
    const key = item.Key;
    // skip .keep files (folder markers)
    if (key.endsWith('/.keep') || key === '.keep') return false;
    // skip ถ้าอยู่ใน upload/cloud/ แล้ว
    if (key.startsWith(TARGET_PREFIX)) return false;
    // skip ถ้าเป็น folder marker (size 0 + ends with /)
    if (key.endsWith('/') && item.Size === 0) return false;
    return true;
  });

  const alreadyInTarget = allItems.filter(i => i.Key.startsWith(TARGET_PREFIX) && !i.Key.endsWith('/'));

  log(`  ${clr.bold}รวมทั้งหมดใน bucket:${clr.reset} ${allItems.length} objects`);
  log(`  ${clr.bold}อยู่ใน upload/cloud แล้ว:${clr.reset} ${clr.green}${alreadyInTarget.length}${clr.reset}`);
  log(`  ${clr.bold}ต้องย้าย:${clr.reset} ${clr.yellow}${toMove.length}${clr.reset}\n`);

  if (!toMove.length) {
    log(`${clr.green}  ✓ ไม่มีไฟล์ที่ต้องย้าย${clr.reset}\n`);
    return;
  }

  // Preview list
  log(`  ${clr.bold}รายการที่จะย้าย:${clr.reset}`);
  toMove.forEach(item => {
    const filename = item.Key.split('/').pop();
    const dst = TARGET_PREFIX + filename;
    log(`    ${clr.gray}${item.Key}${clr.reset}  →  ${clr.cyan}${dst}${clr.reset}`);
  });
  log('');

  if (DRY_RUN) {
    log(`${clr.yellow}  ℹ  Dry-run เสร็จ ใช้ --run เพื่อย้ายจริง${clr.reset}\n`);
    return;
  }

  // ── Execute ──
  log(`  ${clr.bold}กำลังย้าย...${clr.reset}\n`);
  let moved = 0, failed = 0, skipped = 0;

  for (const item of toMove) {
    const srcKey  = item.Key;
    const filename = srcKey.split('/').pop();
    if (!filename) { skip(`ข้ามเพราะชื่อว่าง: ${srcKey}`); skipped++; continue; }

    const dstKey = TARGET_PREFIX + filename;

    // ถ้า dest มีอยู่แล้ว ให้ใส่ timestamp
    let finalDst = dstKey;
    const ext  = filename.includes('.') ? '.' + filename.split('.').pop() : '';
    const base = ext ? filename.slice(0, -ext.length) : filename;

    try {
      // copy
      await copyObject(srcKey, finalDst);
      // delete source
      await deleteObject(srcKey);
      ok(`${srcKey}  →  ${finalDst}`);
      moved++;
    } catch (e) {
      // ถ้า copy ล้มเหลวเพราะ dest ซ้ำ ลอง rename
      if (e.message?.includes('already exists') || e.$metadata?.httpStatusCode === 409) {
        finalDst = TARGET_PREFIX + base + '_' + Date.now() + ext;
        try {
          await copyObject(srcKey, finalDst);
          await deleteObject(srcKey);
          ok(`${srcKey}  →  ${finalDst} (renamed)`);
          moved++;
        } catch (e2) {
          err(`${srcKey} : ${e2.message}`);
          failed++;
        }
      } else {
        err(`${srcKey} : ${e.message}`);
        failed++;
      }
    }
  }

  log('');
  log(`${clr.gray}  ─────────────────────────────────────────${clr.reset}`);
  log(`  ${clr.green}✓ ย้ายสำเร็จ : ${moved}${clr.reset}`);
  if (skipped) log(`  ${clr.gray}– ข้าม       : ${skipped}${clr.reset}`);
  if (failed)  log(`  ${clr.red}✗ ล้มเหลว    : ${failed}${clr.reset}`);
  log(`${clr.gray}  ─────────────────────────────────────────${clr.reset}\n`);

  if (failed) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
