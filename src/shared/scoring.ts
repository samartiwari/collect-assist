// Priority scoring: a logistic regression that estimates the chance a loan in the
// 1-30 DPD bucket rolls into 31-60 DPD by the next month-end snapshot.
//
// Why logistic regression: the brief asks for a score *with reasons*. A linear model
// gives every feature a signed weight, so each reason is an exact share of the score,
// not a post-hoc guess. It trains in milliseconds on the history we hold, and an
// officer or manager can sanity-check it.
import type { LoanScore, ScoreReason } from './types';
import { daysBetween } from './time';

// From the brief: 20% of rolled loans turn NPA, with 35% loss on those.
export const NPA_RATE = 0.2;
export const LOSS_GIVEN_NPA = 0.35;

export interface FeatureInput {
  dpd: number;
  outstanding: number;
  emi: number;
  paidLast3m: number | null;
  lastPaymentDate: string | null;
  brokenPromises90d: number;
  openPromiseDate: string | null;
  asOf: string; // IST date the score is for
}

export type FeatureName =
  | 'dpd'
  | 'nearRoll'
  | 'brokenPromises'
  | 'paidRatio3m'
  | 'daysSincePayment'
  | 'logOutstanding'
  | 'openPromise';

export const FEATURES: { name: FeatureName; label: string }[] = [
  { name: 'dpd', label: 'Days past due' },
  { name: 'nearRoll', label: 'Within 10 days of 31 DPD' },
  { name: 'brokenPromises', label: 'Broken promises (90 days)' },
  { name: 'paidRatio3m', label: 'Share of dues paid (3 months)' },
  { name: 'daysSincePayment', label: 'Days since last payment' },
  { name: 'logOutstanding', label: 'Outstanding balance (log)' },
  { name: 'openPromise', label: 'Has an open promise to pay' },
];

export type FeatureVector = Record<FeatureName, number>;

export interface ExtractedFeatures {
  values: FeatureVector;
  missing: FeatureName[]; // filled with the training mean, lowers confidence
}

export function extractFeatures(input: FeatureInput): ExtractedFeatures {
  const missing: FeatureName[] = [];
  let paidRatio = NaN;
  if (input.emi > 0 && input.paidLast3m !== null) {
    paidRatio = Math.min(1.5, Math.max(0, input.paidLast3m / (3 * input.emi)));
  } else {
    missing.push('paidRatio3m');
  }
  let daysSince = NaN;
  if (input.lastPaymentDate) {
    daysSince = Math.max(0, Math.min(180, daysBetween(input.lastPaymentDate, input.asOf)));
  } else {
    missing.push('daysSincePayment');
  }
  const openPromise = input.openPromiseDate !== null && input.openPromiseDate >= input.asOf ? 1 : 0;
  return {
    values: {
      dpd: input.dpd,
      nearRoll: input.dpd >= 21 ? 1 : 0,
      brokenPromises: Math.min(input.brokenPromises90d, 5),
      paidRatio3m: paidRatio,
      daysSincePayment: daysSince,
      logOutstanding: Math.log(Math.max(input.outstanding, 1_000) / 100_000),
      openPromise,
    },
    missing,
  };
}

export interface Model {
  version: string;
  trainedAt: string;
  bias: number;
  weights: { feature: FeatureName; label: string; weight: number }[]; // on standardised features
  means: FeatureVector;
  stds: FeatureVector;
}

