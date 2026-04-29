require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const crypto = require('crypto');
const { getPool } = require('./db');

// ── Config ─────────────────────────────────────────────────────────────────
const JWT_SECRET         = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS       = parseInt(process.env.SESSION_DAYS       || '30', 10);
const MAX_SESSIONS       = parseInt(process.env.MAX_SESSIONS       || '10', 10); // per user
const LOGIN_MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5',  10);
const LOGIN_LOCKOUT_MIN  = parseInt(process.env.LOGIN_LOCKOUT_MIN  || '15', 10);

// ── Password hashing (pbkdf2 — no extra deps) ───────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const inputHash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(inputHash, 'hex'));
  } catch { return false; }
}

// ── Password strength validation ─────────────────────────────────────────────
function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') return 'รหัสผ่านไม่ถูกต้อง';
  if (password.length < 8)   return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
  if (password.length > 128) return 'รหัสผ่านยาวเกินไป';
  return null; // valid
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return 'กรุณาระบุ username';
  const u = username.trim();
  if (u.length < 3 || u.length > 30)   return 'username ต้องมี 3–30 ตัวอักษร';
  if (!/^[a-zA-Z0-9_.\-]+$/.test(u))   return 'username ใช้ได้เฉพาะ a-z, 0-9, _, -, .';
  return null;
}

function validateEmail(email) {
  if (!email || typeof email !== 'string') return 'กรุณาระบุ email';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'รูปแบบ email ไม่ถูกต้อง';
  return null;
}

// ── JWT (no dep) ────────────────────────────────────────────────────────────
function b64url(str) { return Buffer.from(str).toString('base64url'); }

function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig    = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const parts = token?.split('.');
    if (parts?.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch { return null; }
}

// ── Schema Migrations ────────────────────────────────────────────────────────
const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL    PRIMARY KEY,
  username       TEXT         NOT NULL UNIQUE,
  email          TEXT         NOT NULL UNIQUE,
  password       TEXT         NOT NULL,
  role           TEXT         NOT NULL DEFAULT 'user',
  display_name   TEXT,
  avatar_emoji   TEXT         NOT NULL DEFAULT '🙂',
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

CREATE TABLE IF NOT EXISTS user_sessions (
  token         TEXT         PRIMARY KEY,
  user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGSERIAL   PRIMARY KEY,
  identifier TEXT        NOT NULL,
  ip         TEXT,
  success    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts (identifier, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip         ON login_attempts (ip, created_at);
`;

// Additive migrations for upgrading existing installs
const ADDITIVE_MIGRATIONS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
  `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
];

async function runAuthMigrations() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(AUTH_SCHEMA);
    for (const sql of ADDITIVE_MIGRATIONS) {
      await p.query(sql).catch(() => {}); // ignore if column already exists
    }
    console.log('✅ [auth] Migration สำเร็จ — ตาราง users, user_sessions, login_attempts ready');
    return true;
  } catch (err) {
    console.error('❌ [auth] Migration ล้มเหลว:', err.message);
    return false;
  }
}

// ── In-memory fallback ──────────────────────────────────────────────────────
const _memUsers    = new Map(); // email → user
const _memSessions = new Map(); // token → session object
const _memAttempts = [];        // { identifier, ip, success, createdAt }
let   _memIdSeq    = 1;

// ── Rate limiting / brute-force protection ───────────────────────────────────
async function recordLoginAttempt(identifier, ip, success) {
  const pool = getPool();
  if (pool) {
    await pool.query(
      'INSERT INTO login_attempts (identifier, ip, success) VALUES ($1, $2, $3)',
      [identifier?.toLowerCase().trim(), ip || null, success]
    ).catch(() => {});
  } else {
    _memAttempts.push({ identifier: identifier?.toLowerCase().trim(), ip, success, createdAt: new Date() });
    if (_memAttempts.length > 1000) _memAttempts.splice(0, _memAttempts.length - 1000);
  }
}

