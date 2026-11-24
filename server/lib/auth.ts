import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { one, query } from '../db/index.js';
import type { Role } from '../../shared/domain.js';

export const SESSION_COOKIE = 'i4nnova_session';
const SESSION_DAYS = 7;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  managerId: string | null;
  managerName: string | null;
  roles: Role[];
};

type StaffRow = {
  id: string;
  name: string;
  email: string;
  job_title: string | null;
  manager_id: string | null;
  left_at: string | null;
  manager_name: string | null;
};

export async function loadUser(staffId: string): Promise<CurrentUser | null> {
  const staff = await one<StaffRow>(
    `select s.id, s.name, s.email, s.job_title, s.manager_id, s.left_at, m.name as manager_name
       from staff s left join staff m on m.id = s.manager_id
      where s.id = $1`,
    [staffId],
  );
  if (!staff || staff.left_at) return null;
  const roles = await query<{ role: Role }>(`select role from staff_role where staff_id = $1 order by role`, [
    staffId,
  ]);
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    jobTitle: staff.job_title,
    managerId: staff.manager_id,
    managerName: staff.manager_name,
    roles: roles.map((r) => r.role),
  };
}

export async function createSession(staffId: string): Promise<{ id: string; expires: Date }> {
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query(`insert into session (id, staff_id, expires_at) values ($1, $2, $3)`, [id, staffId, expires]);
  await query(`update staff set first_signed_in_at = coalesce(first_signed_in_at, now()) where id = $1`, [staffId]);
  await query(`delete from session where expires_at < now()`);
  return { id, expires };
}

export async function destroySession(id: string): Promise<void> {
  await query(`delete from session where id = $1`, [id]);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: CurrentUser;
      sessionId?: string;
    }
  }
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== 'string') return next();
  const session = await one<{ id: string; staff_id: string; expires_at: string }>(
    `select id, staff_id, expires_at from session where id = $1`,
    [token],
  );
  if (!session) return next();
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await destroySession(session.id);
    return next();
  }
  const user = await loadUser(session.staff_id);
  if (user) {
    req.user = user;
    req.sessionId = session.id;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
    const ok = req.user.roles.some((r) => roles.includes(r));
    if (!ok) return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    next();
  };
}

export function hasRole(user: CurrentUser | undefined, role: Role): boolean {
  return !!user?.roles.includes(role);
}

export function isAdmin(user: CurrentUser | undefined): boolean {
  return hasRole(user, 'administrator');
}

export function isStockManager(user: CurrentUser | undefined): boolean {
  return hasRole(user, 'stock_manager');
}

export function isFinance(user: CurrentUser | undefined): boolean {
  return hasRole(user, 'financial_executive');
}
