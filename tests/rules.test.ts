import { describe, expect, it } from 'vitest';
import { checkMessage, fillTemplate, hasUnfilledPlaceholders } from '../src/shared/reminders';
import { projectedRate, rollRates } from '../src/shared/rollRate';

describe('reminder word filter', () => {
  it('passes a polite approved reminder', () => {
    const r = checkMessage('Namaste, a reminder that ₹28,000 is due on 12 Nov. Please call us if you need help.');
    expect(r.ok).toBe(true);
  });

  it('blocks threatening English and Hindi language, case-insensitively', () => {
    expect(checkMessage('Pay now or POLICE will come').blockedWords).toContain('police');
    expect(checkMessage('भुगतान करें वरना पुलिस आएगी').ok).toBe(false);
    expect(checkMessage('We will tell your family').ok).toBe(false);
  });
});

describe('fillTemplate', () => {
  it('fills known placeholders and leaves unknown ones visible', () => {
    const out = fillTemplate('Dear {{name}}, ₹{{amount}} due {{date}} {{oops}}', { name: 'Company B', amount: '28,000', date: '12 Nov' });
    expect(out).toBe('Dear Company B, ₹28,000 due 12 Nov {{oops}}');
    expect(hasUnfilledPlaceholders(out)).toBe(true);
  });
});

describe('roll rates', () => {
  it('computes the share of the 1-30 bucket that rolled, per month', () => {
    const obs = [
      ...Array.from({ length: 100 }, (_, i) => ({ month: '2026-09', rolled: i < 22 })),
      ...Array.from({ length: 50 }, (_, i) => ({ month: '2026-10', rolled: i < 8 })),
    ];
    const r = rollRates(obs);
    expect(r).toEqual([
      { month: '2026-09', inBucket: 100, rolled: 22, rate: 0.22 },
      { month: '2026-10', inBucket: 50, rolled: 8, rate: 0.16 },
    ]);
  });

  it('handles an empty month list', () => {
    expect(rollRates([])).toEqual([]);
    expect(projectedRate([])).toBe(0);
  });

  it('projects the open month from model probabilities', () => {
    expect(projectedRate([0.1, 0.3])).toBeCloseTo(0.2);
  });
});
