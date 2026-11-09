// Demo data. Everything here is synthetic: business names, phone numbers (+91 90000 xxxxx)
// and locations are made up. The three sample loans from the brief are included as given.
//
// The seed also builds six months of month-start "1-30 DPD bucket" history with known outcomes,
// trains the scoring model on the first four months and back-tests it on the last two.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDb, type DB } from './db';
import { hashPassword } from './auth';
import { pincodeCentroid } from './geo';
import { mulberry32, gaussian, pick } from '../shared/random';
import { addDays, istDate, istInstant, istMonth, isContactAllowed } from '../shared/time';
import { auc, calibration, extractFeatures, predict, topShareCapture, trainLogistic, type FeatureInput } from '../shared/scoring';
import { rescore, resetModelCache } from './services/scoring';

export const DEMO_PASSWORD = 'Demo@1234';

const BRANCHES = [
  { id: 'IND', name: 'Indore City' },
  { id: 'PTP', name: 'Pithampur' },
  { id: 'DEW', name: 'Dewas' },
];

const OFFICERS = [
  { id: 'u-rahul', name: 'Rahul Chouhan', email: 'rahul@demo.in', branch: 'IND', pins: ['452001', '452002', '452007'], loans: 28, lang: 'hi' },
  { id: 'u-neha', name: 'Neha Solanki', email: 'neha@demo.in', branch: 'IND', pins: ['452010', '452011', '452016'], loans: 27, lang: 'en' },
  { id: 'u-imran', name: 'Imran Qureshi', email: 'imran@demo.in', branch: 'IND', pins: ['452015', '452005', '452006'], loans: 26, lang: 'en' },
  { id: 'u-pooja', name: 'Pooja Verma', email: 'pooja@demo.in', branch: 'IND', pins: ['452003', '452009', '452012', '452018'], loans: 25, lang: 'hi' },
  { id: 'u-arjun', name: 'Arjun Malviya', email: 'arjun@demo.in', branch: 'PTP', pins: ['454775'], loans: 26, lang: 'hi' },
  { id: 'u-sana', name: 'Sana Sheikh', email: 'sana@demo.in', branch: 'PTP', pins: ['454774', '454775'], loans: 24, lang: 'en' },
  { id: 'u-vikram', name: 'Vikram Rathore', email: 'vikram@demo.in', branch: 'DEW', pins: ['455001'], loans: 25, lang: 'hi' },
  { id: 'u-meena', name: 'Meena Patidar', email: 'meena@demo.in', branch: 'DEW', pins: ['455001', '455111'], loans: 23, lang: 'hi' },
] as const;

const MANAGERS = [
  { id: 'u-kavita', name: 'Kavita Jain', email: 'manager.indore@demo.in', role: 'manager', branch: 'IND' },
  { id: 'u-suresh', name: 'Suresh Yadav', email: 'manager.pithampur@demo.in', role: 'manager', branch: 'PTP' },
  { id: 'u-farida', name: 'Farida Khan', email: 'manager.dewas@demo.in', role: 'manager', branch: 'DEW' },
  { id: 'u-anil', name: 'Anil Mehta', email: 'head@demo.in', role: 'head', branch: null },
] as const;

// Monthly roll rates the history is built to (oldest first). Overall about 22%, as in the brief.
const TARGET_RATES: Record<string, number[]> = {
  IND: [0.215, 0.225, 0.21, 0.205, 0.2, 0.195],
  PTP: [0.25, 0.245, 0.26, 0.24, 0.235, 0.245],
  DEW: [0.22, 0.235, 0.215, 0.225, 0.22, 0.21],
};

