// Daily overdue CSV import: parse, validate row by row, preview the auto-assignment,
// then commit in one transaction. Preview and commit run the same code, so what the
// manager sees is what gets saved.
import crypto from 'node:crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import { z } from 'zod';
import type { DB } from '../db';
import type { AssignmentPreview, ImportPreview, ImportResult, ImportRowError, SessionUser } from '../../shared/types';
import { assignLoans, type AssignOfficer } from '../../shared/assignment';
import { AppError } from '../http';
import { rescore } from './scoring';
import { pincodeCentroid } from '../geo';

export const REQUIRED_COLUMNS = [
  'loan_id',
  'borrower_name',
  'business_type',
  'phone',
  'address',
  'pincode',
  'outstanding',
  'emi',
  'dpd',
  'last_payment_date',
  'paid_last_3m',
] as const;

const rupees = z.coerce.number({ invalid_type_error: 'must be a number' }).int('must be whole rupees').min(0, 'cannot be negative');

const rowSchema = z.object({
  loan_id: z.string().regex(/^LN-\d{3,10}$/, 'must look like LN-10293'),
  borrower_name: z.string().min(2, 'is required').max(120),
  business_type: z.string().max(60).default(''),
  phone: z.string().regex(/^\+?[0-9 ]{10,15}$/, 'must be a 10-digit phone number'),
  address: z.string().min(5, 'is required').max(200),
  pincode: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
  outstanding: rupees.refine((n) => n > 0, 'must be more than 0'),
  emi: rupees,
  dpd: z.coerce.number().int('must be a whole number').min(1, 'must be 1 to 30').max(30, 'must be 1 to 30 (this list is the 1–30 bucket)'),
  last_payment_date: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'must be YYYY-MM-DD or empty')
    .transform((s) => (s === '' ? null : s)),
  paid_last_3m: z
    .string()
    .transform((s) => (s.trim() === '' ? null : Number(s)))
    .refine((n) => n === null || (Number.isInteger(n) && n >= 0), 'must be whole rupees or empty'),
});

export type ImportRow = z.infer<typeof rowSchema>;

interface Analysis {
  preview: ImportPreview;
  rows: (ImportRow & { branch_id: string })[];
  assignments: AssignmentPreview[];
  curedIds: string[];
  errors: ImportRowError[];
}

