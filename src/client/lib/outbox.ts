// Offline-first outcome logging.
//
// Every outcome the officer logs goes into an IndexedDB outbox first, with a UUID made on
// the phone. A sync loop sends pending items whenever there is a connection. The server
// treats the UUID as an idempotency key, so retries after a dropped response never create
// duplicates. Items leave the outbox only when the server has answered for them.
import { createStore, get, set } from 'idb-keyval';
import type { AttemptInput, SyncResponse, SyncResult, TodayResponse } from '../../shared/types';
import { istDate } from '../../shared/time';
import { api, HttpError } from './api';

const store = createStore('collect-assist', 'kv');
const PENDING = 'outbox.pending';
const DONE = 'outbox.done'; // recent server answers, newest first
const MAX_DONE = 50;

export interface DoneItem {
  item: AttemptInput;
  result: SyncResult;
  at: string;
}

export interface OutboxStatus {
  pending: AttemptInput[];
  recent: DoneItem[];
  syncing: boolean;
  online: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

let status: OutboxStatus = {
  pending: [],
  recent: [],
  syncing: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastSyncAt: null,
  lastError: null,
};
const listeners = new Set<(s: OutboxStatus) => void>();
let started = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 5_000;

function emit(patch: Partial<OutboxStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn(status));
}

export function getOutboxStatus(): OutboxStatus {
  return status;
}

export function subscribeOutbox(fn: (s: OutboxStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

async function load() {
  const [pending, recent] = await Promise.all([
    get<AttemptInput[]>(PENDING, store),
    get<DoneItem[]>(DONE, store),
  ]);
  emit({ pending: pending ?? [], recent: recent ?? [] });
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback for old Android WebViews without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Save an attempt locally, then try to send it. Never throws for network problems. */
export async function enqueue(item: AttemptInput): Promise<void> {
  const pending = [...((await get<AttemptInput[]>(PENDING, store)) ?? []), item];
  await set(PENDING, pending, store);
  emit({ pending });
  void syncNow();
}

/** Send everything pending. Safe to call often; only one sync runs at a time. */
export async function syncNow(): Promise<void> {
  if (status.syncing) return;
  const pending = (await get<AttemptInput[]>(PENDING, store)) ?? [];
  if (pending.length === 0) {
    emit({ pending });
    return;
  }
  if (!navigator.onLine) {
    emit({ online: false });
    return;
  }
  emit({ syncing: true, lastError: null });
  try {
    const batch = pending.slice(0, 100);
    const res = await api.post<SyncResponse>('/sync/attempts', { items: batch });
    const answered = new Map(res.results.map((r) => [r.id, r]));
    const at = new Date().toISOString();
    const done: DoneItem[] = batch
      .filter((i) => answered.has(i.id))
      .map((item) => ({ item, result: answered.get(item.id)!, at }));
    // Re-read in case the officer logged something while we were syncing.
    const latest = (await get<AttemptInput[]>(PENDING, store)) ?? [];
    const remaining = latest.filter((i) => !answered.has(i.id));
    const recent = [...done.reverse(), ...((await get<DoneItem[]>(DONE, store)) ?? [])].slice(0, MAX_DONE);
    await set(PENDING, remaining, store);
    await set(DONE, recent, store);
    retryDelay = 5_000;
    emit({ pending: remaining, recent, syncing: false, online: true, lastSyncAt: at });
    if (remaining.length > 0) void syncNow();
  } catch (err) {
    const msg = err instanceof HttpError ? err.message : 'Sync failed';
    emit({ syncing: false, lastError: msg, online: navigator.onLine && !(err instanceof HttpError && err.status === 0) });
    scheduleRetry();
  }
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncNow();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 120_000);
}

/** Start listening for connectivity changes. Call once after sign-in. */
export function startOutbox() {
  if (started) return;
  started = true;
  void load().then(syncNow);
  window.addEventListener('online', () => {
    emit({ online: true });
    retryDelay = 5_000;
    void syncNow();
  });
  window.addEventListener('offline', () => emit({ online: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  setInterval(() => void syncNow(), 30_000);
}

// ---------- cached "today" list so the officer can work with no signal ----------

export async function cacheToday(userId: string, today: TodayResponse) {
  await set(`today.${userId}`, today, store);
}

export async function cachedToday(userId: string): Promise<TodayResponse | undefined> {
  return get<TodayResponse>(`today.${userId}`, store);
}

/**
 * Overlay attempts that are still in the outbox onto the list, so a loan logged offline
 * immediately shows as contacted and drops to the "done" section.
 */
export function applyPending(today: TodayResponse, pending: AttemptInput[], todayDate: string): TodayResponse {
  if (pending.length === 0) return today;
  const latestByLoan = new Map<string, AttemptInput>();
  for (const p of pending) {
    const prev = latestByLoan.get(p.loanId);
    if (!prev || p.occurredAt > prev.occurredAt) latestByLoan.set(p.loanId, p);
  }
  const loans = today.loans.map((loan) => {
    const p = latestByLoan.get(loan.id);
    if (!p || p.outcome === null) return loan;
    return {
      ...loan,
      contactedToday: loan.contactedToday || istDate(new Date(p.occurredAt)) === todayDate,
      lastAttempt: { occurredAt: p.occurredAt, outcome: p.outcome, kind: p.kind, status: 'accepted' as const },
    };
  });
  // Keep the server's order but move newly contacted loans to the end.
  const open = loans.filter((l) => !l.contactedToday);
  const done = loans.filter((l) => l.contactedToday);
  return { ...today, loans: [...open, ...done] };
}
