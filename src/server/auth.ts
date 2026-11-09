import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { DB } from './db';
import type { Role, SessionUser } from '../shared/types';
import { AppError } from './http';

export const COOKIE = 'ca_session';
const SESSION_DAYS = 7;

export interface AuthConfig {
  jwtSecret: string;
  secureCookies: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  branch_id: string | null;
  branch_name: string | null;
  lang: 'en' | 'hi';
}

const USER_SQL = `SELECT u.*, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id`;

function toSession(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    branchId: row.branch_id,
    branchName: row.branch_name,
    lang: row.lang,
  };
}

export function loadUser(db: DB, id: string): SessionUser | null {
  const row = db.prepare(`${USER_SQL} WHERE u.id = ?`).get(id) as UserRow | undefined;
  return row ? toSession(row) : null;
}

/** Same error for unknown email and wrong password, so accounts can't be enumerated. */
export function verifyLogin(db: DB, email: string, password: string): SessionUser {
  const row = db.prepare(`${USER_SQL} WHERE lower(u.email) = lower(?)`).get(email.trim()) as UserRow | undefined;
  const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const ok = bcrypt.compareSync(password, hash);
  if (!row || !ok) throw new AppError(401, 'bad_credentials', 'Email or password is incorrect.');
  return toSession(row);
}

export function setSessionCookie(res: Response, cfg: AuthConfig, userId: string) {
  const token = jwt.sign({ sub: userId }, cfg.jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.secureCookies,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

/** Reads the session cookie and attaches req.user when valid. Never rejects by itself. */
export function sessionMiddleware(db: DB, cfg: AuthConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE];
    if (token) {
      try {
        const payload = jwt.verify(token, cfg.jwtSecret) as { sub: string };
        const user = loadUser(db, payload.sub);
        if (user) req.user = user;
      } catch {
        /* expired or tampered: treat as signed out */
      }
    }
    next();
  };
}

export function requireUser(req: Request): SessionUser {
  if (!req.user) throw new AppError(401, 'unauthenticated', 'Please sign in.');
  return req.user;
}

export function requireRole(req: Request, ...roles: Role[]): SessionUser {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw new AppError(403, 'forbidden', 'Your role cannot do this.');
  return user;
}