export function parseRows(csv: string): { rows: Record<string, string>[] } {
  let records: Record<string, string>[];
  try {
    records = parseCsv(csv, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), bom: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (e) {
    throw new AppError(400, 'bad_csv', `Could not read the CSV: ${(e as Error).message}`);
  }
  const header = csv.replace(/^﻿/, '').split(/\r?\n/, 1)[0].split(',').map((c) => c.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new AppError(400, 'missing_columns', `The file is missing columns: ${missing.join(', ')}.`, { missing, expected: REQUIRED_COLUMNS });
  }
  if (records.length === 0) throw new AppError(400, 'empty_file', 'The file has a header but no rows.');
  if (records.length > 20_000) throw new AppError(400, 'too_many_rows', 'Up to 20,000 rows per file.');
  return { rows: records };
}

function analyse(db: DB, user: SessionUser, csv: string): Analysis {
  const { rows: raw } = parseRows(csv);
  const errors: ImportRowError[] = [];
  const valid: (ImportRow & { branch_id: string })[] = [];
  const seen = new Set<string>();

  const coverage = new Map<string, string>(); // pincode -> branch
  for (const r of db
    .prepare(`SELECT op.pincode, u.branch_id FROM officer_pincodes op JOIN users u ON u.id = op.officer_id`)
    .all() as { pincode: string; branch_id: string }[]) {
    coverage.set(r.pincode, r.branch_id);
  }
  const branchNames = new Map(
    (db.prepare('SELECT id, name FROM branches').all() as { id: string; name: string }[]).map((b) => [b.id, b.name]),
  );

  raw.forEach((rec, i) => {
    const rowNo = i + 2; // row 1 is the header
    const parsed = rowSchema.safeParse(rec);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ row: rowNo, field: String(issue.path[0] ?? 'row'), message: `${String(issue.path[0] ?? 'Row')} ${issue.message}` });
      }
      return;
    }
    const row = parsed.data;
    if (seen.has(row.loan_id)) {
      errors.push({ row: rowNo, field: 'loan_id', message: `${row.loan_id} appears more than once in this file` });
      return;
    }
    seen.add(row.loan_id);
    let branch = coverage.get(row.pincode) ?? null;
    if (user.role === 'manager') {
      if (branch && branch !== user.branchId) {
        errors.push({ row: rowNo, field: 'pincode', message: `Pincode ${row.pincode} belongs to ${branchNames.get(branch)}, not your branch` });
        return;
      }
      branch = user.branchId; // uncovered pincode in a manager's file: import it, leave it for manual assignment
    }
    if (!branch) {
      errors.push({ row: rowNo, field: 'pincode', message: `No branch covers pincode ${row.pincode}` });
      return;
    }
    valid.push({ ...row, branch_id: branch });
  });

  const existing = new Map(
    (db.prepare('SELECT id, officer_id, status FROM loans').all() as { id: string; officer_id: string | null; status: string }[]).map(
      (l) => [l.id, l],
    ),
  );
  const branchesInFile = [...new Set(valid.map((r) => r.branch_id))];
  // A loan missing from today's full export has left the 1-30 list, so it is closed here.
  // Only branches present in the file are touched, so a partial file can't wipe other branches.
  const curedIds = branchesInFile.length
    ? (
        db
          .prepare(`SELECT id FROM loans WHERE status = 'open' AND branch_id IN (${branchesInFile.map(() => '?').join(',')})`)
          .all(...branchesInFile) as { id: string }[]
      )
        .map((r) => r.id)
        .filter((id) => !seen.has(id))
    : [];

  const officerRows = db
    .prepare(
      `SELECT u.id, u.name, u.branch_id, u.cap, GROUP_CONCAT(op.pincode) AS pincodes,
         (SELECT COUNT(*) FROM loans l WHERE l.officer_id = u.id AND l.status = 'open') AS open_now
       FROM users u LEFT JOIN officer_pincodes op ON op.officer_id = u.id
       WHERE u.role = 'officer' GROUP BY u.id`,
    )
    .all() as { id: string; name: string; branch_id: string; cap: number; pincodes: string | null; open_now: number }[];
  const fileIdsByOfficer = new Map<string, number>();
  for (const r of valid) {
    const cur = existing.get(r.loan_id)?.officer_id;
    if (cur && existing.get(r.loan_id)?.status === 'open') fileIdsByOfficer.set(cur, (fileIdsByOfficer.get(cur) ?? 0) + 1);
  }
  // Load before assignment = this officer's loans that are still in today's file, plus open loans
  // in branches not in the file (they stay as they are).
  const officers: AssignOfficer[] = officerRows.map((o) => {
    const inFileBranch = branchesInFile.includes(o.branch_id);
    return {
      id: o.id,
      name: o.name,
      branchId: o.branch_id,
      pincodes: o.pincodes ? o.pincodes.split(',') : [],
      load: inFileBranch ? fileIdsByOfficer.get(o.id) ?? 0 : o.open_now,
      cap: o.cap,
    };
  });
  const startLoad = new Map(officers.map((o) => [o.id, o.load]));

  // Existing loans first (continuity), then new ones with the most days past due first.
  const ordered = [...valid].sort((a, b) => {
    const ea = existing.get(a.loan_id)?.officer_id ? 0 : 1;
    const eb = existing.get(b.loan_id)?.officer_id ? 0 : 1;
    return ea - eb || b.dpd - a.dpd || a.loan_id.localeCompare(b.loan_id);
  });
  const result = assignLoans(
    ordered.map((r) => ({
      loanId: r.loan_id,
      pincode: r.pincode,
      currentOfficerId: existing.get(r.loan_id)?.status === 'open' ? existing.get(r.loan_id)?.officer_id ?? null : null,
    })),
    officers,
  );
  const names = new Map(officers.map((o) => [o.id, o.name]));
  const byLoan = new Map(ordered.map((r) => [r.loan_id, r]));
  const assignments: AssignmentPreview[] = result.map((a) => ({
    loanId: a.loanId,
    borrowerName: byLoan.get(a.loanId)!.borrower_name,
    pincode: byLoan.get(a.loanId)!.pincode,
    officerId: a.officerId,
    officerName: a.officerId ? names.get(a.officerId) ?? null : null,
    rule: a.rule,
    note: a.note,
  }));
  const after = new Map<string, number>(startLoad);
  for (const a of result) {
    const cur = existing.get(a.loanId);
    const prev = cur?.status === 'open' ? cur.officer_id : null;
    if (prev && prev !== a.officerId && after.has(prev)) after.set(prev, after.get(prev)! - 1);
    if (a.officerId && a.officerId !== prev) after.set(a.officerId, (after.get(a.officerId) ?? 0) + 1);
  }
  const visibleOfficers = officerRows.filter((o) => branchesInFile.includes(o.branch_id));

  return {
    rows: valid,
    assignments,
    curedIds,
    errors,
    preview: {
      fileRows: raw.length,
      validRows: valid.length,
      errors,
      newLoans: valid.filter((r) => !existing.has(r.loan_id)).length,
      updatedLoans: valid.filter((r) => existing.has(r.loan_id)).length,
      curedLoans: curedIds.length,
      assignments,
      officerLoad: visibleOfficers.map((o) => ({
        officerId: o.id,
        name: o.name,
        before: o.open_now,
        after: after.get(o.id) ?? 0,
        cap: o.cap,
      })),
    },
  };
}