async function checkLoginRateLimit(identifier, ip) {
  const windowMs  = LOGIN_LOCKOUT_MIN * 60 * 1000;
  const windowAgo = new Date(Date.now() - windowMs);
  const pool      = getPool();

  let identifierFails = 0;
  let ipFails         = 0;

  if (pool) {
    const [idRes, ipRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM login_attempts
         WHERE identifier = $1 AND success = FALSE AND created_at > $2`,
        [identifier?.toLowerCase().trim(), windowAgo]
      ),
      pool.query(
        `SELECT COUNT(*) FROM login_attempts
         WHERE ip = $1 AND success = FALSE AND created_at > $2`,
        [ip, windowAgo]
      ),
    ]);
    identifierFails = parseInt(idRes.rows[0].count, 10);
    ipFails         = parseInt(ipRes.rows[0].count, 10);
  } else {
    const now  = new Date();
    const norm = identifier?.toLowerCase().trim();
    for (const a of _memAttempts) {
      if (a.success || (now - a.createdAt) > windowMs) continue;
      if (a.identifier === norm) identifierFails++;
      if (a.ip === ip)           ipFails++;
    }
  }

  if (identifierFails >= LOGIN_MAX_ATTEMPTS || ipFails >= LOGIN_MAX_ATTEMPTS) {
    return { locked: true, attemptsLeft: 0, retryAfterMs: windowMs };
  }
  return {
    locked:       false,
    attemptsLeft: LOGIN_MAX_ATTEMPTS - Math.max(identifierFails, ipFails),
    retryAfterMs: 0,
  };
}

async function cleanOldLoginAttempts() {
  const cutoff = new Date(Date.now() - LOGIN_LOCKOUT_MIN * 60 * 1000 * 2);
  const pool   = getPool();
  if (pool) {
    await pool.query('DELETE FROM login_attempts WHERE created_at < $1', [cutoff]).catch(() => {});
  } else {
    const idx = _memAttempts.findIndex(a => a.createdAt > cutoff);
    if (idx > 0) _memAttempts.splice(0, idx);
  }
}

// ── User CRUD ───────────────────────────────────────────────────────────────
async function createUser({ username, email, password, role = 'user', displayName, avatarEmoji = '🙂' }) {
  const pwHash = hashPassword(password);
  const pool   = getPool();

  if (pool) {
    try {
      const res = await pool.query(
        `INSERT INTO users (username, email, password, role, display_name, avatar_emoji)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, email, role, display_name, avatar_emoji, created_at`,
        [username.trim(), email.toLowerCase().trim(), pwHash, role, displayName || username, avatarEmoji]
      );
      return res.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        if (err.constraint?.includes('email'))    throw new Error('EMAIL_EXISTS');
        if (err.constraint?.includes('username')) throw new Error('USERNAME_EXISTS');
      }
      throw err;
    }
  }

  // fallback
  const emailNorm = email.toLowerCase().trim();
  if ([..._memUsers.values()].some(u => u.email === emailNorm))           throw new Error('EMAIL_EXISTS');
  if ([..._memUsers.values()].some(u => u.username === username.trim()))  throw new Error('USERNAME_EXISTS');
  const user = {
    id: _memIdSeq++, username: username.trim(), email: emailNorm, password: pwHash,
    role, display_name: displayName || username.trim(), avatar_emoji: avatarEmoji, created_at: new Date(),
  };
  _memUsers.set(emailNorm, user);
  return user;
}

async function getUserByEmail(email) {
  const pool = getPool();
  if (pool) {
    const res = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase().trim()]
    );
    return res.rows[0] || null;
  }
  return _memUsers.get(email.toLowerCase().trim()) || null;
}

async function getUserById(id) {
  const pool = getPool();
  if (pool) {
    const res = await pool.query(
      `SELECT id, username, email, role, display_name, avatar_emoji, last_login_at, created_at
       FROM users WHERE id = $1 AND is_active = TRUE`,
      [id]
    );
    return res.rows[0] || null;
  }
  return [..._memUsers.values()].find(u => u.id === id) || null;
}

async function countUsers() {
  const pool = getPool();
  if (pool) {
    const res = await pool.query('SELECT COUNT(*) FROM users WHERE is_active = TRUE');
    return parseInt(res.rows[0].count, 10);
  }
  return _memUsers.size;
}

async function updateUserProfile(userId, { displayName, avatarEmoji }) {
  const pool = getPool();
  if (pool) {
    const res = await pool.query(
      `UPDATE users
       SET display_name = COALESCE($2, display_name),
           avatar_emoji = COALESCE($3, avatar_emoji),
           updated_at   = NOW()
       WHERE id = $1 AND is_active = TRUE
       RETURNING id, username, email, role, display_name, avatar_emoji`,
      [userId, displayName ?? null, avatarEmoji ?? null]
    );
    return res.rows[0] || null;
  }
  const user = [..._memUsers.values()].find(u => u.id === userId);
  if (!user) return null;
  if (displayName !== undefined)  user.display_name = displayName;
  if (avatarEmoji !== undefined)  user.avatar_emoji = avatarEmoji;
  return user;
}

async function changePassword(userId, currentPassword, newPassword) {
  const pool = getPool();
  let user;

  if (pool) {
    const res = await pool.query('SELECT * FROM users WHERE id = $1 AND is_active = TRUE', [userId]);
    user = res.rows[0];
  } else {
    user = [..._memUsers.values()].find(u => u.id === userId);
  }

  if (!user) throw new Error('USER_NOT_FOUND');
  if (!verifyPassword(currentPassword, user.password)) throw new Error('WRONG_PASSWORD');

  const pwHash = hashPassword(newPassword);
  if (pool) {
    await pool.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      [pwHash, userId]
    );
  } else {
    user.password = pwHash;
  }
  return true;
}

async function touchLastLogin(userId) {
  const pool = getPool();
  if (pool) {
    pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]).catch(() => {});
  } else {
    const u = [..._memUsers.values()].find(u => u.id === userId);
    if (u) u.last_login_at = new Date();
  }
}

// ── Session Management ──────────────────────────────────────────────────────
async function createSession(userId, ip, userAgent) {
  const token     = signToken({ sub: userId, type: 'user_session' });
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400 * 1000);
  const pool      = getPool();

  if (pool) {
    // Enforce per-user session cap — evict oldest sessions beyond MAX_SESSIONS-1
    await pool.query(
      `DELETE FROM user_sessions
       WHERE user_id = $1
         AND token NOT IN (
           SELECT token FROM user_sessions
           WHERE user_id = $1
           ORDER BY last_seen_at DESC
           LIMIT $2
         )`,
      [userId, MAX_SESSIONS - 1]
    ).catch(() => {});

    await pool.query(
      `INSERT INTO user_sessions (token, user_id, ip, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [token, userId, ip || null, userAgent || null, expiresAt]
    ).catch(e => console.warn('⚠ [auth] createSession DB error:', e.message));
  } else {
    const userSessions = [..._memSessions.entries()].filter(([, s]) => s.userId === userId);
    if (userSessions.length >= MAX_SESSIONS) {
      userSessions.sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
      _memSessions.delete(userSessions[0][0]);
    }
    _memSessions.set(token, { userId, expiresAt, createdAt: new Date(), lastSeenAt: new Date() });
  }
  return token;
}

async function validateSession(token) {
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'user_session') return null;

  const pool = getPool();
  if (pool) {
    const res = await pool.query(
      `SELECT us.user_id, u.id, u.username, u.email, u.role, u.display_name, u.avatar_emoji
       FROM user_sessions us
       JOIN users u ON u.id = us.user_id
       WHERE us.token = $1 AND us.expires_at > NOW() AND u.is_active = TRUE`,
      [token]
    );
    if (!res.rows[0]) return null;
    // Bump last_seen_at in the background — no await
    pool.query('UPDATE user_sessions SET last_seen_at = NOW() WHERE token = $1', [token]).catch(() => {});
    return res.rows[0];
  }

  const s = _memSessions.get(token);
  if (!s || s.expiresAt < new Date()) return null;
  s.lastSeenAt = new Date();
  return getUserById(s.userId);
}

