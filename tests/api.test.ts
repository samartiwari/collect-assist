import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import type { Express } from 'express';
import { openDb, type DB } from '../src/server/db';
import { createApp } from '../src/server/app';
import { seed, DEMO_PASSWORD } from '../src/server/seed';
import { istInstant } from '../src/shared/time';
import type { AttemptInput, ImportPreview, LoanDetailResponse, PromisesResponse, SyncResponse, TodayResponse } from '../src/shared/types';

// Freeze time at 11:00 am IST on 9 Nov 2026, inside the contact window.
const NOW = istInstant('2026-11-09', 11, 0);

let db: DB;
let app: Express;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = openDb(':memory:');
  seed(db, { now: NOW });
  app = createApp(db, { jwtSecret: 'test-secret-at-least-16', secureCookies: false, demoMode: true });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  db.prepare('DELETE FROM settings').run();
});

async function login(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

function attempt(overrides: Partial<AttemptInput> = {}): AttemptInput {
  return {
    id: crypto.randomUUID(),
    loanId: 'LN-10293',
    kind: 'visit',
    outcome: 'not_reachable',
    note: 'Shop closed',
    lat: 22.72,
    lng: 75.86,
    accuracyM: 15,
    occurredAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    createdOffline: false,
    ...overrides,
  };
}

describe('sign-in', () => {
  it('rejects a wrong password with a generic message', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'rahul@demo.in', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Email or password is incorrect.');
  });

  it('rejects an unknown email with the same message', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ghost@demo.in', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Email or password is incorrect.');
  });

  it('validates the login body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
  });

  it('sets an httpOnly session cookie and returns the user', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'rahul@demo.in', password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('officer');
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  });

  it('requires a session for protected routes', async () => {
    expect((await request(app).get('/api/officer/today')).status).toBe(401);
    expect((await request(app).get('/api/dashboard/roll-rates')).status).toBe(401);
  });
});

describe('access control', () => {
  it('an officer cannot open manager dashboards', async () => {
    const rahul = await login('rahul@demo.in');
    expect((await rahul.get('/api/dashboard/roll-rates')).status).toBe(403);
    expect((await rahul.post('/api/imports/preview').send({ filename: 'x.csv', csv: 'a' })).status).toBe(403);
  });

  it("an officer cannot see another officer's loan", async () => {
    const rahul = await login('rahul@demo.in');
    expect((await rahul.get('/api/loans/LN-10293')).status).toBe(200);
    expect((await rahul.get('/api/loans/LN-10871')).status).toBe(404); // Neha's
  });

  it("a branch manager cannot see another branch's loans or officers", async () => {
    const pithampur = await login('manager.pithampur@demo.in');
    expect((await pithampur.get('/api/loans/LN-10293')).status).toBe(404);
    expect((await pithampur.get('/api/team/u-rahul/list')).status).toBe(404);
    expect((await pithampur.post('/api/loans/LN-10293/pin').send({ pinned: true, reason: 'test' })).status).toBe(404);
    const team = await pithampur.get('/api/team');
    expect(team.body.officers.every((o: { branchId: string }) => o.branchId === 'PTP')).toBe(true);
  });

  it('a manager cannot use the officer-only sync endpoint', async () => {
    const kavita = await login('manager.indore@demo.in');
    expect((await kavita.post('/api/sync/attempts').send({ items: [attempt()] })).status).toBe(403);
  });
});