export function previewImport(db: DB, user: SessionUser, csv: string): ImportPreview {
  return analyse(db, user, csv).preview;
}

export function commitImport(db: DB, user: SessionUser, filename: string, csv: string, now: Date): ImportResult {
  const a = analyse(db, user, csv);
  if (a.rows.length === 0) throw new AppError(422, 'nothing_to_import', 'No valid rows to import. Fix the errors and try again.');
  const importId = crypto.randomUUID();
  const ts = now.toISOString();
  const officerFor = new Map(a.assignments.map((x) => [x.loanId, x.officerId]));
  const upsert = db.prepare(
    `INSERT INTO loans (id, borrower_name, business_type, phone, address, pincode, lat, lng, branch_id, outstanding, emi, dpd,
       last_payment_date, paid_last_3m, officer_id, status, updated_at)
     VALUES (@id, @borrower_name, @business_type, @phone, @address, @pincode, @lat, @lng, @branch_id, @outstanding, @emi, @dpd,
       @last_payment_date, @paid_last_3m, @officer_id, 'open', @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       borrower_name = excluded.borrower_name, business_type = excluded.business_type, phone = excluded.phone,
       address = excluded.address, pincode = excluded.pincode,
       lat = COALESCE(loans.lat, excluded.lat), lng = COALESCE(loans.lng, excluded.lng),
       branch_id = excluded.branch_id, outstanding = excluded.outstanding, emi = excluded.emi, dpd = excluded.dpd,
       last_payment_date = excluded.last_payment_date, paid_last_3m = excluded.paid_last_3m,
       officer_id = excluded.officer_id, status = 'open',
       pinned_by = CASE WHEN loans.officer_id IS excluded.officer_id THEN loans.pinned_by END,
       pinned_reason = CASE WHEN loans.officer_id IS excluded.officer_id THEN loans.pinned_reason END,
       pinned_at = CASE WHEN loans.officer_id IS excluded.officer_id THEN loans.pinned_at END,
       updated_at = excluded.updated_at`,
  );
  db.transaction(() => {
    for (const r of a.rows) {
      const geo = pincodeCentroid(r.pincode);
      upsert.run({
        id: r.loan_id,
        borrower_name: r.borrower_name,
        business_type: r.business_type,
        phone: r.phone,
        address: r.address,
        pincode: r.pincode,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        branch_id: r.branch_id,
        outstanding: r.outstanding,
        emi: r.emi,
        dpd: r.dpd,
        last_payment_date: r.last_payment_date,
        paid_last_3m: r.paid_last_3m,
        officer_id: officerFor.get(r.loan_id) ?? null,
        updated_at: ts,
      });
    }
    const cure = db.prepare(
      `UPDATE loans SET status = 'cured', pinned_by = NULL, pinned_reason = NULL, pinned_at = NULL, updated_at = ? WHERE id = ?`,
    );
    for (const id of a.curedIds) cure.run(ts, id);
    db.prepare(
      `INSERT INTO imports (id, filename, uploaded_by, created_at, rows_total, rows_ok, rows_error, errors) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(importId, filename, user.id, ts, a.preview.fileRows, a.rows.length, a.preview.fileRows - a.rows.length, JSON.stringify(a.errors));
  })();
  const rescored = rescore(db, now, a.rows.map((r) => r.loan_id));
  const assigned = a.assignments.filter((x) => x.officerId).length;
  return {
    importId,
    imported: a.rows.length,
    assigned,
    unassigned: a.assignments.length - assigned,
    cured: a.curedIds.length,
    rescored,
  };
}