async function deleteSession(token) {
  const pool = getPool();
  if (pool) {
    await pool.query('DELETE FROM user_sessions WHERE token = $1', [token]);
  } else {
    _memSessions.delete(token);
  }
}

async function revokeAllUserSessions(userId, exceptToken = null) {
  const pool = getPool();
  if (pool) {
    const sql    = exceptToken
      ? 'DELETE FROM user_sessions WHERE user_id = $1 AND token != $2'
      : 'DELETE FROM user_sessions WHERE user_id = $1';
    const params = exceptToken ? [userId, exceptToken] : [userId];
    await pool.query(sql, params).catch(() => {});
  } else {
    for (const [tok, s] of _memSessions) {
      if (s.userId === userId && tok !== exceptToken) _memSessions.delete(tok);
    }
  }
}

async function getUserSessions(userId) {
  const pool = getPool();
  if (pool) {
    const res = await pool.query(
      `SELECT token, ip, user_agent, created_at, last_seen_at, expires_at
       FROM user_sessions WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY last_seen_at DESC`,
      [userId]
    );
    return res.rows;
  }
  return [..._memSessions.entries()]
    .filter(([, s]) => s.userId === userId && s.expiresAt > new Date())
    .map(([tok, s]) => ({ token: tok, ...s }))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

async function cleanExpiredUserSessions() {
  const pool = getPool();
  if (pool) {
    const res = await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
    return res.rowCount || 0;
  }
  const now = new Date();
  let n = 0;
  for (const [t, s] of _memSessions) {
    if (s.expiresAt < now) { _memSessions.delete(t); n++; }
  }
  return n;
}

// ── Middleware ──────────────────────────────────────────────────────────────
function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.cookies?.fv_user_token || req.headers['x-fv-user-token'] || null;
}

