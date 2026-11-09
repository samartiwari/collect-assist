import type { ApiError } from '../../shared/types';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** True when the request never reached the server (no signal, server down). */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof HttpError && err.status === 0);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new HttpError(0, 'network', 'No connection. Check your signal and try again.');
  }
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = (data as ApiError | null)?.error;
    throw new HttpError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
};

export function formatRupees(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

/** ₹6.4 L / ₹1.13 Cr for large amounts; smaller amounts in full (₹71,000), as people say them. */
export function formatRupeesShort(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return formatRupees(Math.round(n / 100) * 100);
}

/** Locality from an address like "177, Bhanwarkuan, Indore" -> "Bhanwarkuan". */
export function areaOf(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2] : '';
}

export function businessLine(loan: { businessType: string; address: string }): string {
  return [loan.businessType, areaOf(loan.address)].filter(Boolean).join(' · ');
}

export function formatPct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}
