import type { DB } from '../db';
import type {
  ActivityRow,
  AttemptStatus,
  ContactKind,
  LoanCard,
  Outcome,
  PromiseRow,
  PromiseStatus,
  ScoreReason,
  SessionUser,
} from '../../shared/types';
import { daysBetween, istDate, istInstant } from '../../shared/time';
import { notFound } from '../http';

// ---------- scope ----------

/** SQL condition limiting loans (alias l) to what this user may see. */
export function loanScope(user: SessionUser): { sql: string; params: unknown[] } {
  if (user.role === 'officer') return { sql: 'l.officer_id = ?', params: [user.id] };
  if (user.role === 'manager') return { sql: 'l.branch_id = ?', params: [user.branchId] };
  return { sql: '1 = 1', params: [] };
}

/** Out-of-scope loans return 404, not 403, so ids of other branches' loans can't be probed. */
export function assertLoanInScope(db: DB, user: SessionUser, loanId: string): void {
  const scope = loanScope(user);
  const row = db.prepare(`SELECT 1 FROM loans l WHERE l.id = ? AND ${scope.sql}`).get(loanId, ...scope.params);
  if (!row) throw notFound('Loan not found.');
}

// ---------- promises ----------

export function promiseStatus(p: { kept_at: string | null; promise_date: string }, today: string): PromiseStatus {
  if (p.kept_at) return 'kept';
  if (p.promise_date > today) return 'upcoming';
  if (p.promise_date === today) return 'due_today';
  return 'broken';
}

// ---------- loan cards ----------

interface CardRow {
  id: string;
  borrower_name: string;
  business_type: string;
  phone: string;
  address: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
  branch_id: string;
  branch_name: string;
  outstanding: number;
  emi: number;
  dpd: number;
  last_payment_date: string | null;
  officer_id: string | null;
  officer_name: string | null;
  pinned_reason: string | null;
  pinned_by_name: string | null;
  pinned_at: string | null;
  s_version: string | null;
  s_scored_at: string | null;
  s_probability: number | null;
  s_priority: number | null;
  s_expected_loss: number | null;
  s_confidence: 'high' | 'low' | null;
  s_confidence_note: string | null;
  s_reasons: string | null;
  p_id: string | null;
  p_amount: number | null;
  p_date: string | null;
  a_occurred_at: string | null;
  a_outcome: Outcome | null;
  a_kind: ContactKind | null;
  a_status: AttemptStatus | null;
  contacted_today: number;
}

const CARD_SQL = `
SELECT l.*, b.name AS branch_name, o.name AS officer_name, pb.name AS pinned_by_name,
  s.model_version AS s_version, s.scored_at AS s_scored_at, s.probability AS s_probability, s.priority AS s_priority,
  s.expected_loss AS s_expected_loss, s.confidence AS s_confidence, s.confidence_note AS s_confidence_note, s.reasons AS s_reasons,
  p.id AS p_id, p.amount AS p_amount, p.promise_date AS p_date,
  a.occurred_at AS a_occurred_at, a.outcome AS a_outcome, a.kind AS a_kind, a.status AS a_status,
  EXISTS (SELECT 1 FROM attempts t WHERE t.loan_id = l.id AND t.status = 'accepted' AND t.occurred_at >= ?) AS contacted_today
FROM loans l
JOIN branches b ON b.id = l.branch_id
LEFT JOIN users o ON o.id = l.officer_id
LEFT JOIN users pb ON pb.id = l.pinned_by
LEFT JOIN scores s ON s.loan_id = l.id
LEFT JOIN promises p ON p.id = (
  SELECT id FROM promises WHERE loan_id = l.id AND superseded = 0 AND kept_at IS NULL
  ORDER BY promise_date DESC LIMIT 1)
LEFT JOIN attempts a ON a.id = (
  SELECT id FROM attempts WHERE loan_id = l.id ORDER BY occurred_at DESC LIMIT 1)
`;

function toCard(r: CardRow, today: string): LoanCard {
  return {
    id: r.id,
    borrowerName: r.borrower_name,
    businessType: r.business_type,
    phone: r.phone,
    address: r.address,
    pincode: r.pincode,
    lat: r.lat,
    lng: r.lng,
    branchId: r.branch_id,
    branchName: r.branch_name,
    outstanding: r.outstanding,
    emi: r.emi,
    dpd: r.dpd,
    lastPaymentDate: r.last_payment_date,
    officerId: r.officer_id,
    officerName: r.officer_name,
    score:
      r.s_probability === null
        ? null
        : {
            probability: r.s_probability,
            priority: r.s_priority!,
            expectedLoss: r.s_expected_loss!,
            confidence: r.s_confidence!,
            confidenceNote: r.s_confidence_note,
            reasons: JSON.parse(r.s_reasons ?? '[]') as ScoreReason[],
            modelVersion: r.s_version!,
            scoredAt: r.s_scored_at!,
          },
    pinned: r.pinned_at ? { byName: r.pinned_by_name ?? 'Manager', reason: r.pinned_reason ?? '' } : null,
    openPromise: r.p_id
      ? {
          id: r.p_id,
          amount: r.p_amount!,
          promiseDate: r.p_date!,
          status: promiseStatus({ kept_at: null, promise_date: r.p_date! }, today),
        }
      : null,
    lastAttempt: r.a_occurred_at
      ? { occurredAt: r.a_occurred_at, outcome: r.a_outcome, kind: r.a_kind!, status: r.a_status! }
      : null,
    contactedToday: r.contacted_today === 1,
  };
}

