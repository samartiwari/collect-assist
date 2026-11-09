// API contract shared by the Express server and the React client.
// Money is whole rupees (integer). Dates are YYYY-MM-DD in IST. Instants are ISO-8601 UTC strings.

export type Role = 'officer' | 'manager' | 'head';
export type Lang = 'en' | 'hi';
export type Outcome = 'paid' | 'promise' | 'not_reachable' | 'dispute';
export type ContactKind = 'call' | 'visit';

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

// ---------- auth ----------
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  branchId: string | null; // null for head of collections (all branches)
  branchName: string | null;
  lang: Lang;
}
export interface LoginRequest { email: string; password: string }
export interface MeResponse { user: SessionUser }

// ---------- clock (demo mode lets reviewers move inside the 8 am - 7 pm window) ----------
export interface ClockResponse {
  now: string;          // server's effective "now"
  offsetMs: number;     // effective now minus real now; the client adds this to Date.now()
  demoMode: boolean;    // demo controls available
  demoActive: boolean;  // a simulated time is set
}
export type ClockRequest = { mode: 'real' } | { mode: 'demo'; istTime: string /* HH:MM */ };

// ---------- scoring ----------
export interface ScoreReason {
  code: string;
  text: string;        // English, e.g. "27 days past due: 3 days from rolling into 31-60"
  textHi: string;      // Hindi
  direction: 'up' | 'down'; // raises or lowers risk
}
export interface LoanScore {
  probability: number;   // 0..1 chance the loan rolls into 31-60 DPD this cycle
  priority: number;      // 0..100 display score (probability as a percentage)
  expectedLoss: number;  // rupees: probability x outstanding x 20% NPA x 35% loss
  confidence: 'high' | 'low';
  confidenceNote: string | null; // why we are unsure, when confidence is low
  reasons: ScoreReason[]; // top three
  modelVersion: string;
  scoredAt: string;
}

// ---------- loans ----------
export interface PromiseSummary {
  id: string;
  amount: number;
  promiseDate: string;
  status: PromiseStatus;
}
export interface LoanCard {
  id: string;            // e.g. LN-10293
  borrowerName: string;  // business name, e.g. "Company B (packaging unit)"
  businessType: string;
  phone: string;
  address: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
  branchId: string;
  branchName: string;
  outstanding: number;
  emi: number;
  dpd: number;
  lastPaymentDate: string | null;
  officerId: string | null;
  officerName: string | null;
  score: LoanScore | null;
  pinned: { byName: string; reason: string } | null; // manager override, always on top
  openPromise: PromiseSummary | null;
  lastAttempt: { occurredAt: string; outcome: Outcome | null; kind: ContactKind; status: AttemptStatus } | null;
  contactedToday: boolean;
}
export interface TodayResponse {
  generatedAt: string;
  date: string;          // IST date the list is for
  officer: { id: string; name: string };
  loans: LoanCard[];     // already sorted: pinned first, then by expected loss; contacted-today loans last
}

// ---------- attempts (calls and visits) ----------
export type AttemptStatus = 'accepted' | 'blocked';
export interface AttemptInput {
  id: string;            // client-generated UUID, makes sync idempotent
  loanId: string;
  kind: ContactKind;
  outcome: Outcome | null; // null = officer tapped Call while the window was closed (blocked attempt, still recorded)
  amount?: number | null;  // paid amount or promised amount
  promiseDate?: string | null; // YYYY-MM-DD, required when outcome = promise
  note?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  occurredAt: string;    // device time when the officer logged it (may be hours before sync)
  createdOffline: boolean;
}
export interface SyncRequest { items: AttemptInput[] }
export interface SyncResult {
  id: string;
  status: 'accepted' | 'duplicate' | 'blocked' | 'rejected';
  // blocked  = outside 8 am - 7 pm IST; stored for audit, no outcome applied
  // rejected = invalid or not allowed (e.g. loan not assigned to you); not stored
  code?: string;
  message?: string;
}
export interface SyncResponse { results: SyncResult[] }

export interface ActivityRow {
  id: string;
  loanId: string;
  borrowerName: string;
  officerId: string;
  officerName: string;
  kind: ContactKind;
  outcome: Outcome | null;
  status: AttemptStatus;
  amount: number | null;
  promiseDate: string | null;
  note: string | null;
  occurredAt: string;
  receivedAt: string;
  lat: number | null;
  lng: number | null;
  distanceM: number | null;  // distance from the borrower's address, for visits
  createdOffline: boolean;
  sameDay: boolean;          // synced on the same IST day it happened
}
export interface ActivityResponse { attempts: ActivityRow[] }