describe("officer's prioritised list", () => {
  it('returns only their loans, each scored with three reasons', async () => {
    const rahul = await login('rahul@demo.in');
    const res = await rahul.get('/api/officer/today');
    const body = res.body as TodayResponse;
    expect(body.loans.length).toBeGreaterThan(10);
    expect(body.loans.every((l) => l.officerId === 'u-rahul')).toBe(true);
    for (const l of body.loans) {
      expect(l.score).not.toBeNull();
      expect(l.score!.reasons.length).toBeGreaterThan(0);
      expect(l.score!.reasons.length).toBeLessThanOrEqual(3);
    }
  });

  it('orders by expected loss, with contacted-today loans last', async () => {
    const rahul = await login('rahul@demo.in');
    const { loans } = (await rahul.get('/api/officer/today')).body as TodayResponse;
    const open = loans.filter((l) => !l.contactedToday && !l.pinned);
    for (let i = 1; i < open.length; i++) {
      expect(open[i - 1].score!.expectedLoss).toBeGreaterThanOrEqual(open[i].score!.expectedLoss);
    }
    const firstDone = loans.findIndex((l) => l.contactedToday);
    if (firstDone >= 0) expect(loans.slice(firstDone).every((l) => l.contactedToday)).toBe(true);
  });

  it("puts a manager's pin at the top, with the reason", async () => {
    const kavita = await login('manager.indore@demo.in');
    const rahul = await login('rahul@demo.in');
    const before = (await rahul.get('/api/officer/today')).body as TodayResponse;
    const last = before.loans.filter((l) => !l.contactedToday).at(-1)!;
    const pin = await kavita.post(`/api/loans/${last.id}/pin`).send({ pinned: true, reason: 'Owner selling the unit' });
    expect(pin.status).toBe(200);
    const after = (await rahul.get('/api/officer/today')).body as TodayResponse;
    expect(after.loans[0].id).toBe(last.id);
    expect(after.loans[0].pinned?.reason).toBe('Owner selling the unit');
    await kavita.post(`/api/loans/${last.id}/pin`).send({ pinned: false });
  });

  it('requires a reason to pin', async () => {
    const kavita = await login('manager.indore@demo.in');
    expect((await kavita.post('/api/loans/LN-10293/pin').send({ pinned: true })).status).toBe(400);
  });
});

