import { describe, expect, it } from 'vitest';
import { addDays, contactWindow, daysBetween, istDate, istInstant, istTimeLabel, isContactAllowed } from '../src/shared/time';

// Helper: an instant at a given IST wall-clock time.
const ist = (ymd: string, h: number, m = 0) => istInstant(ymd, h, m);

describe('contact window (RBI: 8 am to 7 pm IST)', () => {
  it('blocks 7:59 am and allows 8:00 am', () => {
    expect(isContactAllowed(ist('2026-11-09', 7, 59))).toBe(false);
    expect(isContactAllowed(ist('2026-11-09', 8, 0))).toBe(true);
  });

  it('allows 6:59 pm and blocks 7:00 pm', () => {
    expect(isContactAllowed(ist('2026-11-09', 18, 59))).toBe(true);
    expect(isContactAllowed(ist('2026-11-09', 19, 0))).toBe(false);
  });

  it('blocks midnight and early morning', () => {
    expect(isContactAllowed(ist('2026-11-09', 0, 0))).toBe(false);
    expect(isContactAllowed(ist('2026-11-09', 5, 30))).toBe(false);
  });

  it('uses IST, not the server timezone: 02:30 UTC is 8:00 am IST', () => {
    expect(isContactAllowed(new Date('2026-11-09T02:30:00Z'))).toBe(true);
    expect(isContactAllowed(new Date('2026-11-09T02:29:00Z'))).toBe(false);
    expect(isContactAllowed(new Date('2026-11-09T13:29:00Z'))).toBe(true); // 6:59 pm IST
    expect(isContactAllowed(new Date('2026-11-09T13:30:00Z'))).toBe(false); // 7:00 pm IST
  });

  it('says when the window opens next', () => {
    const before = contactWindow(ist('2026-11-09', 6, 0));
    expect(before.open).toBe(false);
    if (!before.open) {
      expect(before.reason).toBe('before_window');
      expect(before.opensAt.toISOString()).toBe(ist('2026-11-09', 8).toISOString());
    }
    const after = contactWindow(ist('2026-11-09', 21, 0));
    if (!after.open) {
      expect(after.reason).toBe('after_window');
      expect(after.opensAt.toISOString()).toBe(ist('2026-11-10', 8).toISOString());
    }
  });

  it('reports minutes left while open', () => {
    const s = contactWindow(ist('2026-11-09', 18, 30));
    expect(s.open && s.minutesLeft).toBe(30);
  });
});

describe('IST date helpers', () => {
  it('rolls the date at IST midnight, not UTC midnight', () => {
    expect(istDate(new Date('2026-11-09T18:29:00Z'))).toBe('2026-11-09'); // 11:59 pm IST
    expect(istDate(new Date('2026-11-09T18:30:00Z'))).toBe('2026-11-10'); // 12:00 am IST
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(daysBetween('2026-10-31', '2026-11-09')).toBe(9);
  });

  it('formats IST times', () => {
    expect(istTimeLabel(ist('2026-11-09', 8))).toBe('8:00 AM');
    expect(istTimeLabel(ist('2026-11-09', 19, 5))).toBe('7:05 PM');
    expect(istTimeLabel(ist('2026-11-09', 0, 0))).toBe('12:00 AM');
    expect(istTimeLabel(ist('2026-11-09', 12, 0))).toBe('12:00 PM');
  });
});