/**
 * Order an officer's day: manager pins first (oldest pin first), then loans not yet
 * contacted today by expected loss, then the ones already handled.
 */
export function sortForToday(cards: (LoanCard & { pinnedAt?: string | null })[]): LoanCard[] {
  const loss = (c: LoanCard) => c.score?.expectedLoss ?? 0;
  const pinned = cards.filter((c) => c.pinned && !c.contactedToday);
  const open = cards.filter((c) => !c.pinned && !c.contactedToday).sort((a, b) => loss(b) - loss(a) || a.id.localeCompare(b.id));
  const done = cards.filter((c) => c.contactedToday).sort((a, b) => loss(b) - loss(a));
  return [...pinned, ...open, ...done];
}

export function loanCards(db: DB, now: Date, where: string, params: unknown[]): LoanCard[] {
  const today = istDate(now);
  const dayStart = istInstant(today, 0).toISOString();
  const rows = db
    .prepare(`${CARD_SQL} WHERE ${where} ORDER BY l.pinned_at IS NULL, l.pinned_at`)
    .all(dayStart, ...params) as CardRow[];
  return rows.map((r) => toCard(r, today));
}

export function officerList(db: DB, now: Date, officerId: string): LoanCard[] {
  return sortForToday(loanCards(db, now, `l.officer_id = ? AND l.status = 'open'`, [officerId]));
}

export function loanCard(db: DB, now: Date, loanId: string): LoanCard {
  const [card] = loanCards(db, now, 'l.id = ?', [loanId]);
  if (!card) throw notFound('Loan not found.');
  return card;
}

// ---------- activity ----------

interface AttemptRow {
  id: string;
  loan_id: string;
  borrower_name: string;
  officer_id: string;
  officer_name: string;
  kind: ContactKind;
  outcome: Outcome | null;
  status: AttemptStatus;
  amount: number | null;
  promise_date: string | null;
  note: string | null;
  occurred_at: string;
  received_at: string;
  lat: number | null;
  lng: number | null;
  loan_lat: number | null;
  loan_lng: number | null;
  created_offline: number;
}

export const ATTEMPT_SQL = `
SELECT a.*, l.borrower_name, l.lat AS loan_lat, l.lng AS loan_lng, u.name AS officer_name
FROM attempts a JOIN loans l ON l.id = a.loan_id JOIN users u ON u.id = a.officer_id`;

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export function toActivity(r: AttemptRow): ActivityRow {
  const distanceM =
    r.lat !== null && r.lng !== null && r.loan_lat !== null && r.loan_lng !== null
      ? haversineM(r.lat, r.lng, r.loan_lat, r.loan_lng)
      : null;
  return {
    id: r.id,
    loanId: r.loan_id,
    borrowerName: r.borrower_name,
    officerId: r.officer_id,
    officerName: r.officer_name,
    kind: r.kind,
    outcome: r.outcome,
    status: r.status,
    amount: r.amount,
    promiseDate: r.promise_date,
    note: r.note,
    occurredAt: r.occurred_at,
    receivedAt: r.received_at,
    lat: r.lat,
    lng: r.lng,
    distanceM,
    createdOffline: r.created_offline === 1,
    sameDay: istDate(new Date(r.occurred_at)) === istDate(new Date(r.received_at)),
  };
}

// ---------- promise rows ----------

interface PromiseDbRow {
  id: string;
  loan_id: string;
  borrower_name: string;
  officer_id: string;
  officer_name: string;
  amount: number;
  promise_date: string;
  created_at: string;
  kept_at: string | null;
  last_reminder_at: string | null;
}

export const PROMISE_SQL = `
SELECT p.*, l.borrower_name, u.name AS officer_name,
  (SELECT MAX(m.created_at) FROM messages m WHERE m.loan_id = p.loan_id AND m.status = 'sent_mock' AND m.created_at >= p.created_at) AS last_reminder_at
FROM promises p JOIN loans l ON l.id = p.loan_id JOIN users u ON u.id = p.officer_id`;

export function toPromiseRow(r: PromiseDbRow, today: string): PromiseRow {
  const status = promiseStatus(r, today);
  return {
    id: r.id,
    loanId: r.loan_id,
    borrowerName: r.borrower_name,
    officerId: r.officer_id,
    officerName: r.officer_name,
    amount: r.amount,
    promiseDate: r.promise_date,
    status,
    createdAt: r.created_at,
    daysLate: status === 'broken' ? daysBetween(r.promise_date, today) : null,
    lastReminderAt: r.last_reminder_at,
  };
}
