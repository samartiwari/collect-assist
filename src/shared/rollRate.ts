// Roll rate: of the loans sitting in the 1-30 DPD bucket on the 1st of a month, the share that
// are at 31-60 DPD on the 1st of the next month. This is the head of collections' key number
// (22% today, 16% target).
import type { RollRatePoint } from './types';

export interface BucketObservation {
  month: string; // YYYY-MM of the starting snapshot
  rolled: boolean;
}

export function rollRates(observations: BucketObservation[]): RollRatePoint[] {
  const byMonth = new Map<string, { inBucket: number; rolled: number }>();
  for (const o of observations) {
    const m = byMonth.get(o.month) ?? { inBucket: 0, rolled: 0 };
    m.inBucket += 1;
    if (o.rolled) m.rolled += 1;
    byMonth.set(o.month, m);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { inBucket, rolled }]) => ({
      month,
      inBucket,
      rolled,
      rate: inBucket === 0 ? 0 : rolled / inBucket,
    }));
}

/** Projected roll rate for the open month = mean model probability over the current bucket. */
export function projectedRate(probabilities: number[]): number {
  if (probabilities.length === 0) return 0;
  return probabilities.reduce((a, b) => a + b, 0) / probabilities.length;
}
