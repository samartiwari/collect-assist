// Server-side "now". In demo mode a reviewer can move the whole system to a time inside
// the 8 am - 7 pm IST contact window; the offset lives in the settings table so the
// server and every phone agree on it.
import type { DB } from './db';
import { istDate, istInstant } from '../shared/time';

export function getOffsetMs(db: DB): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'clock_offset_ms'").get() as { value: string } | undefined;
  return row ? Number(row.value) || 0 : 0;
}

export function now(db: DB): Date {
  return new Date(Date.now() + getOffsetMs(db));
}

export function setDemoTime(db: DB, istTime: string): void {
  const [h, m] = istTime.split(':').map(Number);
  const real = new Date();
  const target = istInstant(istDate(real), h, m);
  db.prepare("INSERT INTO settings (key, value) VALUES ('clock_offset_ms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    String(target.getTime() - real.getTime()),
  );
}

export function resetClock(db: DB): void {
  db.prepare("DELETE FROM settings WHERE key = 'clock_offset_ms'").run();
}
