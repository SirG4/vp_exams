import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = 'vp_admin_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_KEY_LENGTH = 64;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, passwordHash) {
  const [algorithm, saltText, keyText] = String(passwordHash || '').split('$');
  if (algorithm !== 'scrypt' || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  db.prepare('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(userId, hashSessionToken(token), expiresAt);
  return { token, expiresAt };
}

export function getSessionUser(db, token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.email, u.role, u.status
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'approved'
  `).get(hashSessionToken(token), new Date().toISOString()) || null;
}

export function revokeSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(hashSessionToken(token));
}

export function requireSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    if (!['http:', 'https:'].includes(originUrl.protocol)) return false;

    const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
      || request.headers.get('host')?.trim();
    if (!host) return originUrl.origin === new URL(request.url).origin;

    const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProtocol && ['http', 'https'].includes(forwardedProtocol)
      ? forwardedProtocol
      : originUrl.protocol.replace(':', '');

    return originUrl.origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export function safeUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, role: user.role, status: user.status };
}
