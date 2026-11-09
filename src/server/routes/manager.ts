import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import type {
  BacktestResponse,
  ImportSummary,
  RollRatesResponse,
  SessionUser,
  TeamOfficer,
  TeamResponse,
  TodayResponse,
} from '../../shared/types';
import { rollRates, projectedRate } from '../../shared/rollRate';
import { addDays, istDate, istInstant, istMonth } from '../../shared/time';
import { requireRole } from '../auth';
import { now } from '../clock';
import { AppError, badRequest, notFound, parse, route } from '../http';
import { commitImport, previewImport, REQUIRED_COLUMNS } from '../services/importer';
import { assertLoanInScope, loanCards, officerList, sortForToday } from '../services/loans';

const importSchema = z.object({
  filename: z.string().trim().min(1).max(120),
  csv: z.string().min(1, 'The file is empty.').max(2_000_000, 'File is too large (max 2 MB).'),
});

/** Branch condition for a manager (own branch) or head (all). */
function branchScope(user: SessionUser, column: string): { sql: string; params: unknown[] } {
  return user.role === 'manager' ? { sql: `${column} = ?`, params: [user.branchId] } : { sql: '1 = 1', params: [] };
}

function assertOfficerInScope(db: DB, user: SessionUser, officerId: string) {
  const o = db.prepare(`SELECT id, branch_id FROM users WHERE id = ? AND role = 'officer'`).get(officerId) as
    | { id: string; branch_id: string }
    | undefined;
  if (!o || (user.role === 'manager' && o.branch_id !== user.branchId)) throw notFound('Officer not found.');
  return o;
}

