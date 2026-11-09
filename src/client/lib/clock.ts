// The app's notion of "now". Normally real time. In demo mode the server can hold an
// offset so a reviewer can test inside the 8 am - 7 pm contact window at any hour.
// The offset is cached so the clock still works offline.
import type { ClockResponse } from '../../shared/types';
import { api } from './api';

const KEY = 'ca.clockOffsetMs';
let offsetMs = readStored();
let demoActive = false;
let demoMode = false;
const listeners = new Set<() => void>();

function readStored(): number {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function clockState() {
  return { offsetMs, demoActive, demoMode };
}

export function applyClock(c: ClockResponse) {
  offsetMs = c.offsetMs;
  demoActive = c.demoActive;
  demoMode = c.demoMode;
  try {
    localStorage.setItem(KEY, String(offsetMs));
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((fn) => fn());
}

export async function refreshClock(): Promise<void> {
  try {
    applyClock(await api.get<ClockResponse>('/clock'));
  } catch {
    /* offline: keep the cached offset */
  }
}

export function onClockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
