// Routes used by every role: auth, clock, loans, promises, reminders, activity.
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db';
import type {
  ActivityResponse,
  ClockResponse,
  DraftResponse,
  LoanDetailResponse,
  MessageRow,
  PromisesResponse,
  PromiseStatus,
  TemplateRow,
} from '../../shared/types';
import { checkMessage, fillTemplate, hasUnfilledPlaceholders } from '../../shared/reminders';
import { contactWindow, istDate, istInstant, addDays } from '../../shared/time';
import {
  clearSessionCookie,
  loadUser,
  requireUser,
  setSessionCookie,
  verifyLogin,
  type AuthConfig,
} from '../auth';
import { getOffsetMs, now, resetClock, setDemoTime } from '../clock';
import { AppError, badRequest, forbidden, parse, route } from '../http';
import {
  ATTEMPT_SQL,
  PROMISE_SQL,
  assertLoanInScope,
  loanCard,
  loanScope,
  toActivity,
  toPromiseRow,
} from '../services/loans';

export interface AppConfig extends AuthConfig {
  demoMode: boolean;
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email').max(120),
  password: z.string().min(1, 'Enter your password').max(200),
});

// Small in-memory limit on failed sign-ins per IP (10 failures per 10 minutes).
const failedLogins = new Map<string, { count: number; resetAt: number }>();
function assertNotLimited(ip: string) {
  const e = failedLogins.get(ip);
  if (e && e.resetAt > Date.now() && e.count >= 10) {
    throw new AppError(429, 'rate_limited', 'Too many failed sign-ins. Try again in a few minutes.');
  }
}
function recordFailedLogin(ip: string) {
  const t = Date.now();
  const e = failedLogins.get(ip);
  if (!e || e.resetAt < t) failedLogins.set(ip, { count: 1, resetAt: t + 10 * 60 * 1000 });
  else e.count += 1;
}

