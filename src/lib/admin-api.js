import { getSessionUser, SESSION_COOKIE } from './auth.js';

export function authorizeAdminApi(request, db, { superAdminOnly = false } = {}) {
  const user = getSessionUser(db, request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return { response: Response.json({ error: 'Sign-in required.' }, { status: 401 }) };
  }
  if (superAdminOnly && user.role !== 'super_admin') {
    return { response: Response.json({ error: 'Super-admin access required.' }, { status: 403 }) };
  }
  return { user };
}