// Display formatting for the manager screens. All calendar logic is IST (see shared/time).
import { istDate, istTimeLabel } from '../../../shared/time';
import { formatPct } from '../../lib/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y: y ?? 1970, m: (m ?? 1) - 1, d: d ?? 1 };
}

/** "9 Nov" */
export function fmtDay(ymd: string): string {
  const { m, d } = parts(ymd);
  return `${d} ${MONTHS[m]}`;
}

/** "Mon, 9 Nov 2026" */
export function fmtDayLong(ymd: string): string {
  const { y, m, d } = parts(ymd);
  const wd = new Date(Date.UTC(y, m, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${d} ${MONTHS[m]} ${y}`;
}

/** "Mon, 9 Nov" */
export function fmtDayWeek(ymd: string): string {
  const { y, m, d } = parts(ymd);
  const wd = new Date(Date.UTC(y, m, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${d} ${MONTHS[m]}`;
}

/** "Oct 2026" from YYYY-MM or YYYY-MM-DD */
export function fmtMonth(ym: string): string {
  const { y, m } = parts(ym.slice(0, 7) + '-01');
  return `${MONTHS[m]} ${y}`;
}

/** "Oct" */
export function fmtMonthShort(ym: string): string {
  return MONTHS[parts(ym.slice(0, 7) + '-01').m] ?? ym;
}

/** "9:14 AM" in IST */
export function fmtTime(iso: string): string {
  return istTimeLabel(new Date(iso));
}

/** "Today, 9:14 AM" / "8 Nov, 9:14 AM" in IST */
export function fmtDateTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const day = istDate(d);
  const label = day === istDate(now) ? 'Today' : fmtDay(day);
  return `${label}, ${istTimeLabel(d)}`;
}

/** "just now" / "12 min ago" / "2 h ago" / "Yesterday" / "3 Nov" */
export function fmtRelative(iso: string, now: Date): string {
  const d = new Date(iso);
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const today = istDate(now);
  const day = istDate(d);
  if (day === today) return `${Math.floor(mins / 60)} h ago`;
  const yesterday = istDate(new Date(now.getTime() - 86400000));
  if (day === yesterday) return 'Yesterday';
  return fmtDay(day);
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

/** 0.241 -> "24.1%" */
export function fmtRate(x: number): string {
  return formatPct(x, 1);
}

/** Percentage-point change: 0.012 -> "1.2 pts" (unsigned) */
export function fmtPts(delta: number): string {
  return `${Math.abs(delta * 100).toFixed(1)} pts`;
}

/** 40 -> "40 m", 1234 -> "1.2 km" */
export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** Signed number with a true minus sign: "+0.84" / "−0.31" */
export function fmtSigned(n: number, digits = 2): string {
  const s = Math.abs(n).toFixed(digits);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