const PREFIXES = ['Malwa', 'Ahilya', 'Narmada', 'Kshipra', 'Vindhya', 'Shree Sai', 'Rajwada', 'Holkar', 'Sanwer', 'Annapurna', 'Gomti', 'Mahakal', 'Satpura', 'Chambal', 'Navrang', 'Prakash', 'Saraswati', 'Omkar'];
// [key, what the business does, name endings]. Names are built as "<prefix> <ending>",
// e.g. "Narmada Masala Udyog", the way small Indore businesses are usually named.
const TYPES = [
  ['Packaging', 'Packaging unit', ['Packaging Works', 'Packers', 'Poly Packs']],
  ['Fertiliser', 'Fertiliser shop', ['Krishi Kendra', 'Fertilisers', 'Agro Agency']],
  ['Printing', 'Printing press', ['Printers', 'Offset Press', 'Graphics']],
  ['Auto parts', 'Auto parts dealer', ['Auto Parts', 'Auto Components', 'Motors']],
  ['Garments', 'Garment unit', ['Garments', 'Apparels', 'Fashions']],
  ['Spices', 'Spice trader', ['Masala Udyog', 'Spices', 'Traders']],
  ['Plastics', 'Plastic moulding', ['Plastics', 'Polymers', 'Moulders']],
  ['Hardware', 'Hardware store', ['Hardware', 'Iron Store', 'Sanitary Mart']],
  ['Namkeen', 'Namkeen maker', ['Namkeen', 'Foods', 'Snacks']],
  ['Furniture', 'Furniture workshop', ['Furniture', 'Wood Works', 'Interiors']],
  ['Electricals', 'Electrical traders', ['Electricals', 'Electric Co.', 'Switchgear']],
  ['Textiles', 'Textile trader', ['Textiles', 'Cloth Store', 'Fabrics']],
] as const;

// Ground truth used only to generate history. The model never sees these weights.
function trueLogit(x: ReturnType<typeof extractFeatures>['values']): number {
  const paid = Number.isFinite(x.paidRatio3m) ? x.paidRatio3m : 0.6;
  const since = Number.isFinite(x.daysSincePayment) ? x.daysSincePayment : 40;
  return (
    0.1 * (x.dpd - 15) +
    0.8 * x.nearRoll +
    0.6 * x.brokenPromises -
    1.8 * (paid - 0.6) +
    0.015 * (since - 35) +
    0.25 * x.logOutstanding -
    1.0 * x.openPromise
  );
}

interface LoanDraft {
  dpd: number;
  outstanding: number;
  emi: number;
  paidLast3m: number | null;
  lastPaymentDate: string | null;
}

/** Correlated loan fields from a latent risk value. */
function drawLoan(rng: () => number, asOf: string, risk: number, allowMissing: boolean): LoanDraft {
  const dpd = Math.max(1, Math.min(30, Math.round(12 + risk * 7 + gaussian(rng) * 6)));
  const outstanding = Math.round(Math.exp(Math.log(280_000) + gaussian(rng) * 0.6) / 1000) * 1000;
  const clampedOut = Math.max(60_000, Math.min(1_400_000, outstanding));
  const emi = Math.round(clampedOut / 22 / 500) * 500;
  const paidRatio = Math.max(0, Math.min(1.1, 0.62 - risk * 0.22 + gaussian(rng) * 0.15));
  const missing = allowMissing && rng() < 0.07;
  const lastPaidDaysAgo = dpd + Math.max(0, Math.round(8 + risk * 6 + gaussian(rng) * 6));
  return {
    dpd,
    outstanding: clampedOut,
    emi,
    paidLast3m: missing ? null : Math.round((paidRatio * 3 * emi) / 500) * 500,
    lastPaymentDate: missing ? null : addDays(asOf, -lastPaidDaysAgo),
  };
}