function standardise(model: Pick<Model, 'means' | 'stds'>, x: FeatureVector): number[] {
  return FEATURES.map(({ name }) => {
    const v = Number.isFinite(x[name]) ? x[name] : model.means[name];
    return (v - model.means[name]) / model.stds[name];
  });
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * Batch gradient descent with L2 regularisation. Deterministic: same data, same model.
 * Missing values are filled with the column mean before training.
 */
export function trainLogistic(
  rows: { x: FeatureVector; y: number }[],
  opts: { version: string; iterations?: number; learningRate?: number; l2?: number; trainedAt?: string },
): Model {
  const iterations = opts.iterations ?? 600;
  const lr = opts.learningRate ?? 0.3;
  const l2 = opts.l2 ?? 0.01;
  const means = {} as FeatureVector;
  const stds = {} as FeatureVector;
  for (const { name } of FEATURES) {
    const vals = rows.map((r) => r.x[name]).filter(Number.isFinite);
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1);
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(vals.length, 1);
    means[name] = mean;
    stds[name] = Math.sqrt(variance) || 1;
  }
  const X = rows.map((r) => standardise({ means, stds }, r.x));
  const y = rows.map((r) => r.y);
  const n = rows.length;
  const w = new Array(FEATURES.length).fill(0);
  let b = 0;
  for (let it = 0; it < iterations; it++) {
    const gw = new Array(FEATURES.length).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < w.length; j++) z += w[j] * X[i][j];
      const err = sigmoid(z) - y[i];
      gb += err;
      for (let j = 0; j < w.length; j++) gw[j] += err * X[i][j];
    }
    b -= (lr * gb) / n;
    for (let j = 0; j < w.length; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
  }
  return {
    version: opts.version,
    trainedAt: opts.trainedAt ?? new Date().toISOString(),
    bias: b,
    weights: FEATURES.map((f, j) => ({ feature: f.name, label: f.label, weight: w[j] })),
    means,
    stds,
  };
}

export function predict(model: Model, x: FeatureVector): number {
  const z = standardise(model, x);
  return sigmoid(model.bias + model.weights.reduce((acc, w, j) => acc + w.weight * z[j], 0));
}

export function expectedLoss(probability: number, outstanding: number): number {
  return Math.round(probability * outstanding * NPA_RATE * LOSS_GIVEN_NPA);
}

// ---------- reasons ----------

const lakh = (n: number) => `₹${(n / 100_000).toFixed(1)} L`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (ymd: string | null) => (ymd ? `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}` : '');

function reasonText(code: string, dir: 'up' | 'down', input: FeatureInput, x: FeatureVector): [string, string] {
  switch (code) {
    case 'dpd': {
      const left = 31 - input.dpd;
      if (input.dpd >= 21)
        return [
          `${input.dpd} days overdue, rolls into 31+ in ${left} ${left === 1 ? 'day' : 'days'}`,
          `${input.dpd} दिन बकाया, ${left} दिन में 31+ में चला जाएगा`,
        ];
      return dir === 'up'
        ? [`${input.dpd} days overdue`, `${input.dpd} दिन से बकाया`]
        : [`Only ${input.dpd} days overdue`, `सिर्फ़ ${input.dpd} दिन से बकाया`];
    }
    case 'brokenPromises': {
      const n = input.brokenPromises90d;
      if (n === 0) return ['No broken promises in 3 months', '3 महीनों में कोई वादा नहीं टूटा'];
      return n === 1
        ? ['Broke a promise to pay in the last 3 months', 'पिछले 3 महीनों में एक वादा तोड़ा']
        : [`Broke ${n} promises to pay in the last 3 months`, `पिछले 3 महीनों में ${n} वादे तोड़े`];
    }
    case 'paidRatio3m': {
      const pct = Math.round(Math.min(x.paidRatio3m, 1) * 100);
      if (dir === 'up' && pct === 0) return ['Nothing paid in 3 months', '3 महीनों में कोई किस्त नहीं भरी'];
      if (dir === 'up') return [`Paid only ${pct}% of dues in 3 months`, `3 महीनों में सिर्फ़ ${pct}% किस्त भरी`];
      return pct >= 95
        ? ['Kept up with dues for 3 months', '3 महीनों से किस्त समय पर']
        : [`Paid ${pct}% of dues in 3 months`, `3 महीनों में ${pct}% किस्त भरी`];
    }
    case 'daysSincePayment': {
      const d = x.daysSincePayment;
      return dir === 'up'
        ? [`No payment in ${d} days`, `${d} दिन से कोई भुगतान नहीं`]
        : [`Last paid ${d} days ago`, `${d} दिन पहले भुगतान किया`];
    }
    case 'logOutstanding':
      return dir === 'up'
        ? [`Large balance of ${lakh(input.outstanding)}`, `बड़ी बकाया राशि ${lakh(input.outstanding)}`]
        : [`Small balance of ${lakh(input.outstanding)}`, `कम बकाया राशि ${lakh(input.outstanding)}`];
    case 'openPromise':
      return x.openPromise
        ? [`Promised to pay on ${shortDate(input.openPromiseDate)}`, `${shortDate(input.openPromiseDate)} को भुगतान का वादा`]
        : ['Has not promised a date yet', 'अभी तक भुगतान की तारीख़ नहीं दी'];
    default:
      return [code, code];
  }
}