describe('offline sync', () => {
  it('accepts an attempt once and reports duplicates on resend (idempotent)', async () => {
    const rahul = await login('rahul@demo.in');
    const item = attempt();
    const first = (await rahul.post('/api/sync/attempts').send({ items: [item] })).body as SyncResponse;
    expect(first.results[0].status).toBe('accepted');
    const again = (await rahul.post('/api/sync/attempts').send({ items: [item, item] })).body as SyncResponse;
    expect(again.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
    const n = db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE id = ?').get(item.id) as { n: number };
    expect(n.n).toBe(1);
  });

  it('handles each item on its own: one bad item does not block the rest', async () => {
    const rahul = await login('rahul@demo.in');
    const res = (await rahul.post('/api/sync/attempts').send({ items: [attempt(), { id: 'junk' }, attempt()] })).body as SyncResponse;
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'rejected', 'accepted']);
  });

  it('accepts an attempt logged offline hours earlier, using the phone time', async () => {
    const rahul = await login('rahul@demo.in');
    const occurredAt = istInstant('2026-11-09', 9, 15).toISOString();
    const res = (await rahul.post('/api/sync/attempts').send({ items: [attempt({ occurredAt, createdOffline: true })] })).body as SyncResponse;
    expect(res.results[0].status).toBe('accepted');
  });

  it('a promise creates a tracked promise and rescoring lowers risk', async () => {
    const rahul = await login('rahul@demo.in');
    const before = ((await rahul.get('/api/loans/LN-10293')).body as LoanDetailResponse).loan.score!.probability;
    const res = (
      await rahul.post('/api/sync/attempts').send({
        items: [attempt({ outcome: 'promise', amount: 28000, promiseDate: '2026-11-12', note: null })],
      })
    ).body as SyncResponse;
    expect(res.results[0].status).toBe('accepted');
    const detail = (await rahul.get('/api/loans/LN-10293')).body as LoanDetailResponse;
    expect(detail.loan.openPromise?.promiseDate).toBe('2026-11-12');
    expect(detail.loan.score!.probability).toBeLessThan(before);
    const promises = (await rahul.get('/api/promises?status=upcoming')).body as PromisesResponse;
    expect(promises.promises.some((p) => p.loanId === 'LN-10293' && p.promiseDate === '2026-11-12')).toBe(true);
  });

  it('validates outcomes: paid needs an amount within the balance; promise date within 30 days; dispute needs a note', async () => {
    const rahul = await login('rahul@demo.in');
    const res = (
      await rahul.post('/api/sync/attempts').send({
        items: [
          attempt({ outcome: 'paid', amount: null }),
          attempt({ outcome: 'paid', amount: 99_000_000 }),
          attempt({ outcome: 'promise', amount: 1000, promiseDate: '2026-12-31' }),
          attempt({ outcome: 'dispute', note: null }),
        ],
      })
    ).body as SyncResponse;
    expect(res.results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it("rejects attempts on another branch's loan", async () => {
    const arjun = await login('arjun@demo.in'); // Pithampur
    const res = (await arjun.post('/api/sync/attempts').send({ items: [attempt({ loanId: 'LN-10293' })] })).body as SyncResponse;
    expect(res.results[0]).toMatchObject({ status: 'rejected', code: 'not_your_loan' });
  });

  it('rejects a phone clock that is in the future or more than 7 days old', async () => {
    const rahul = await login('rahul@demo.in');
    const res = (
      await rahul.post('/api/sync/attempts').send({
        items: [
          attempt({ occurredAt: new Date(NOW.getTime() + 60 * 60_000).toISOString() }),
          attempt({ occurredAt: new Date(NOW.getTime() - 8 * 864e5).toISOString() }),
        ],
      })
    ).body as SyncResponse;
    expect(res.results.map((r) => r.code)).toEqual(['future_time', 'too_old']);
  });
});

describe('8 am - 7 pm contact block', () => {
  it('stores an attempt made at 7:30 pm as blocked and applies no outcome', async () => {
    const rahul = await login('rahul@demo.in');
    const item = attempt({
      outcome: 'promise',
      amount: 5000,
      promiseDate: '2026-11-10',
      occurredAt: istInstant('2026-11-08', 19, 30).toISOString(),
    });
    const res = (await rahul.post('/api/sync/attempts').send({ items: [item] })).body as SyncResponse;
    expect(res.results[0]).toMatchObject({ status: 'blocked', code: 'outside_contact_window' });
    const row = db.prepare('SELECT status, outcome FROM attempts WHERE id = ?').get(item.id) as { status: string; outcome: string | null };
    expect(row).toEqual({ status: 'blocked', outcome: null });
    const promise = db.prepare('SELECT 1 FROM promises WHERE attempt_id = ?').get(item.id);
    expect(promise).toBeUndefined();
  });

  it('records a blocked call tap (no outcome) for audit', async () => {
    const rahul = await login('rahul@demo.in');
    const item = attempt({ kind: 'call', outcome: null, note: null, occurredAt: istInstant('2026-11-09', 7, 40).toISOString() });
    const res = (await rahul.post('/api/sync/attempts').send({ items: [item] })).body as SyncResponse;
    expect(res.results[0].status).toBe('blocked');
  });

  it('blocks borrower reminders outside the window', async () => {
    vi.setSystemTime(istInstant('2026-11-09', 20, 0));
    const rahul = await login('rahul@demo.in');
    const draft = await rahul.post('/api/loans/LN-10293/messages/draft').send({ templateId: 'due-en' });
    expect(draft.body.ok).toBe(true);
    const sent = await rahul.post('/api/loans/LN-10293/messages').send({ templateId: 'due-en', body: draft.body.body });
    expect(sent.body.status).toBe('blocked');
    expect(sent.body.reason).toMatch(/8 am and 7 pm/);
  });

  it('blocks threatening language even if the officer edits the draft', async () => {
    const rahul = await login('rahul@demo.in');
    const sent = await rahul.post('/api/loans/LN-10293/messages').send({ templateId: 'due-en', body: 'Pay today or police will come' });
    expect(sent.body.status).toBe('blocked');
  });
});

describe('CSV import', () => {
  const header = 'loan_id,borrower_name,business_type,phone,address,pincode,outstanding,emi,dpd,last_payment_date,paid_last_3m';

  it('rejects a file with missing columns', async () => {
    const kavita = await login('manager.indore@demo.in');
    const res = await kavita.post('/api/imports/preview').send({ filename: 'bad.csv', csv: 'loan_id,dpd\nLN-1,3' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('missing_columns');
  });

  it('reports bad rows by row number and still previews the good ones', async () => {
    const kavita = await login('manager.indore@demo.in');
    const csv = [
      header,
      'LN-19001,Test Traders (hardware),Hardware,+91 90000 19001,"5, MG Road, Indore",452010,250000,11000,7,2026-10-20,22000',
      'LN-19002,Bad Pincode,Hardware,+91 90000 19002,"6, MG Road, Indore",4520,250000,11000,7,2026-10-20,22000',
      'LN-19003,Bad DPD,Hardware,+91 90000 19003,"7, MG Road, Indore",452010,250000,11000,45,2026-10-20,22000',
      'LN-19004,Pithampur Loan,Hardware,+91 90000 19004,"8, Sector 3",454775,250000,11000,5,2026-10-20,22000',
    ].join('\n');
    const res = await kavita.post('/api/imports/preview').send({ filename: 't.csv', csv });
    expect(res.status).toBe(200);
    const p = res.body as ImportPreview;
    expect(p.validRows).toBe(1);
    expect(p.errors.map((e) => [e.row, e.field])).toEqual([
      [3, 'pincode'],
      [4, 'dpd'],
      [5, 'pincode'], // belongs to another branch
    ]);
    expect(p.assignments[0]).toMatchObject({ loanId: 'LN-19001', rule: 'pincode_least_load' });
  });

  it('the sample file round-trips: keeps officers, assigns new loans, closes cured ones', async () => {
    const kavita = await login('manager.indore@demo.in');
    const sample = await kavita.get('/api/imports/sample.csv');
    expect(sample.status).toBe(200);
    const preview = (await kavita.post('/api/imports/preview').send({ filename: 's.csv', csv: sample.text })).body as ImportPreview;
    expect(preview.errors.length).toBe(2); // the two deliberately broken rows
    expect(preview.newLoans).toBe(6);
    expect(preview.curedLoans).toBeGreaterThan(0);
    expect(preview.assignments.filter((a) => a.rule === 'kept').length).toBeGreaterThan(50);
    const commit = await kavita.post('/api/imports/commit').send({ filename: 's.csv', csv: sample.text });
    expect(commit.status).toBe(200);
    expect(commit.body.imported).toBe(preview.validRows);
    const pithampurLoans = db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE branch_id = 'PTP' AND status = 'open'`).get() as { n: number };
    expect(pithampurLoans.n).toBeGreaterThan(0); // other branches untouched
  });
});

describe('unassigned loans', () => {
  it('lists loans with no officer and lets the manager assign one', async () => {
    const kavita = await login('manager.indore@demo.in');
    const list = (await kavita.get('/api/team/unassigned/list')).body as TodayResponse;
    expect(list.loans.map((l) => l.id)).toContain('LN-13901');
    expect((await kavita.post('/api/loans/LN-13901/reassign').send({ officerId: 'u-pooja' })).status).toBe(200);
    const after = (await kavita.get('/api/team/unassigned/list')).body as TodayResponse;
    expect(after.loans.map((l) => l.id)).not.toContain('LN-13901');
  });

  it('cannot assign to an officer in another branch', async () => {
    const head = await login('head@demo.in');
    const res = await head.post('/api/loans/LN-10293/reassign').send({ officerId: 'u-arjun' });
    expect(res.status).toBe(422);
  });
});

describe('dashboards', () => {
  it('returns monthly roll rates by branch near the 22% baseline', async () => {
    const head = await login('head@demo.in');
    const res = await head.get('/api/dashboard/roll-rates');
    expect(res.status).toBe(200);
    expect(res.body.branches).toHaveLength(3);
    const overall = res.body.overall as { rate: number }[];
    expect(overall).toHaveLength(6);
    for (const m of overall) expect(m.rate).toBeGreaterThan(0.18);
  });

  it('a branch manager sees only their branch', async () => {
    const kavita = await login('manager.indore@demo.in');
    const res = await kavita.get('/api/dashboard/roll-rates');
    expect(res.body.branches.map((b: { branchId: string }) => b.branchId)).toEqual(['IND']);
  });

  it('back-test shows the model beats random on months it never saw', async () => {
    const head = await login('head@demo.in');
    const res = await head.get('/api/dashboard/backtest');
    expect(res.body.auc).toBeGreaterThan(0.7);
    expect(res.body.topFifthCapture).toBeGreaterThan(0.35); // random would catch 20%
    expect(res.body.testMonths).toHaveLength(2);
  });
});

describe('demo clock', () => {
  it('moves server time into the contact window and back', async () => {
    vi.setSystemTime(istInstant('2026-11-09', 22, 0));
    const rahul = await login('rahul@demo.in');
    const set = await rahul.post('/api/clock').send({ mode: 'demo', istTime: '11:00' });
    expect(set.body.demoActive).toBe(true);
    expect(new Date(set.body.now).toISOString()).toBe(istInstant('2026-11-09', 11).toISOString());
    const reset = await rahul.post('/api/clock').send({ mode: 'real' });
    expect(reset.body.demoActive).toBe(false);
  });
});