export function managerRoutes(db: DB): Router {
  const r = Router();
  const roles = ['manager', 'head'] as const;

  // ---------- imports ----------
  r.post(
    '/imports/preview',
    route((req) => {
      const user = requireRole(req, ...roles);
      const body = parse(importSchema, req.body);
      return previewImport(db, user, body.csv);
    }),
  );
  r.post(
    '/imports/commit',
    route((req) => {
      const user = requireRole(req, ...roles);
      const body = parse(importSchema, req.body);
      return commitImport(db, user, body.filename, body.csv, now(db));
    }),
  );
  r.get(
    '/imports',
    route((req) => {
      const user = requireRole(req, ...roles);
      const scope = user.role === 'manager' ? { sql: 'u.branch_id = ?', params: [user.branchId] } : { sql: '1 = 1', params: [] };
      const rows = db
        .prepare(
          `SELECT i.*, u.name AS uploaded_by_name FROM imports i JOIN users u ON u.id = i.uploaded_by
           WHERE ${scope.sql} ORDER BY i.created_at DESC LIMIT 20`,
        )
        .all(...scope.params) as {
        id: string;
        filename: string;
        uploaded_by_name: string;
        created_at: string;
        rows_total: number;
        rows_ok: number;
        rows_error: number;
      }[];
      const imports: ImportSummary[] = rows.map((i) => ({
        id: i.id,
        filename: i.filename,
        uploadedByName: i.uploaded_by_name,
        createdAt: i.created_at,
        rowsTotal: i.rows_total,
        rowsOk: i.rows_ok,
        rowsError: i.rows_error,
      }));
      return { imports };
    }),
  );

  // A ready-to-try file: today's open loans in scope (DPD +1 for a new day), a few new loans,
  // a few that have cured (left out), and two broken rows to show validation.
  r.get('/imports/sample.csv', (req, res, next) => {
    try {
      const user = requireRole(req, ...roles);
      const scope = branchScope(user, 'l.branch_id');
      const loans = db
        .prepare(`SELECT l.* FROM loans l WHERE l.status = 'open' AND ${scope.sql} ORDER BY l.id`)
        .all(...scope.params) as Record<string, string | number | null>[];
      const pins = db
        .prepare(
          `SELECT DISTINCT op.pincode FROM officer_pincodes op JOIN users u ON u.id = op.officer_id WHERE ${branchScope(user, 'u.branch_id').sql}`,
        )
        .all(...branchScope(user, 'u.branch_id').params) as { pincode: string }[];
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [REQUIRED_COLUMNS.join(',')];
      loans.forEach((l, i) => {
        if (i % 17 === 5) return; // cured: no longer overdue
        const dpd = Math.min(30, Number(l.dpd) + 1);
        lines.push(
          [l.id, l.borrower_name, l.business_type, l.phone, l.address, l.pincode, l.outstanding, l.emi, dpd, l.last_payment_date, l.paid_last_3m]
            .map(esc)
            .join(','),
        );
      });
      const kinds = ['Garment unit', 'Auto parts dealer', 'Printing press', 'Spice trader', 'Plastic moulding', 'Hardware store'];
      const newNames = ['Bhawani Garments', 'Sai Kripa Auto Parts', 'Shubh Labh Printers', 'Maa Narmada Masala Udyog', 'Patidar Polymers', 'Jain Hardware'];
      for (let i = 0; i < 6; i++) {
        const pin = pins[i % Math.max(pins.length, 1)]?.pincode ?? '452001';
        const id = `LN-2${String(9000 + i)}`;
        lines.push(
          [id, newNames[i], kinds[i], `+91 90000 2${String(9000 + i)}`, `Shop ${i + 3}, Main Road, Indore`, pin, 150000 + i * 45000, 9000 + i * 1500, 3 + i * 4, istDate(new Date(Date.now() - (20 + i * 4) * 864e5)), 18000 + i * 3000]
            .map(esc)
            .join(','),
        );
      }
      lines.push('LN-29990,Bad Row Pvt (pincode),Trader,+91 90000 29990,"Lane 2, Somewhere",4520,200000,10000,12,2026-10-01,20000');
      lines.push('LN-29991,Bad Row Pvt (dpd),Trader,+91 90000 29991,"Lane 3, Somewhere",452001,200000,10000,45,2026-09-01,0');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="overdue-${istDate(now(db))}.csv"`);
      res.send(lines.join('\n') + '\n');
    } catch (e) {
      next(e);
    }
  });

  // ---------- dashboards ----------
  r.get(
    '/dashboard/roll-rates',
    route((req): RollRatesResponse => {
      const user = requireRole(req, ...roles);
      const t = now(db);
      const today = istDate(t);
      const scope = branchScope(user, 'b.id');
      const branches = db.prepare(`SELECT b.id, b.name FROM branches b WHERE ${scope.sql} ORDER BY b.name`).all(...scope.params) as {
        id: string;
        name: string;
      }[];
      const history = db
        .prepare(`SELECT branch_id, month, rolled FROM bucket_history ORDER BY month`)
        .all() as { branch_id: string; month: string; rolled: number }[];
      const months = [...new Set(history.map((h) => h.month))].sort();
      const branchIds = new Set(branches.map((b) => b.id));
      const result = branches.map((b) => {
        const open = db
          .prepare(
            `SELECT l.dpd, s.probability FROM loans l LEFT JOIN scores s ON s.loan_id = l.id WHERE l.status = 'open' AND l.branch_id = ?`,
          )
          .all(b.id) as { dpd: number; probability: number | null }[];
        return {
          branchId: b.id,
          branchName: b.name,
          series: rollRates(history.filter((h) => h.branch_id === b.id).map((h) => ({ month: h.month, rolled: h.rolled === 1 }))),
          current: {
            month: istMonth(t),
            inBucket: open.length,
            projectedRate: projectedRate(open.map((o) => o.probability ?? 0)),
            atRisk: open.filter((o) => o.dpd >= 25).length,
          },
        };
      });
      const overall = rollRates(history.filter((h) => branchIds.has(h.branch_id)).map((h) => ({ month: h.month, rolled: h.rolled === 1 })));

      const loanScopeSql = user.role === 'manager' ? 'l.branch_id = ?' : '1 = 1';
      const lp = user.role === 'manager' ? [user.branchId] : [];
      const dayStart = istInstant(today, 0).toISOString();
      const weekStart = istInstant(addDays(today, -6), 0).toISOString();
      const one = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;
      const sameDay = db
        .prepare(
          `SELECT a.occurred_at, a.received_at FROM attempts a JOIN loans l ON l.id = a.loan_id
           WHERE a.occurred_at >= ? AND a.status = 'accepted' AND ${loanScopeSql}`,
        )
        .all(weekStart, ...lp) as { occurred_at: string; received_at: string }[];
      const sameDayCount = sameDay.filter((a) => istDate(new Date(a.occurred_at)) === istDate(new Date(a.received_at))).length;
      return {
        target: 0.16,
        baseline: 0.22,
        months,
        branches: result,
        overall,
        kpis: {
          promisesDueToday: one(
            `SELECT COUNT(*) AS n FROM promises p JOIN loans l ON l.id = p.loan_id WHERE p.superseded = 0 AND p.kept_at IS NULL AND p.promise_date = ? AND ${loanScopeSql}`,
            today,
            ...lp,
          ),
          brokenPromises7d: one(
            `SELECT COUNT(*) AS n FROM promises p JOIN loans l ON l.id = p.loan_id WHERE p.superseded = 0 AND p.kept_at IS NULL AND p.promise_date < ? AND p.promise_date >= ? AND ${loanScopeSql}`,
            today,
            addDays(today, -7),
            ...lp,
          ),
          attemptsToday: one(
            `SELECT COUNT(*) AS n FROM attempts a JOIN loans l ON l.id = a.loan_id WHERE a.occurred_at >= ? AND a.status = 'accepted' AND ${loanScopeSql}`,
            dayStart,
            ...lp,
          ),
          sameDayLoggedPct7d: sameDay.length ? sameDayCount / sameDay.length : 0,
          blockedAttempts7d: one(
            `SELECT COUNT(*) AS n FROM attempts a JOIN loans l ON l.id = a.loan_id WHERE a.occurred_at >= ? AND a.status = 'blocked' AND ${loanScopeSql}`,
            weekStart,
            ...lp,
          ),
          unassignedLoans: one(`SELECT COUNT(*) AS n FROM loans l WHERE l.status = 'open' AND l.officer_id IS NULL AND ${loanScopeSql}`, ...lp),
        },
      };
    }),
  );

  r.get(
    '/dashboard/backtest',
    route((req): BacktestResponse => {
      requireRole(req, ...roles);
      const row = db.prepare('SELECT version, trained_at, body, backtest FROM models WHERE active = 1').get() as
        | { version: string; trained_at: string; body: string; backtest: string }
        | undefined;
      if (!row) throw notFound('No model trained yet.');
      const model = JSON.parse(row.body) as { weights: { feature: string; label: string; weight: number }[] };
      const bt = JSON.parse(row.backtest) as Omit<BacktestResponse, 'modelVersion' | 'trainedAt' | 'weights'>;
      return { modelVersion: row.version, trainedAt: row.trained_at, weights: model.weights, ...bt };
    }),
  );

  // ---------- team ----------
  r.get(
    '/team',
    route((req): TeamResponse => {
      const user = requireRole(req, ...roles);
      const t = now(db);
      const today = istDate(t);
      const dayStart = istInstant(today, 0).toISOString();
      const weekStart = istInstant(addDays(today, -6), 0).toISOString();
      const scope = branchScope(user, 'u.branch_id');
      const officers = db
        .prepare(
          `SELECT u.id, u.name, u.branch_id, b.name AS branch_name, u.cap,
             (SELECT GROUP_CONCAT(pincode) FROM officer_pincodes WHERE officer_id = u.id) AS pincodes,
             (SELECT COUNT(*) FROM loans WHERE officer_id = u.id AND status = 'open') AS open_loans,
             (SELECT COUNT(*) FROM attempts WHERE officer_id = u.id AND status = 'accepted' AND occurred_at >= @dayStart) AS attempts_today,
             (SELECT COUNT(*) FROM attempts WHERE officer_id = u.id AND status = 'accepted' AND kind = 'visit' AND occurred_at >= @dayStart) AS visits_today,
             (SELECT COUNT(*) FROM promises WHERE officer_id = u.id AND superseded = 0 AND kept_at IS NULL AND promise_date >= @today) AS open_promises,
             (SELECT COUNT(*) FROM promises WHERE officer_id = u.id AND superseded = 0 AND kept_at IS NULL AND promise_date < @today AND promise_date >= @since) AS broken_promises,
             (SELECT MAX(occurred_at) FROM attempts WHERE officer_id = u.id) AS last_activity
           FROM users u JOIN branches b ON b.id = u.branch_id
           WHERE u.role = 'officer' AND ${scope.sql.replace('?', '@branch')}
           ORDER BY b.name, u.name`,
        )
        .all({ dayStart, today, since: addDays(today, -30), ...(user.role === 'manager' ? { branch: user.branchId } : {}) }) as {
        id: string;
        name: string;
        branch_id: string;
        branch_name: string;
        cap: number;
        pincodes: string | null;
        open_loans: number;
        attempts_today: number;
        visits_today: number;
        open_promises: number;
        broken_promises: number;
        last_activity: string | null;
      }[];
      const week = db
        .prepare(`SELECT officer_id, occurred_at, received_at FROM attempts WHERE status = 'accepted' AND occurred_at >= ?`)
        .all(weekStart) as { officer_id: string; occurred_at: string; received_at: string }[];
      const result: TeamOfficer[] = officers.map((o) => {
        const mine = week.filter((w) => w.officer_id === o.id);
        const same = mine.filter((w) => istDate(new Date(w.occurred_at)) === istDate(new Date(w.received_at))).length;
        return {
          id: o.id,
          name: o.name,
          branchId: o.branch_id,
          branchName: o.branch_name,
          pincodes: o.pincodes ? o.pincodes.split(',').sort() : [],
          openLoans: o.open_loans,
          cap: o.cap,
          attemptsToday: o.attempts_today,
          visitsToday: o.visits_today,
          openPromises: o.open_promises,
          brokenPromises: o.broken_promises,
          sameDayPct7d: mine.length ? same / mine.length : 0,
          lastActivityAt: o.last_activity,
        };
      });
      return { officers: result };
    }),
  );

  r.get(
    '/team/:officerId/list',
    route((req): TodayResponse => {
      const user = requireRole(req, ...roles);
      const officerId = String(req.params.officerId);
      const t = now(db);
      if (officerId === 'unassigned') {
        // Loans with no officer (uncovered pincode or a full branch), for manual assignment.
        const scope = branchScope(user, 'l.branch_id');
        const loans = sortForToday(loanCards(db, t, `l.officer_id IS NULL AND l.status = 'open' AND ${scope.sql}`, scope.params));
        return { generatedAt: t.toISOString(), date: istDate(t), officer: { id: 'unassigned', name: 'Unassigned loans' }, loans };
      }
      assertOfficerInScope(db, user, officerId);
      const o = db.prepare('SELECT id, name FROM users WHERE id = ?').get(officerId) as { id: string; name: string };
      return { generatedAt: t.toISOString(), date: istDate(t), officer: o, loans: officerList(db, t, officerId) };
    }),
  );

  // ---------- manager overrides ----------
  r.post(
    '/loans/:id/pin',
    route((req) => {
      const user = requireRole(req, ...roles);
      const id = String(req.params.id);
      assertLoanInScope(db, user, id);
      const body = parse(
        z.object({ pinned: z.boolean(), reason: z.string().trim().max(120).optional() }).refine((b) => !b.pinned || (b.reason?.length ?? 0) >= 3, {
          message: 'Give a short reason so the officer knows why.',
          path: ['reason'],
        }),
        req.body,
      );
      if (body.pinned) {
        db.prepare('UPDATE loans SET pinned_by = ?, pinned_reason = ?, pinned_at = ? WHERE id = ?').run(
          user.id,
          body.reason,
          now(db).toISOString(),
          id,
        );
      } else {
        db.prepare('UPDATE loans SET pinned_by = NULL, pinned_reason = NULL, pinned_at = NULL WHERE id = ?').run(id);
      }
      return { ok: true };
    }),
  );

  r.post(
    '/loans/:id/reassign',
    route((req) => {
      const user = requireRole(req, ...roles);
      const id = String(req.params.id);
      assertLoanInScope(db, user, id);
      const { officerId } = parse(z.object({ officerId: z.string().min(1).max(64) }), req.body);
      const officer = assertOfficerInScope(db, user, officerId);
      const loan = db.prepare('SELECT branch_id, status FROM loans WHERE id = ?').get(id) as { branch_id: string; status: string };
      if (loan.status !== 'open') throw badRequest('This loan is no longer overdue.');
      if (officer.branch_id !== loan.branch_id) throw new AppError(422, 'other_branch', 'Pick an officer from the same branch.');
      db.prepare('UPDATE loans SET officer_id = ?, pinned_by = NULL, pinned_reason = NULL, pinned_at = NULL, updated_at = ? WHERE id = ?').run(
        officerId,
        now(db).toISOString(),
        id,
      );
      return { ok: true };
    }),
  );

  return r;
}