/** Find c so that the mean of sigmoid(z + c) hits the target rate. */
function calibrateOffset(z: number[], target: number): number {
  let lo = -10;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const mean = z.reduce((a, v) => a + 1 / (1 + Math.exp(-(v + mid))), 0) / z.length;
    if (mean < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function monthsBefore(month: string, n: number): string[] {
  const [y, m] = month.split('-').map(Number);
  const out: string[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export function seed(db: DB, opts: { now: Date; rngSeed?: number }) {
  // Separate random streams, so the model and its back-test come out the same whatever
  // time of day the seed runs (only the demo activity depends on the current time).
  const base = opts.rngSeed ?? 99;
  const rngLoans = mulberry32(base);
  const rngActivity = mulberry32(base + 1);
  const rngHistory = mulberry32(base + 2);
  const now = opts.now;
  const today = istDate(now);
  const ts = now.toISOString();
  const passwordHash = hashPassword(DEMO_PASSWORD);

  db.transaction(() => {
    // ---------- org ----------
    const insBranch = db.prepare('INSERT INTO branches (id, name) VALUES (?, ?)');
    BRANCHES.forEach((b) => insBranch.run(b.id, b.name));
    const insUser = db.prepare(
      'INSERT INTO users (id, name, email, password_hash, role, branch_id, lang, cap) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insPin = db.prepare('INSERT INTO officer_pincodes (officer_id, pincode) VALUES (?, ?)');
    for (const o of OFFICERS) {
      insUser.run(o.id, o.name, o.email, passwordHash, 'officer', o.branch, o.lang, 40);
      o.pins.forEach((p) => insPin.run(o.id, p));
    }
    for (const m of MANAGERS) insUser.run(m.id, m.name, m.email, passwordHash, m.role, m.branch, 'en', 0);

    // ---------- reminder templates (approved wording) ----------
    const insTpl = db.prepare('INSERT INTO templates (id, name, lang, audience, body) VALUES (?, ?, ?, ?, ?)');
    insTpl.run('due-en', 'Payment due reminder', 'en', 'borrower',
      'Namaste {{borrower}}. A reminder from Company A that ₹{{amount}} on loan {{loanId}} is due on {{date}}. If you have already paid, please ignore this message. For help, call your officer {{officer}}.');
    insTpl.run('due-hi', 'भुगतान याद दिलाना', 'hi', 'borrower',
      'नमस्ते {{borrower}}। Company A की ओर से याद दिला रहे हैं कि ऋण {{loanId}} पर ₹{{amount}} की राशि {{date}} को देय है। अगर आप भुगतान कर चुके हैं तो कृपया इस संदेश को अनदेखा करें। मदद के लिए अपने अधिकारी {{officer}} से बात करें।');
    insTpl.run('promise-en', 'Promise confirmation', 'en', 'borrower',
      'Thank you {{borrower}} for agreeing to pay ₹{{amount}} on {{date}} for loan {{loanId}}. If anything changes, please let us know. – Company A');
    insTpl.run('promise-hi', 'वादे की पुष्टि', 'hi', 'borrower',
      'धन्यवाद {{borrower}}, ऋण {{loanId}} के लिए {{date}} को ₹{{amount}} भरने की सहमति के लिए। कोई बदलाव हो तो हमें बताएं। – Company A');
    insTpl.run('officer-en', 'Officer follow-up', 'en', 'officer',
      'Follow up: {{borrower}} ({{loanId}}) promised ₹{{amount}} on {{date}}. Please check in today.');
    insTpl.run('officer-hi', 'अधिकारी फ़ॉलो-अप', 'hi', 'officer',
      'फ़ॉलो-अप: {{borrower}} ({{loanId}}) ने {{date}} को ₹{{amount}} का वादा किया है। आज संपर्क करें।');

    // ---------- live loans ----------
    const insLoan = db.prepare(
      `INSERT INTO loans (id, borrower_name, business_type, phone, address, pincode, lat, lng, branch_id, outstanding, emi, dpd,
         last_payment_date, paid_last_3m, officer_id, status, updated_at)
       VALUES (@id, @borrower_name, @business_type, @phone, @address, @pincode, @lat, @lng, @branch_id, @outstanding, @emi, @dpd,
         @last_payment_date, @paid_last_3m, @officer_id, 'open', @updated_at)`,
    );
    const usedIds = new Set<string>(['LN-10293', 'LN-10871', 'LN-11930']);
    const usedNames = new Set<string>();
    const loansByOfficer = new Map<string, { id: string; lat: number; lng: number; emi: number; risk: number }[]>();

    const addLoan = (o: (typeof OFFICERS)[number], fixed?: Partial<Record<string, unknown>> & { id: string }) => {
      const risk = gaussian(rngLoans);
      const d = drawLoan(rngLoans, today, risk, true);
      const pin = (fixed?.pincode as string) ?? pick(rngLoans, o.pins);
      const geo = pincodeCentroid(pin)!;
      let name = '';
      let prefix = '';
      let type: (typeof TYPES)[number] = pick(rngLoans, TYPES);
      do {
        type = pick(rngLoans, TYPES);
        prefix = pick(rngLoans, PREFIXES);
        name = `${prefix} ${type[0]}`;
      } while (usedNames.has(name));
      usedNames.add(name);
      // The ending is derived (not drawn), so the random sequence and the scores stay the same.
      const displayName = `${prefix} ${type[2][PREFIXES.indexOf(prefix) % type[2].length]}`;
      let id = fixed?.id;
      while (!id || (usedIds.has(id) && !fixed)) {
        id = `LN-${10000 + Math.floor(rngLoans() * 4000)}`;
        if (usedIds.has(id)) id = undefined;
      }
      usedIds.add(id);
      const lat = geo.lat + (rngLoans() - 0.5) * 0.02;
      const lng = geo.lng + (rngLoans() - 0.5) * 0.02;
      const row = {
        id,
        borrower_name: displayName,
        business_type: type[1],
        phone: `+91 90000 ${id.slice(3).padStart(5, '0')}`,
        address: `${1 + Math.floor(rngLoans() * 180)}, ${geo.area}, ${o.branch === 'IND' ? 'Indore' : o.branch === 'PTP' ? 'Pithampur' : 'Dewas'}`,
        pincode: pin,
        lat,
        lng,
        branch_id: o.branch,
        outstanding: d.outstanding,
        emi: d.emi,
        dpd: d.dpd,
        last_payment_date: d.lastPaymentDate,
        paid_last_3m: d.paidLast3m,
        officer_id: o.id,
        updated_at: ts,
        ...fixed,
      };
      insLoan.run(row);
      const list = loansByOfficer.get(o.id) ?? [];
      list.push({ id, lat, lng, emi: row.emi as number, risk });
      loansByOfficer.set(o.id, list);
    };

    const officer = (id: string) => OFFICERS.find((o) => o.id === id)!;
    // The three sample rows from the brief, as given.
    addLoan(officer('u-rahul'), {
      id: 'LN-10293', borrower_name: 'Company B (packaging unit)', business_type: 'Packaging unit', outstanding: 640000, dpd: 12,
      emi: 28000, paid_last_3m: 56000, last_payment_date: addDays(today, -24), pincode: '452001',
      address: '14, Rajwada, Indore',
    });
    addLoan(officer('u-neha'), {
      id: 'LN-10871', borrower_name: 'Company C (fertiliser shop)', business_type: 'Fertiliser shop', outstanding: 310000, dpd: 27,
      emi: 14000, paid_last_3m: 14000, last_payment_date: addDays(today, -52), pincode: '452010',
      address: '7, Vijay Nagar, Indore',
    });
    addLoan(officer('u-imran'), {
      id: 'LN-11930', borrower_name: 'Company D (printing press)', business_type: 'Printing press', outstanding: 220000, dpd: 19,
      emi: 10000, paid_last_3m: 20000, last_payment_date: addDays(today, -33), pincode: '452015',
      address: 'Plot 22, Sanwer Road Sector F, Indore',
    });
    for (const o of OFFICERS) {
      const have = loansByOfficer.get(o.id)?.length ?? 0;
      for (let i = have; i < o.loans; i++) addLoan(o);
    }
    // Two loans in an uncovered pincode, waiting for manual assignment.
    insLoan.run({
      id: 'LN-13901', borrower_name: 'Satpura Ceramics', business_type: 'Tile dealer', phone: '+91 90000 13901',
      address: '3, Mhow Road, Indore', pincode: '453441', lat: 22.5536, lng: 75.7637, branch_id: 'IND', outstanding: 410000,
      emi: 18500, dpd: 9, last_payment_date: addDays(today, -21), paid_last_3m: 37000, officer_id: null, updated_at: ts,
    });

    // ---------- promises and attempts over the last 7 days ----------
    const insAttempt = db.prepare(
      `INSERT INTO attempts (id, loan_id, officer_id, kind, outcome, status, amount, promise_date, note, lat, lng, accuracy_m, occurred_at, received_at, created_offline)
       VALUES (@id, @loan_id, @officer_id, @kind, @outcome, @status, @amount, @promise_date, @note, @lat, @lng, @accuracy_m, @occurred_at, @received_at, @created_offline)`,
    );
    const insPromise = db.prepare(
      `INSERT INTO promises (id, loan_id, officer_id, amount, promise_date, created_at, kept_at, superseded, attempt_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    );
    const notes = {
      not_reachable: ['Shop shutter down', 'Phone switched off', 'Owner travelling, staff unaware', 'No answer, tried twice'],
      dispute: ['Says EMI was paid by NEFT on 2 Nov, asked for statement', 'Disputes late fee amount', 'Claims insurance should cover the instalment'],
    };
    for (const o of OFFICERS) {
      const loans = loansByOfficer.get(o.id)!;
      const promised = new Set<string>();
      for (let back = 7; back >= 0; back--) {
        const day = addDays(today, -back);
        if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) continue; // Sunday off
        const count = back === 0 ? 5 + Math.floor(rngActivity() * 4) : 7 + Math.floor(rngActivity() * 6);
        const order = [...loans].sort(() => rngActivity() - 0.5).slice(0, count);
        let minute = 9 * 60 + 15 + Math.floor(rngActivity() * 30);
        for (const loan of order) {
          minute += 25 + Math.floor(rngActivity() * 35);
          if (minute > 18 * 60 + 40) break;
          const at = istInstant(day, Math.floor(minute / 60), minute % 60);
          if (at.getTime() > now.getTime()) break;
          const kind = rngActivity() < 0.6 ? 'visit' : 'call';
          const r = rngActivity();
          let outcome: 'paid' | 'promise' | 'not_reachable' | 'dispute' =
            r < 0.2 ? 'paid' : r < 0.52 ? 'promise' : r < 0.94 ? 'not_reachable' : 'dispute';
          if (outcome === 'promise' && promised.has(loan.id)) outcome = 'not_reachable';
          const offline = rngActivity() < 0.22;
          const lateSync = offline && rngActivity() < 0.3;
          const receivedAt = lateSync
            ? istInstant(addDays(day, 1), 8, 5 + Math.floor(rngActivity() * 50))
            : new Date(at.getTime() + (offline ? (40 + rngActivity() * 200) * 60_000 : 3_000 + rngActivity() * 8_000));
          const farAway = rngActivity() < 0.1;
          const jitter = farAway ? 0.02 : 0.0018;
          const id = crypto.randomUUID();
          let amount: number | null = null;
          let promiseDate: string | null = null;
          if (outcome === 'paid') amount = Math.round((loan.emi * (0.5 + rngActivity() * 0.5)) / 500) * 500;
          if (outcome === 'promise') {
            amount = loan.emi;
            promiseDate = addDays(day, 1 + Math.floor(rngActivity() * 6));
          }
          insAttempt.run({
            id,
            loan_id: loan.id,
            officer_id: o.id,
            kind,
            outcome,
            status: 'accepted',
            amount,
            promise_date: promiseDate,
            note: outcome === 'not_reachable' || outcome === 'dispute' ? pick(rngActivity, notes[outcome]) : null,
            lat: kind === 'visit' ? loan.lat + (rngActivity() - 0.5) * jitter : null,
            lng: kind === 'visit' ? loan.lng + (rngActivity() - 0.5) * jitter : null,
            accuracy_m: kind === 'visit' ? Math.round(8 + rngActivity() * 30) : null,
            occurred_at: at.toISOString(),
            received_at: (receivedAt.getTime() > now.getTime() ? now : receivedAt).toISOString(),
            created_offline: offline ? 1 : 0,
          });
          if (outcome === 'promise' && promiseDate) {
            promised.add(loan.id);
            // Lower-risk borrowers keep promises more often.
            const keeps = promiseDate < today && rngActivity() < 0.55 - loan.risk * 0.15;
            insPromise.run(crypto.randomUUID(), loan.id, o.id, amount, promiseDate, at.toISOString(),
              keeps ? istInstant(promiseDate, 12).toISOString() : null, id);
          }
        }
        // An occasional blocked attempt after hours, kept for audit.
        if (back > 0 && rngActivity() < 0.18) {
          const loan = pick(rngActivity, loans);
          const at = istInstant(day, 19, 10 + Math.floor(rngActivity() * 40));
          if (!isContactAllowed(at)) {
            insAttempt.run({
              id: crypto.randomUUID(), loan_id: loan.id, officer_id: o.id, kind: 'call', outcome: null, status: 'blocked',
              amount: null, promise_date: null, note: null, lat: null, lng: null, accuracy_m: null,
              occurred_at: at.toISOString(), received_at: at.toISOString(), created_offline: 0,
            });
          }
        }
      }
    }
    // Sample promises from the brief: LN-10293 promised for 5 Nov (kept, assumption), LN-11930 for 31 Oct (broken).
    insPromise.run(crypto.randomUUID(), 'LN-10293', 'u-rahul', 28000, '2026-11-05', istInstant('2026-11-02', 11).toISOString(), istInstant('2026-11-05', 15).toISOString(), null);
    insPromise.run(crypto.randomUUID(), 'LN-11930', 'u-imran', 10000, '2026-10-31', istInstant('2026-10-27', 12).toISOString(), null, null);

    // A couple of reminders already sent.
    const insMsg = db.prepare(
      `INSERT INTO messages (id, loan_id, template_id, audience, lang, body, status, reason, created_at, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insMsg.run(crypto.randomUUID(), 'LN-11930', 'due-hi', 'borrower', 'hi',
      'नमस्ते Company D (printing press)। Company A की ओर से याद दिला रहे हैं कि ऋण LN-11930 पर ₹10,000 की राशि 31 Oct को देय है। अगर आप भुगतान कर चुके हैं तो कृपया इस संदेश को अनदेखा करें। मदद के लिए अपने अधिकारी Imran Qureshi से बात करें।',
      'sent_mock', null, istInstant('2026-10-30', 10, 5).toISOString(), 'u-imran');

    // ---------- 6 months of bucket history with outcomes ----------
    const months = monthsBefore(istMonth(now), 6);
    const insHist = db.prepare(
      `INSERT INTO bucket_history (loan_id, branch_id, month, dpd, outstanding, emi, paid_last_3m, last_payment_date, broken_promises_90d, open_promise_date, rolled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let histId = 30000;
    const training: { month: string; input: FeatureInput; y: number }[] = [];
    for (const b of BRANCHES) {
      const size = OFFICERS.filter((o) => o.branch === b.id).reduce((a, o) => a + o.loans, 0);
      months.forEach((month, mi) => {
        const asOf = `${month}-01`;
        const n = Math.round(size * (1.3 + rngHistory() * 0.3));
        const obs = Array.from({ length: n }, () => {
          const risk = gaussian(rngHistory);
          const d = drawLoan(rngHistory, asOf, risk, false);
          const broken = rngHistory() < 0.12 + Math.max(0, risk) * 0.12 ? 1 + (rngHistory() < 0.3 ? 1 : 0) : 0;
          const openPromise = rngHistory() < 0.18 - Math.max(0, risk) * 0.06 ? addDays(asOf, 1 + Math.floor(rngHistory() * 6)) : null;
          const input: FeatureInput = {
            dpd: d.dpd, outstanding: d.outstanding, emi: d.emi, paidLast3m: d.paidLast3m, lastPaymentDate: d.lastPaymentDate,
            brokenPromises90d: broken, openPromiseDate: openPromise, asOf,
          };
          return { input, z: trueLogit(extractFeatures(input).values) + gaussian(rngHistory) * 0.5 };
        });
        // Pick exactly target x n loans to roll, weighted by their true risk, so each month's
        // rate matches the plan while riskier loans are still the ones that roll.
        const c = calibrateOffset(obs.map((o) => o.z), TARGET_RATES[b.id][mi]);
        const k = Math.round(TARGET_RATES[b.id][mi] * n);
        const keyed = obs.map((o, i) => ({ i, key: Math.pow(rngHistory(), 1 / (1 / (1 + Math.exp(-(o.z + c))))) }));
        const rolled = new Set(keyed.sort((a, b2) => b2.key - a.key).slice(0, k).map((x) => x.i));
        obs.forEach((o, i) => {
          const y = rolled.has(i) ? 1 : 0;
          insHist.run(`LN-${histId++}`, b.id, month, o.input.dpd, o.input.outstanding, o.input.emi, o.input.paidLast3m,
            o.input.lastPaymentDate, o.input.brokenPromises90d, o.input.openPromiseDate, y);
          training.push({ month, input: o.input, y });
        });
      });
    }

    // ---------- train on the first four months, back-test on the last two ----------
    const trainMonths = months.slice(0, 4);
    const testMonths = months.slice(4);
    const version = `lr-${istMonth(now)}-1`;
    const model = trainLogistic(
      training.filter((t) => trainMonths.includes(t.month)).map((t) => ({ x: extractFeatures(t.input).values, y: t.y })),
      { version, trainedAt: ts },
    );
    const test = training.filter((t) => testMonths.includes(t.month)).map((t) => ({ p: predict(model, extractFeatures(t.input).values), y: t.y }));
    const backtest = {
      trainMonths,
      testMonths,
      testCount: test.length,
      auc: auc(test),
      topFifthCapture: topShareCapture(test, 0.2),
      calibration: calibration(test),
    };
    db.prepare('INSERT INTO models (version, trained_at, body, backtest, active) VALUES (?, ?, ?, ?, 1)').run(
      version, ts, JSON.stringify(model), JSON.stringify(backtest),
    );

    // ---------- this morning's import record ----------
    const importAt = istInstant(today, 7, 45);
    db.prepare(
      `INSERT INTO imports (id, filename, uploaded_by, created_at, rows_total, rows_ok, rows_error, errors) VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`,
    ).run(crypto.randomUUID(), `overdue-${today}.csv`, 'u-kavita', (importAt < now ? importAt : now).toISOString(), 107, 107, 0);
  })();

  resetModelCache();
  rescore(db, now);
}

// CLI: `npm run seed` wipes the database file and loads fresh demo data.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.env.DATABASE_PATH ?? './data/collect.db';
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  const db = openDb(file);
  const started = Date.now();
  seed(db, { now: new Date() });
  const bt = JSON.parse((db.prepare('SELECT backtest FROM models WHERE active = 1').get() as { backtest: string }).backtest);
  const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM loans) AS loans, (SELECT COUNT(*) FROM attempts) AS attempts, (SELECT COUNT(*) FROM promises) AS promises, (SELECT COUNT(*) FROM bucket_history) AS history`).get();
  console.log(`Seeded ${file} in ${Date.now() - started} ms`, counts, `back-test AUC ${bt.auc.toFixed(3)}, top-20% capture ${(bt.topFifthCapture * 100).toFixed(0)}%`);
  console.log(`Demo password for every account: ${DEMO_PASSWORD}`);
}
