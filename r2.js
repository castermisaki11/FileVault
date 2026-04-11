// ── Cloudflare R2 Module ──
// ใช้ AWS SDK v3 (S3-compatible) เชื่อมต่อ R2
// ติดตั้ง: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload }       = require('@aws-sdk/lib-storage');

// ── Config ──
const R2_CONFIG = {
  ACCOUNT_ID:       process.env.R2_ACCOUNT_ID       || '',
  ACCESS_KEY_ID:    process.env.R2_ACCESS_KEY_ID     || '',
  SECRET_ACCESS_KEY:process.env.R2_SECRET_ACCESS_KEY || '',
  BUCKET:           process.env.R2_BUCKET            || '',
  PUBLIC_URL:       process.env.R2_PUBLIC_URL        || '', // optional custom domain
};

function validateConfig() {
  const missing = ['ACCOUNT_ID','ACCESS_KEY_ID','SECRET_ACCESS_KEY','BUCKET']
    .filter(k => !R2_CONFIG[k]);
  if (missing.length) throw new Error(`R2 config ขาด: ${missing.map(k=>'R2_'+k).join(', ')}`);
}

function createClient() {
  validateConfig();
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_CONFIG.ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     R2_CONFIG.ACCESS_KEY_ID,
      secretAccessKey: R2_CONFIG.SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,  // เพิ่มบรรทัดนี้
  });
}

// lazy singleton
let _client = null;
function getClient() {
  if (!_client) _client = createClient();
  return _client;
}

// ── Helpers ──
function getPublicUrl(key) {
  if (R2_CONFIG.PUBLIC_URL) return `${R2_CONFIG.PUBLIC_URL.replace(/\/$/,'')}/${key}`;
  return null;
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end',  () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ── Operations ──

/** List objects in bucket (prefix = folder path) */
async function listObjects(prefix = '', maxKeys = 1000) {
  const client = getClient();
  const params = {
    Bucket: R2_CONFIG.BUCKET,
    MaxKeys: maxKeys,
    Delimiter: '/',
  };
  if (prefix) params.Prefix = prefix.replace(/^\//,'').replace(/([^/])$/,'$1/');

  const result = await client.send(new ListObjectsV2Command(params));
  const files   = (result.Contents || []).map(o => ({
    key:      o.Key,
    name:     o.Key.split('/').pop(),
    size:     o.Size,
    modified: o.LastModified,
    etag:     o.ETag?.replace(/"/g,''),
    isDir:    false,
    publicUrl: getPublicUrl(o.Key),
  }));
  const folders = (result.CommonPrefixes || []).map(p => ({
    key:   p.Prefix,
    name:  p.Prefix.split('/').filter(Boolean).pop(),
    isDir: true,
  }));
  return { files, folders, prefix: prefix||'', truncated: result.IsTruncated };
}

/** Search objects by name (scans entire bucket — use carefully on large buckets) */
async function searchObjects(query) {
  const client = getClient();
  const q = query.toLowerCase().trim();
  let token, results = [];
  do {
    const params = { Bucket: R2_CONFIG.BUCKET, MaxKeys: 1000 };
    if (token) params.ContinuationToken = token;
    const res = await client.send(new ListObjectsV2Command(params));
    for (const o of res.Contents || []) {
      const name = o.Key.split('/').pop();
      if (name.toLowerCase().includes(q)) {
        results.push({
          key:      o.Key,
          name,
          size:     o.Size,
          modified: o.LastModified,
          folder:   o.Key.includes('/') ? o.Key.substring(0, o.Key.lastIndexOf('/')) : '',
          publicUrl: getPublicUrl(o.Key),
        });
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : null;
  } while (token);
  return results;
}

// ── MIME type map (fallback จาก extension) ──
const MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif',  webp: 'image/webp', bmp: 'image/bmp',
  tiff: 'image/tiff', tif: 'image/tiff', svg: 'image/svg+xml',
  avif: 'image/avif', heic: 'image/heic', ico: 'image/x-icon',
  mp4: 'video/mp4',  mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav',  ogg: 'audio/ogg',
  pdf: 'application/pdf', zip: 'application/zip',
  json: 'application/json', txt: 'text/plain',
  html: 'text/html', css: 'text/css', js: 'text/javascript',
};

function guessMime(key, fallback = 'application/octet-stream') {
  const ext = key.split('.').pop().toLowerCase();
  return MIME_MAP[ext] || fallback;
}

/** Upload a file (Buffer or Stream) */
async function uploadObject(key, body, contentType, metadata = {}) {
  const client = getClient();
  // ถ้า contentType เป็น octet-stream หรือไม่มี ให้ guess จาก extension
  const resolvedType = (!contentType || contentType === 'application/octet-stream')
    ? guessMime(key, 'application/octet-stream')
    : contentType;
  const upload = new Upload({
    client,
    params: {
      Bucket:      R2_CONFIG.BUCKET,
      Key:         key,
      Body:        body,
      ContentType: resolvedType,
      Metadata:    metadata,
    },
  });
  const result = await upload.done();
  return { key, etag: result.ETag?.replace(/"/g,''), publicUrl: getPublicUrl(key) };
}

/** Download object — returns { buffer, contentType, contentLength, metadata } */
async function downloadObject(key) {
  const client = getClient();
  const res = await client.send(new GetObjectCommand({ Bucket: R2_CONFIG.BUCKET, Key: key }));
  const buffer = await streamToBuffer(res.Body);
  return {
    buffer,
    contentType:   res.ContentType,
    contentLength: res.ContentLength,
    metadata:      res.Metadata || {},
    lastModified:  res.LastModified,
  };
}

/** Get object metadata only (no download) */
async function headObject(key) {
  const client = getClient();
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: R2_CONFIG.BUCKET, Key: key }));
    return { exists: true, contentType: res.ContentType, size: res.ContentLength, modified: res.LastModified, metadata: res.Metadata || {} };
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return { exists: false };
    throw e;
  }
}

/** Delete object */
async function deleteObject(key) {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: R2_CONFIG.BUCKET, Key: key }));
  return { key };
}

/** Copy object (move = copy + delete) */
async function copyObject(sourceKey, destKey, deleteSource = false) {
  const client = getClient();
  await client.send(new CopyObjectCommand({
    Bucket:     R2_CONFIG.BUCKET,
    CopySource: `${R2_CONFIG.BUCKET}/${sourceKey}`,
    Key:        destKey,
  }));
  if (deleteSource) await deleteObject(sourceKey);
  return { sourceKey, destKey };
}

/** Generate presigned URL for upload (PUT) */
async function presignUpload(key, expiresIn = 3600, contentType) {
  const client = getClient();
  const params = { Bucket: R2_CONFIG.BUCKET, Key: key };
  if (contentType) params.ContentType = contentType;
  const url = await getSignedUrl(client, new PutObjectCommand(params), { expiresIn });
  return { url, key, expiresIn };
}

/** Generate presigned URL for download (GET) */
async function presignDownload(key, expiresIn = 3600) {
  const client = getClient();
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: R2_CONFIG.BUCKET, Key: key }), { expiresIn });
  return { url, key, expiresIn };
}

module.exports = {
  R2_CONFIG,
  guessMime,
  listObjects,
  searchObjects,
  uploadObject,
  downloadObject,
  headObject,
  deleteObject,
  copyObject,
  presignUpload,
  presignDownload,
};