async function requireAuth(req, res, next) {
  const token = extractToken(req);
  const user  = await validateSession(token).catch(() => null);
  if (!user) return res.status(401).json({ ok: false, error: 'กรุณาเข้าสู่ระบบก่อน', code: 'UNAUTHORIZED' });
  req.user  = user;
  req.token = token;
  next();
}

async function requireAdmin(req, res, next) {
  const token = extractToken(req);
  const user  = await validateSession(token).catch(() => null);
  if (!user)                 return res.status(401).json({ ok: false, error: 'กรุณาเข้าสู่ระบบก่อน',   code: 'UNAUTHORIZED' });
  if (user.role !== 'admin') return res.status(403).json({ ok: false, error: 'ต้องการสิทธิ์ Admin', code: 'FORBIDDEN' });
  req.user  = user;
  req.token = token;
  next();
}

async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    req.user  = await validateSession(token).catch(() => null);
    req.token = token;
  }
  next();
}

// ── Safe user DTO ─────────────────────────────────────────────────────────
function toUserDTO(u) {
  return {
    id:          u.id,
    username:    u.username,
    email:       u.email,
    role:        u.role,
    displayName: u.display_name,
    avatarEmoji: u.avatar_emoji,
  };
}

// ── Route Handler Factory ────────────────────────────────────────────────────
function createAuthRoutes(app) {
  const COOKIE_OPTS = {
    httpOnly: true,
    sameSite: 'strict',
    maxAge:   SESSION_DAYS * 86_400 * 1000,
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
  };

  // POST /api/auth/register
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { username, email, password, displayName, avatarEmoji } = req.body || {};

      const usernameErr = validateUsername(username);
      if (usernameErr) return res.status(400).json({ ok: false, error: usernameErr });

      const emailErr = validateEmail(email);
      if (emailErr) return res.status(400).json({ ok: false, error: emailErr });

      const pwErr = validatePasswordStrength(password);
      if (pwErr) return res.status(400).json({ ok: false, error: pwErr });

      const total = await countUsers();
      const role  = total === 0 ? 'admin' : 'user';

      const user = await createUser({
        username:    username.trim(),
        email,
        password,
        role,
        displayName: displayName?.trim() || username.trim(),
        avatarEmoji: avatarEmoji || '🙂',
      });

      const ip        = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || null;
      const userAgent = req.headers['user-agent'] || null;
      const token     = await createSession(user.id, ip, userAgent);

      res.cookie('fv_user_token', token, COOKIE_OPTS);
      res.status(201).json({
        ok:          true,
        token,
        user:        toUserDTO(user),
        isFirstUser: role === 'admin',
      });
    } catch (err) {
      if (err.message === 'EMAIL_EXISTS')    return res.status(409).json({ ok: false, error: 'อีเมลนี้ถูกใช้งานแล้ว',       code: 'EMAIL_EXISTS' });
      if (err.message === 'USERNAME_EXISTS') return res.status(409).json({ ok: false, error: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว', code: 'USERNAME_EXISTS' });
      console.error('[auth] register error:', err);
      res.status(500).json({ ok: false, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    }
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password)
        return res.status(400).json({ ok: false, error: 'กรุณากรอก email และ password' });

      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || null;

      // Rate limit check (by email + by IP independently)
      const rl = await checkLoginRateLimit(email, ip);
      if (rl.locked) {
        return res.status(429).json({
          ok:           false,
          error:        `ล็อกอินผิดพลาดหลายครั้ง กรุณารอ ${LOGIN_LOCKOUT_MIN} นาทีแล้วลองใหม่`,
          code:         'RATE_LIMITED',
          retryAfterMs: rl.retryAfterMs,
        });
      }

      const user  = await getUserByEmail(email);
      const valid = user && verifyPassword(password, user.password);

      // Always record the attempt — even invalid emails (avoids enumeration timing)
      await recordLoginAttempt(email, ip, !!valid);

      if (!valid) {
        const remaining = rl.attemptsLeft - 1;
        const hint = remaining > 0
          ? ` (เหลืออีก ${remaining} ครั้งก่อนถูกล็อก)`
          : ' — บัญชีจะถูกล็อกชั่วคราว';
        return res.status(401).json({
          ok:    false,
          error: `อีเมลหรือรหัสผ่านไม่ถูกต้อง${hint}`,
          code:  'INVALID_CREDENTIALS',
        });
      }

      const userAgent = req.headers['user-agent'] || null;
      const token     = await createSession(user.id, ip, userAgent);
      touchLastLogin(user.id); // fire-and-forget

      res.cookie('fv_user_token', token, COOKIE_OPTS);
      res.json({ ok: true, token, user: toUserDTO(user) });
    } catch (err) {
      console.error('[auth] login error:', err);
      res.status(500).json({ ok: false, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    }
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (req, res) => {
    const token = extractToken(req);
    if (token) await deleteSession(token).catch(() => {});
    res.clearCookie('fv_user_token', { path: '/' });
    res.json({ ok: true, message: 'ออกจากระบบสำเร็จ' });
  });

  // POST /api/auth/logout-all  — revoke every session except the current one
  app.post('/api/auth/logout-all', requireAuth, async (req, res) => {
    await revokeAllUserSessions(req.user.id, req.token).catch(() => {});
    res.json({ ok: true, message: 'ออกจากระบบทุกอุปกรณ์แล้ว (ยกเว้นอุปกรณ์นี้)' });
  });

  // GET /api/auth/me
  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ ok: true, user: toUserDTO(req.user) });
  });

  // PATCH /api/auth/profile  — update display_name / avatar_emoji
  app.patch('/api/auth/profile', requireAuth, async (req, res) => {
    try {
      const { displayName, avatarEmoji } = req.body || {};
      if (displayName !== undefined) {
        if (typeof displayName !== 'string' || displayName.trim().length === 0)
          return res.status(400).json({ ok: false, error: 'display_name ไม่ถูกต้อง' });
        if (displayName.trim().length > 50)
          return res.status(400).json({ ok: false, error: 'display_name ยาวเกินไป (สูงสุด 50 ตัวอักษร)' });
      }
      const updated = await updateUserProfile(req.user.id, {
        displayName: displayName?.trim(),
        avatarEmoji,
      });
      if (!updated) return res.status(404).json({ ok: false, error: 'ไม่พบผู้ใช้' });
      res.json({ ok: true, user: toUserDTO(updated) });
    } catch (err) {
      console.error('[auth] profile update error:', err);
      res.status(500).json({ ok: false, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    }
  });

  // POST /api/auth/change-password
  app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword)
        return res.status(400).json({ ok: false, error: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' });

      const pwErr = validatePasswordStrength(newPassword);
      if (pwErr) return res.status(400).json({ ok: false, error: pwErr });

      if (currentPassword === newPassword)
        return res.status(400).json({ ok: false, error: 'รหัสผ่านใหม่ต้องต่างจากรหัสผ่านเดิม' });

      await changePassword(req.user.id, currentPassword, newPassword);
      // Revoke all other sessions for security
      await revokeAllUserSessions(req.user.id, req.token).catch(() => {});
      res.json({ ok: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ เซสชันอื่น ๆ ถูกยกเลิกแล้ว' });
    } catch (err) {
      if (err.message === 'WRONG_PASSWORD')
        return res.status(401).json({ ok: false, error: 'รหัสผ่านเดิมไม่ถูกต้อง', code: 'WRONG_PASSWORD' });
      if (err.message === 'USER_NOT_FOUND')
        return res.status(404).json({ ok: false, error: 'ไม่พบผู้ใช้' });
      console.error('[auth] change-password error:', err);
      res.status(500).json({ ok: false, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    }
  });

  // GET /api/auth/sessions  — list active sessions (tokens masked)
  app.get('/api/auth/sessions', requireAuth, async (req, res) => {
    try {
      const sessions = await getUserSessions(req.user.id);
      const safe = sessions.map(s => ({
        tokenSuffix: s.token?.slice(-8),
        isCurrent:   s.token === req.token,
        ip:          s.ip,
        userAgent:   s.user_agent || s.userAgent,
        createdAt:   s.created_at || s.createdAt,
        lastSeenAt:  s.last_seen_at || s.lastSeenAt,
        expiresAt:   s.expires_at || s.expiresAt,
      }));
      res.json({ ok: true, sessions: safe });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/auth/users  (admin only)
  app.get('/api/auth/users', requireAdmin, async (req, res) => {
    try {
      const pool = getPool();
      let users  = [];
      if (pool) {
        const r = await pool.query(
          `SELECT id, username, email, role, display_name, avatar_emoji, last_login_at, created_at
           FROM users WHERE is_active = TRUE ORDER BY created_at`
        );
        users = r.rows;
      }
      res.json({ ok: true, users });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // PATCH /api/auth/users/:id/role  (admin only)
  app.patch('/api/auth/users/:id/role', requireAdmin, async (req, res) => {
    try {
      const targetId = parseInt(req.params.id, 10);
      const { role } = req.body || {};
      if (!['admin', 'user'].includes(role))
        return res.status(400).json({ ok: false, error: 'role ต้องเป็น admin หรือ user' });
      if (targetId === req.user.id)
        return res.status(400).json({ ok: false, error: 'ไม่สามารถเปลี่ยน role ของตัวเองได้' });

      const pool = getPool();
      if (!pool) return res.status(503).json({ ok: false, error: 'ต้องการ database' });

      const r = await pool.query(
        `UPDATE users SET role = $1, updated_at = NOW()
         WHERE id = $2 AND is_active = TRUE
         RETURNING id, username, email, role`,
        [role, targetId]
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'ไม่พบผู้ใช้' });
      res.json({ ok: true, user: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // DELETE /api/auth/users/:id  (admin only — soft-delete)
  app.delete('/api/auth/users/:id', requireAdmin, async (req, res) => {
    try {
      const targetId = parseInt(req.params.id, 10);
      if (targetId === req.user.id)
        return res.status(400).json({ ok: false, error: 'ไม่สามารถลบบัญชีของตัวเองได้' });

      const pool = getPool();
      if (!pool) return res.status(503).json({ ok: false, error: 'ต้องการ database' });

      const r = await pool.query(
        `UPDATE users SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1 AND is_active = TRUE RETURNING id`,
        [targetId]
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'ไม่พบผู้ใช้' });
      await revokeAllUserSessions(targetId).catch(() => {});
      res.json({ ok: true, message: 'ปิดใช้งานบัญชีสำเร็จ' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = {
  runAuthMigrations,
  // user
  createUser,
  getUserByEmail,
  getUserById,
  countUsers,
  updateUserProfile,
  changePassword,
  touchLastLogin,
  // sessions
  createSession,
  validateSession,
  deleteSession,
  revokeAllUserSessions,
  getUserSessions,
  cleanExpiredUserSessions,
  // rate limiting
  checkLoginRateLimit,
  recordLoginAttempt,
  cleanOldLoginAttempts,
  // middleware
  requireAuth,
  requireAdmin,
  optionalAuth,
  extractToken,
  // validation
  validatePasswordStrength,
  validateUsername,
  validateEmail,
  toUserDTO,
  // routes
  createAuthRoutes,
};