/**
 * Per-feature contribution = weight x standardised value. DPD and the near-roll flag are
 * merged into one "dpd" reason because officers think of them as one fact.
 * The top three by absolute effect are shown, risk-raising ones first.
 */
function topReasons(model: Model, input: FeatureInput, x: FeatureVector, missing: FeatureName[]): ScoreReason[] {
  const z = standardise(model, x);
  const contrib = new Map<string, number>();
  model.weights.forEach((w, j) => {
    if (missing.includes(w.feature)) return; // never explain with a value we made up
    const code = w.feature === 'nearRoll' ? 'dpd' : w.feature;
    contrib.set(code, (contrib.get(code) ?? 0) + w.weight * z[j]);
  });
  const ranked = [...contrib.entries()]
    .filter(([, c]) => Math.abs(c) > 1e-6)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .sort((a, b) => b[1] - a[1]);
  return ranked.map(([code, c]) => {
    const direction = c > 0 ? 'up' : 'down';
    const [text, textHi] = reasonText(code, direction, input, x);
    return { code, text, textHi, direction };
  });
}

export function scoreLoan(model: Model, input: FeatureInput, scoredAt: string): LoanScore {
  const { values, missing } = extractFeatures(input);
  const probability = predict(model, values);
  const lowConfidence = missing.length > 0;
  return {
    probability,
    priority: Math.round(probability * 100),
    expectedLoss: expectedLoss(probability, input.outstanding),
    confidence: lowConfidence ? 'low' : 'high',
    confidenceNote: lowConfidence
      ? 'Limited payment history for this loan, so the score leans on DPD and balance only. Treat it as a rough guide.'
      : null,
    reasons: topReasons(model, input, values, missing),
    modelVersion: model.version,
    scoredAt,
  };
}

// ---------- evaluation ----------

/** Area under the ROC curve via the rank-sum method; ties count half. */
export function auc(scored: { p: number; y: number }[]): number {
  const pos = scored.filter((s) => s.y === 1);
  const neg = scored.filter((s) => s.y === 0);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  const sorted = [...scored].sort((a, b) => a.p - b.p);
  let rankSumPos = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].p === sorted[i].p) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (sorted[k].y === 1) rankSumPos += avgRank;
    i = j + 1;
  }
  return (rankSumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

/** Share of all actual roll-forwards that sit in the top `share` of scores. */
export function topShareCapture(scored: { p: number; y: number }[], share = 0.2): number {
  const total = scored.filter((s) => s.y === 1).length;
  if (total === 0) return 0;
  const top = [...scored].sort((a, b) => b.p - a.p).slice(0, Math.ceil(scored.length * share));
  return top.filter((s) => s.y === 1).length / total;
}

export function calibration(scored: { p: number; y: number }[]) {
  const bands = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  return bands.slice(0, -1).map((lo, i) => {
    const hi = bands[i + 1];
    const inBand = scored.filter((s) => s.p >= lo && s.p < hi);
    const count = inBand.length;
    return {
      band: `${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))}%`,
      predicted: count ? inBand.reduce((a, s) => a + s.p, 0) / count : 0,
      actual: count ? inBand.filter((s) => s.y === 1).length / count : 0,
      count,
    };
  });
}
