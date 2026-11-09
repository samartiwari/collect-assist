// Applies outcome logs sent from phones. Each item is handled on its own (one bad item
// never blocks the rest) and inside its own transaction.
import crypto from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db';
import type { AttemptInput, SessionUser, SyncResult } from '../../shared/types';
import { addDays, istDate, isContactAllowed } from '../../shared/time';
import { rescore } from './scoring';

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const attemptSchema = z.object({
  id: z.string().uuid(),
  loanId: z.string().regex(/^LN-\d{3,10}$/),
  kind: z.enum(['call', 'visit']),
  outcome: z.enum(['paid', 'promise', 'not_reachable', 'dispute']).nullable(),
  amount: z.number().int().positive().max(100_000_000).nullish(),
  promiseDate: ymd.nullish(),
  note: z.string().trim().max(200).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  accuracyM: z.number().min(0).max(100_000).nullish(),
  occurredAt: z.string().datetime({ offset: true }),
  createdOffline: z.boolean(),
});

export const syncSchema = z.object({ items: z.array(z.unknown()).min(1).max(100) });

interface LoanRow {
  id: string;
  branch_id: string;
  officer_id: string | null;
  outstanding: number;
  status: string;
}

function reject(id: string, code: string, message: string): SyncResult {
  return { id, status: 'rejected', code, message };
}

export function processAttempt(db: DB, user: SessionUser, raw: unknown, now: Date): SyncResult {
  const rawId = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : 'unknown';
  const parsed = attemptSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return reject(rawId, 'invalid', `${first.path.join('.') || 'item'}: ${first.message}`);
  }
  const item = parsed.data as AttemptInput;

  // Idempotency: the phone may resend after a dropped response.
  if (db.prepare('SELECT 1 FROM attempts WHERE id = ?').get(item.id)) {
    return { id: item.id, status: 'duplicate' };
  }

  const loan = db.prepare('SELECT id, branch_id, officer_id, outstanding, status FROM loans WHERE id = ?').get(item.loanId) as
    | LoanRow
    | undefined;
  if (!loan) return reject(item.id, 'loan_not_found', 'This loan is no longer on file.');
  // Accept from the assigned officer, or from a colleague in the same branch (the loan may have
  // been reassigned while the phone was offline; the visit still happened). Never across branches.
  if (loan.officer_id !== user.id && loan.branch_id !== user.branchId) {
    return reject(item.id, 'not_your_loan', 'This loan belongs to another branch.');
  }

  const occurred = new Date(item.occurredAt);
  if (occurred.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return reject(item.id, 'future_time', 'The phone clock looks wrong (time is in the future).');
  }
  if (occurred.getTime() < now.getTime() - MAX_AGE_MS) {
    return reject(item.id, 'too_old', 'Older than 7 days. Ask your manager to record it.');
  }
  const occurredDay = istDate(occurred);
  const receivedAt = now.toISOString();
  const insert = db.prepare(
    `INSERT INTO attempts (id, loan_id, officer_id, kind, outcome, status, amount, promise_date, note, lat, lng, accuracy_m, occurred_at, received_at, created_offline)
     VALUES (@id, @loanId, @officerId, @kind, @outcome, @status, @amount, @promiseDate, @note, @lat, @lng, @accuracyM, @occurredAt, @receivedAt, @createdOffline)`,
  );
  const base = {
    id: item.id,
    loanId: item.loanId,
    officerId: user.id,
    kind: item.kind,
    outcome: item.outcome,
    amount: item.amount ?? null,
    promiseDate: item.promiseDate ?? null,
    note: item.note ?? null,
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    accuracyM: item.accuracyM ?? null,
    occurredAt: occurred.toISOString(),
    receivedAt,
    createdOffline: item.createdOffline ? 1 : 0,
  };

  // RBI contact hours. The attempt is still stored, so head office can see every try.
  if (!isContactAllowed(occurred)) {
    insert.run({ ...base, status: 'blocked', outcome: null });
    return {
      id: item.id,
      status: 'blocked',
      code: 'outside_contact_window',
      message: 'Outside 8 am – 7 pm IST. Recorded as a blocked attempt; no outcome applied.',
    };
  }

  if (item.outcome === null) return reject(item.id, 'invalid', 'Choose an outcome.');
  if (item.outcome === 'paid' && !item.amount) return reject(item.id, 'invalid', 'Enter the amount paid.');
  if (item.outcome === 'paid' && item.amount! > loan.outstanding) {
    return reject(item.id, 'invalid', 'Paid amount is more than the outstanding balance.');
  }
  if (item.outcome === 'promise') {
    if (!item.amount) return reject(item.id, 'invalid', 'Enter the promised amount.');
    if (!item.promiseDate) return reject(item.id, 'invalid', 'Choose the promise date.');
    if (item.promiseDate < occurredDay || item.promiseDate > addDays(occurredDay, 30)) {
      return reject(item.id, 'invalid', 'Promise date must be within 30 days.');
    }
  }
  if (item.outcome === 'dispute' && !item.note) return reject(item.id, 'invalid', 'Add a short note about the dispute.');

  db.transaction(() => {
    insert.run({ ...base, status: 'accepted' });
    if (item.outcome === 'promise') {
      // A new promise replaces any earlier one that is still in the future.
      db.prepare(
        `UPDATE promises SET superseded = 1 WHERE loan_id = ? AND kept_at IS NULL AND superseded = 0 AND promise_date >= ?`,
      ).run(item.loanId, occurredDay);
      db.prepare(
        `INSERT INTO promises (id, loan_id, officer_id, amount, promise_date, created_at, attempt_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(crypto.randomUUID(), item.loanId, user.id, item.amount, item.promiseDate, base.occurredAt, item.id);
    }
    if (item.outcome === 'paid') {
      // Payment on or before the promise date that covers the promised amount keeps the promise.
      db.prepare(
        `UPDATE promises SET kept_at = ? WHERE loan_id = ? AND kept_at IS NULL AND superseded = 0
           AND promise_date >= ? AND amount <= ?`,
      ).run(base.occurredAt, item.loanId, occurredDay, item.amount);
    }
  })();
  if (item.outcome === 'promise' || item.outcome === 'paid') rescore(db, now, [item.loanId]);
  return { id: item.id, status: 'accepted' };
}

export function processBatch(db: DB, user: SessionUser, items: unknown[], now: Date): SyncResult[] {
  return items.map((raw) => processAttempt(db, user, raw, now));
}
