import { describe, expect, it } from 'vitest';
import {
  FEATURES,
  auc,
  calibration,
  expectedLoss,
  extractFeatures,
  predict,
  scoreLoan,
  trainLogistic,
  type FeatureInput,
} from '../src/shared/scoring';
import { mulberry32 } from '../src/shared/random';

const base: FeatureInput = {
  dpd: 15,
  outstanding: 300_000,
  emi: 15_000,
  paidLast3m: 30_000,
  lastPaymentDate: '2026-10-10',
  brokenPromises90d: 0,
  openPromiseDate: null,
  asOf: '2026-11-09',
};

describe('extractFeatures', () => {
  it('turns raw loan fields into model features', () => {
    const f = extractFeatures({ ...base, dpd: 27, brokenPromises90d: 2 });
    expect(f.values.dpd).toBe(27);
    expect(f.values.nearRoll).toBe(1);
    expect(f.values.brokenPromises).toBe(2);
    expect(f.values.paidRatio3m).toBeCloseTo(30_000 / 45_000);
    expect(f.values.daysSincePayment).toBe(30);
    expect(f.values.openPromise).toBe(0);
    expect(f.missing).toEqual([]);
  });

  it('flags missing history instead of guessing silently', () => {
    const f = extractFeatures({ ...base, lastPaymentDate: null, emi: 0 });
    expect(f.missing).toContain('daysSincePayment');
    expect(f.missing).toContain('paidRatio3m');
  });

  it('counts only promises dated today or later as open', () => {
    expect(extractFeatures({ ...base, openPromiseDate: '2026-11-09' }).values.openPromise).toBe(1);
    expect(extractFeatures({ ...base, openPromiseDate: '2026-11-08' }).values.openPromise).toBe(0);
  });
});

describe('trainLogistic', () => {
  // Synthetic data where the truth is known: risk rises with DPD and broken promises.
  const rng = mulberry32(7);
  const rows = Array.from({ length: 2000 }, () => {
    const dpd = 1 + Math.floor(rng() * 30);
    const broken = rng() < 0.2 ? 1 + Math.floor(rng() * 2) : 0;
    const input: FeatureInput = { ...base, dpd, brokenPromises90d: broken };
    const logit = -2 + 0.12 * (dpd - 15) + 0.9 * broken;
    const y = rng() < 1 / (1 + Math.exp(-logit)) ? 1 : 0;
    return { x: extractFeatures(input).values, y };
  });
  const model = trainLogistic(rows, { version: 'test' });

  it('learns the direction of each effect', () => {
    const w = Object.fromEntries(model.weights.map((x) => [x.feature, x.weight]));
    expect(w.dpd + w.nearRoll).toBeGreaterThan(0);
    expect(w.brokenPromises).toBeGreaterThan(0);
  });

  it('ranks risky loans above safe ones on held-out data', () => {
    const scores = rows.map((r) => ({ p: predict(model, r.x), y: r.y }));
    expect(auc(scores)).toBeGreaterThan(0.7);
  });

  it('is deterministic for the same data', () => {
    const again = trainLogistic(rows, { version: 'test' });
    expect(again.bias).toBeCloseTo(model.bias, 10);
  });

  it('produces probabilities between 0 and 1', () => {
    const p = predict(model, extractFeatures({ ...base, dpd: 30, brokenPromises90d: 9 }).values);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });
});

describe('scoreLoan', () => {
  const rng = mulberry32(11);
  const rows = Array.from({ length: 1500 }, () => {
    const dpd = 1 + Math.floor(rng() * 30);
    const broken = rng() < 0.25 ? 1 : 0;
    const promise = rng() < 0.2;
    const input: FeatureInput = {
      ...base,
      dpd,
      brokenPromises90d: broken,
      openPromiseDate: promise ? '2026-11-12' : null,
    };
    const logit = -1.8 + 0.1 * (dpd - 15) + 1.0 * broken - 1.0 * (promise ? 1 : 0);
    return { x: extractFeatures(input).values, y: rng() < 1 / (1 + Math.exp(-logit)) ? 1 : 0 };
  });
  const model = trainLogistic(rows, { version: 'v-test' });

  it('returns exactly three human-readable reasons in English and Hindi', () => {
    const s = scoreLoan(model, { ...base, dpd: 27, brokenPromises90d: 1 }, '2026-11-09T05:00:00.000Z');
    expect(s.reasons).toHaveLength(3);
    for (const r of s.reasons) {
      expect(r.text.length).toBeGreaterThan(5);
      expect(r.textHi.length).toBeGreaterThan(5);
    }
    expect(s.reasons[0].direction).toBe('up');
  });

  it('puts the strongest risk driver first', () => {
    const s = scoreLoan(model, { ...base, dpd: 29, brokenPromises90d: 0 }, '2026-11-09T05:00:00.000Z');
    expect(s.reasons[0].code).toBe('dpd');
    expect(s.reasons[0].text).toContain('29 days overdue, rolls into 31+ in 2 days');
  });

  it('explains when a promise lowers the risk', () => {
    const s = scoreLoan(model, { ...base, dpd: 5, openPromiseDate: '2026-11-12' }, '2026-11-09T05:00:00.000Z');
    const promise = s.reasons.find((r) => r.code === 'openPromise');
    expect(promise?.direction).toBe('down');
  });

  it('marks the score low-confidence when history is missing', () => {
    const s = scoreLoan(model, { ...base, lastPaymentDate: null, emi: 0 }, '2026-11-09T05:00:00.000Z');
    expect(s.confidence).toBe('low');
    expect(s.confidenceNote).toMatch(/payment history/i);
  });

  it('scores a higher-risk loan higher', () => {
    const low = scoreLoan(model, { ...base, dpd: 3 }, '2026-11-09T05:00:00.000Z');
    const high = scoreLoan(model, { ...base, dpd: 28, brokenPromises90d: 2 }, '2026-11-09T05:00:00.000Z');
    expect(high.probability).toBeGreaterThan(low.probability);
    expect(high.priority).toBeGreaterThan(low.priority);
  });
});

describe('expectedLoss', () => {
  it('uses the brief: 20% of rolled loans turn NPA with 35% loss', () => {
    // The brief's own example: ₹5 lakh rolled loan → ₹35,000 expected loss.
    expect(expectedLoss(1, 500_000)).toBe(35_000);
    expect(expectedLoss(0.5, 500_000)).toBe(17_500);
  });
});

describe('auc and calibration', () => {
  it('auc is 1 for perfect ranking, 0.5 for ties', () => {
    expect(auc([{ p: 0.9, y: 1 }, { p: 0.1, y: 0 }])).toBe(1);
    expect(auc([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }])).toBe(0.5);
  });

  it('groups predictions into bands', () => {
    const bands = calibration([
      { p: 0.1, y: 0 },
      { p: 0.15, y: 1 },
      { p: 0.9, y: 1 },
    ]);
    const first = bands.find((b) => b.band === '0–20%')!;
    expect(first.count).toBe(2);
    expect(first.actual).toBe(0.5);
  });

  it('exposes every feature with a label', () => {
    expect(FEATURES.length).toBeGreaterThanOrEqual(6);
    for (const f of FEATURES) expect(f.label.length).toBeGreaterThan(3);
  });
});