// ---------- promises ----------
export type PromiseStatus = 'upcoming' | 'due_today' | 'kept' | 'broken';
export interface PromiseRow {
  id: string;
  loanId: string;
  borrowerName: string;
  officerId: string;
  officerName: string;
  amount: number;
  promiseDate: string;
  status: PromiseStatus;
  createdAt: string;
  daysLate: number | null; // for broken promises
  lastReminderAt: string | null;
}
export interface PromisesResponse {
  promises: PromiseRow[];
  counts: Record<PromiseStatus, number>;
}

export interface LoanDetailResponse {
  loan: LoanCard;
  attempts: ActivityRow[];
  promises: PromiseRow[];
  messages: MessageRow[];
}

// ---------- reminders (approved templates only, nothing sends without a tap) ----------
export interface TemplateRow {
  id: string;
  name: string;
  lang: Lang;
  audience: 'borrower' | 'officer';
  body: string; // with {{placeholders}}
}
export interface DraftRequest { templateId: string }
export interface DraftResponse { body: string; ok: boolean; blockedWords: string[] }
export interface SendMessageRequest { templateId: string; body: string }
export interface MessageRow {
  id: string;
  loanId: string;
  templateId: string;
  audience: 'borrower' | 'officer';
  lang: Lang;
  body: string;
  status: 'sent_mock' | 'blocked';
  reason: string | null;
  createdAt: string;
  sentByName: string;
}

// ---------- CSV import ----------
export interface ImportRequest { filename: string; csv: string }
export interface ImportRowError { row: number; field: string; message: string }
export type AssignRule = 'kept' | 'pincode_least_load' | 'branch_overflow' | 'unassigned';
export interface AssignmentPreview {
  loanId: string;
  borrowerName: string;
  pincode: string;
  officerId: string | null;
  officerName: string | null;
  rule: AssignRule;
  note: string;
}
export interface OfficerLoad { officerId: string; name: string; before: number; after: number; cap: number }
export interface ImportPreview {
  fileRows: number;
  validRows: number;
  errors: ImportRowError[];
  newLoans: number;
  updatedLoans: number;
  curedLoans: number;   // open loans in your scope missing from today's file (no longer overdue)
  assignments: AssignmentPreview[];
  officerLoad: OfficerLoad[];
}
export interface ImportResult {
  importId: string;
  imported: number;
  assigned: number;
  unassigned: number;
  cured: number;
  rescored: number;
}
export interface ImportSummary {
  id: string;
  filename: string;
  uploadedByName: string;
  createdAt: string;
  rowsTotal: number;
  rowsOk: number;
  rowsError: number;
}

// ---------- manager dashboards ----------
export interface RollRatePoint { month: string; inBucket: number; rolled: number; rate: number }
export interface BranchRollRate {
  branchId: string;
  branchName: string;
  series: RollRatePoint[];   // completed months, oldest first
  current: { month: string; inBucket: number; projectedRate: number; atRisk: number };
}
export interface RollRatesResponse {
  target: number; // 0.16
  baseline: number; // 0.22
  months: string[];
  branches: BranchRollRate[];
  overall: RollRatePoint[];
  kpis: {
    promisesDueToday: number;
    brokenPromises7d: number;
    attemptsToday: number;
    sameDayLoggedPct7d: number;   // 0..1
    blockedAttempts7d: number;
    unassignedLoans: number;
  };
}

export interface BacktestResponse {
  modelVersion: string;
  trainedAt: string;
  trainMonths: string[];
  testMonths: string[];
  testCount: number;
  auc: number;
  topFifthCapture: number;   // share of actual roll-forwards found in the top 20% of scores
  calibration: { band: string; predicted: number; actual: number; count: number }[];
  weights: { feature: string; label: string; weight: number }[];
}

export interface TeamOfficer {
  id: string;
  name: string;
  branchId: string;
  branchName: string;
  pincodes: string[];
  openLoans: number;
  cap: number;
  attemptsToday: number;
  visitsToday: number;
  openPromises: number;
  brokenPromises: number;
  sameDayPct7d: number;
  lastActivityAt: string | null;
}
export interface TeamResponse { officers: TeamOfficer[] }

export interface PinRequest { pinned: boolean; reason?: string }
export interface ReassignRequest { officerId: string }