export function commonRoutes(db: DB, cfg: AppConfig): Router {
  const r = Router();

  // ---------- auth ----------
  r.post(
    '/auth/login',
    route((req, res) => {
      const ip = req.ip ?? 'unknown';
      assertNotLimited(ip);
      const body = parse(loginSchema, req.body);
      let user;
      try {
        user = verifyLogin(db, body.email, body.password);
      } catch (e) {
        recordFailedLogin(ip);
        throw e;
      }
      setSessionCookie(res, cfg, user.id);
      return { user };
    }),
  );
  r.post(
    '/auth/logout',
    route((_req, res) => {
      clearSessionCookie(res);
      return { ok: true };
    }),
  );
  r.get('/auth/me', route((req) => ({ user: requireUser(req) })));
  r.patch(
    '/auth/me',
    route((req) => {
      const user = requireUser(req);
      const { lang } = parse(z.object({ lang: z.enum(['en', 'hi']) }), req.body);
      db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, user.id);
      return { user: loadUser(db, user.id) };
    }),
  );

  // ---------- clock ----------
  const clockResponse = (): ClockResponse => {
    const offsetMs = getOffsetMs(db);
    return { now: now(db).toISOString(), offsetMs, demoMode: cfg.demoMode, demoActive: offsetMs !== 0 };
  };
  r.get('/clock', route(() => clockResponse()));
  r.post(
    '/clock',
    route((req) => {
      requireUser(req);
      if (!cfg.demoMode) throw forbidden('Demo clock is turned off.');
      const body = parse(
        z.discriminatedUnion('mode', [
          z.object({ mode: z.literal('real') }),
          z.object({ mode: z.literal('demo'), istTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM') }),
        ]),
        req.body,
      );
      if (body.mode === 'real') resetClock(db);
      else setDemoTime(db, body.istTime);
      return clockResponse();
    }),
  );

  // ---------- loan detail ----------
  r.get(
    '/loans/:id',
    route((req): LoanDetailResponse => {
      const user = requireUser(req);
      const id = String(req.params.id);
      assertLoanInScope(db, user, id);
      const t = now(db);
      const today = istDate(t);
      const attempts = (db.prepare(`${ATTEMPT_SQL} WHERE a.loan_id = ? ORDER BY a.occurred_at DESC LIMIT 50`).all(id) as never[]).map(
        toActivity,
      );
      const promises = (
        db.prepare(`${PROMISE_SQL} WHERE p.loan_id = ? AND p.superseded = 0 ORDER BY p.promise_date DESC`).all(id) as never[]
      ).map((p) => toPromiseRow(p, today));
      const messages = (
        db
          .prepare(
            `SELECT m.*, u.name AS sent_by_name FROM messages m JOIN users u ON u.id = m.sent_by WHERE m.loan_id = ? ORDER BY m.created_at DESC`,
          )
          .all(id) as MessageDb[]
      ).map(toMessage);
      return { loan: loanCard(db, t, id), attempts, promises, messages };
    }),
  );

  // ---------- promises ----------
  r.get(
    '/promises',
    route((req): PromisesResponse => {
      const user = requireUser(req);
      const status = parse(
        z.enum(['all', 'upcoming', 'due_today', 'broken', 'kept']).default('all'),
        req.query.status ?? 'all',
      );
      const today = istDate(now(db));
      const scope = loanScope(user);
      // Broken promises older than 60 days drop off the tracker.
      const rows = (
        db
          .prepare(`${PROMISE_SQL} WHERE p.superseded = 0 AND p.promise_date >= ? AND ${scope.sql} ORDER BY p.promise_date ASC`)
          .all(addDays(today, -60), ...scope.params) as never[]
      ).map((p) => toPromiseRow(p, today));
      const counts: Record<PromiseStatus, number> = { upcoming: 0, due_today: 0, kept: 0, broken: 0 };
      for (const p of rows) counts[p.status] += 1;
      const filtered = status === 'all' ? rows : rows.filter((p) => p.status === status);
      // Most urgent first: due today, then broken (most recent), then upcoming (soonest), then kept.
      const rank: Record<PromiseStatus, number> = { due_today: 0, broken: 1, upcoming: 2, kept: 3 };
      filtered.sort(
        (a, b) =>
          rank[a.status] - rank[b.status] ||
          (a.status === 'broken' || a.status === 'kept' ? b.promiseDate.localeCompare(a.promiseDate) : a.promiseDate.localeCompare(b.promiseDate)),
      );
      return { promises: filtered, counts };
    }),
  );

  // ---------- activity ----------
  r.get(
    '/activity',
    route((req): ActivityResponse => {
      const user = requireUser(req);
      const q = parse(
        z.object({
          officerId: z.string().max(64).optional(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
        req.query,
      );
      const date = q.date ?? istDate(now(db));
      const from = istInstant(date, 0).toISOString();
      const to = istInstant(addDays(date, 1), 0).toISOString();
      const conds = ['a.occurred_at >= ?', 'a.occurred_at < ?'];
      const params: unknown[] = [from, to];
      if (user.role === 'officer') {
        conds.push('a.officer_id = ?');
        params.push(user.id);
      } else {
        if (user.role === 'manager') {
          conds.push('l.branch_id = ?');
          params.push(user.branchId);
        }
        if (q.officerId) {
          conds.push('a.officer_id = ?');
          params.push(q.officerId);
        }
      }
      const rows = db.prepare(`${ATTEMPT_SQL} WHERE ${conds.join(' AND ')} ORDER BY a.occurred_at DESC`).all(...params) as never[];
      return { attempts: rows.map(toActivity) };
    }),
  );

  // ---------- reminder templates and messages ----------
  r.get(
    '/templates',
    route((req) => {
      requireUser(req);
      return { templates: db.prepare('SELECT * FROM templates ORDER BY audience, lang, name').all() as TemplateRow[] };
    }),
  );

  const draftFor = (loanId: string, templateId: string) => {
    const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId) as TemplateRow | undefined;
    if (!tpl) throw badRequest('Unknown template.');
    const card = loanCard(db, now(db), loanId);
    const amount = card.openPromise?.amount ?? card.emi;
    const due = card.openPromise?.promiseDate ?? istDate(now(db));
    const body = fillTemplate(tpl.body, {
      borrower: card.borrowerName,
      loanId: card.id,
      amount: amount.toLocaleString('en-IN'),
      date: new Date(`${due}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      officer: card.officerName ?? 'your officer',
      dpd: card.dpd,
    });
    return { tpl, body };
  };

  r.post(
    '/loans/:id/messages/draft',
    route((req): DraftResponse => {
      const user = requireUser(req);
      const id = String(req.params.id);
      assertLoanInScope(db, user, id);
      const { templateId } = parse(z.object({ templateId: z.string().max(64) }), req.body);
      const { body } = draftFor(id, templateId);
      const check = checkMessage(body);
      return { body, ok: check.ok, blockedWords: check.blockedWords };
    }),
  );

  r.post(
    '/loans/:id/messages',
    route((req): MessageRow => {
      const user = requireUser(req);
      const id = String(req.params.id);
      assertLoanInScope(db, user, id);
      const input = parse(z.object({ templateId: z.string().max(64), body: z.string().trim().min(5).max(500) }), req.body);
      const { tpl } = draftFor(id, input.templateId);
      const t = now(db);
      let status: MessageRow['status'] = 'sent_mock';
      let reason: string | null = null;
      const check = checkMessage(input.body);
      if (!check.ok) {
        status = 'blocked';
        reason = `Blocked words: ${check.blockedWords.join(', ')}`;
      } else if (hasUnfilledPlaceholders(input.body)) {
        status = 'blocked';
        reason = 'Message still has {{placeholders}}.';
      } else if (tpl.audience === 'borrower' && !contactWindow(t).open) {
        status = 'blocked';
        reason = 'Borrower messages can only go out between 8 am and 7 pm IST.';
      }
      const msgId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO messages (id, loan_id, template_id, audience, lang, body, status, reason, created_at, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(msgId, id, tpl.id, tpl.audience, tpl.lang, input.body, status, reason, t.toISOString(), user.id);
      const row = db
        .prepare(`SELECT m.*, u.name AS sent_by_name FROM messages m JOIN users u ON u.id = m.sent_by WHERE m.id = ?`)
        .get(msgId) as MessageDb;
      return toMessage(row);
    }),
  );

  return r;
}

interface MessageDb {
  id: string;
  loan_id: string;
  template_id: string;
  audience: 'borrower' | 'officer';
  lang: 'en' | 'hi';
  body: string;
  status: 'sent_mock' | 'blocked';
  reason: string | null;
  created_at: string;
  sent_by_name: string;
}

function toMessage(m: MessageDb): MessageRow {
  return {
    id: m.id,
    loanId: m.loan_id,
    templateId: m.template_id,
    audience: m.audience,
    lang: m.lang,
    body: m.body,
    status: m.status,
    reason: m.reason,
    createdAt: m.created_at,
    sentByName: m.sent_by_name,
  };
}
