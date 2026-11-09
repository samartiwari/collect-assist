import type { DB } from '../db';
import { scoreLoan, type FeatureInput, type Model } from '../../shared/scoring';
import { addDays, istDate } from '../../shared/time';

let cached: { version: string; model: Model } | null = null;

export function activeModel(db: DB): Model {
  const row = db.prepare('SELECT version, body FROM models WHERE active = 1').get() as { version: string; body: string } | undefined;
  if (!row) throw new Error('No active model. Run the seed script first.');
  if (cached?.version !== row.version) cached = { version: row.version, model: JSON.parse(row.body) as Model };
  return cached.model;
}

export function resetModelCache() {
  cached = null;
}

interface LoanFeatureRow {
  id: string;
  dpd: number;
  outstanding: number;
  emi: number;
  paid_last_3m: number | null;
  last_payment_date: string | null;
}

/** Feature inputs for a live loan, using our own promise history. */
export function featureInput(db: DB, loan: LoanFeatureRow, today: string): FeatureInput {
  const broken = db
    .prepare(
      `SELECT COUNT(*) AS n FROM promises
       WHERE loan_id = ? AND kept_at IS NULL AND superseded = 0 AND promise_date < ? AND promise_date >= ?`,
    )
    .get(loan.id, today, addDays(today, -90)) as { n: number };
  const open = db
    .prepare(
      `SELECT promise_date FROM promises
       WHERE loan_id = ? AND kept_at IS NULL AND superseded = 0 AND promise_date >= ?
       ORDER BY promise_date ASC LIMIT 1`,
    )
    .get(loan.id, today) as { promise_date: string } | undefined;
  return {
    dpd: loan.dpd,
    outstanding: loan.outstanding,
    emi: loan.emi,
    paidLast3m: loan.paid_last_3m,
    lastPaymentDate: loan.last_payment_date,
    brokenPromises90d: broken.n,
    openPromiseDate: open?.promise_date ?? null,
    asOf: today,
  };
}

/** Score open loans (all, or the given ids) and store the results. Returns how many were scored. */
export function rescore(db: DB, now: Date, loanIds?: string[]): number {
  const model = activeModel(db);
  const today = istDate(now);
  const scoredAt = now.toISOString();
  const rows = (
    loanIds
      ? loanIds.map((id) => db.prepare(`SELECT * FROM loans WHERE id = ? AND status = 'open'`).get(id)).filter(Boolean)
      : db.prepare(`SELECT * FROM loans WHERE status = 'open'`).all()
  ) as LoanFeatureRow[];
  const upsert = db.prepare(
    `INSERT INTO scores (loan_id, model_version, scored_at, probability, priority, expected_loss, confidence, confidence_note, reasons)
     VALUES (@loan_id, @model_version, @scored_at, @probability, @priority, @expected_loss, @confidence, @confidence_note, @reasons)
     ON CONFLICT(loan_id) DO UPDATE SET
       model_version = excluded.model_version, scored_at = excluded.scored_at, probability = excluded.probability,
       priority = excluded.priority, expected_loss = excluded.expected_loss, confidence = excluded.confidence,
       confidence_note = excluded.confidence_note, reasons = excluded.reasons`,
  );
  const tx = db.transaction(() => {
    for (const loan of rows) {
      const s = scoreLoan(model, featureInput(db, loan, today), scoredAt);
      upsert.run({
        loan_id: loan.id,
        model_version: s.modelVersion,
        scored_at: s.scoredAt,
        probability: s.probability,
        priority: s.priority,
        expected_loss: s.expectedLoss,
        confidence: s.confidence,
        confidence_note: s.confidenceNote,
        reasons: JSON.stringify(s.reasons),
      });
    }
  });
  tx();
  return rows.length;
}
