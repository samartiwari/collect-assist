// Small hooks shared across screens.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { api, HttpError } from './api';
import { now, onClockChange } from './clock';
import { getOutboxStatus, subscribeOutbox, type OutboxStatus } from './outbox';

/**
 * True when the request never got a real answer from our server: no signal, DNS failure,
 * the dev proxy returning an HTML error page, or a 5xx from a gateway.
 */
export function isUnreachable(err: unknown): boolean {
  if (!(err instanceof HttpError)) return true;
  return err.status === 0 || err.status >= 500;
}

export function errorMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

/** The app clock (demo offset aware), refreshed on an interval, on clock changes and when the tab comes back. */
export function useNow(intervalMs = 30_000): Date {
  const [value, setValue] = useState(() => now());
  useEffect(() => {
    const tick = () => setValue(now());
    const id = window.setInterval(tick, intervalMs);
    const off = onClockChange(tick);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return value;
}

/** Live outbox status (pending items, recent server answers, online flag). */
export function useOutbox(): OutboxStatus {
  const [status, setStatus] = useState<OutboxStatus>(getOutboxStatus);
  useEffect(() => {
    const off = subscribeOutbox(setStatus);
    return () => {
      off();
    };
  }, []);
  return status;
}

/** navigator.onLine, kept in sync with the browser's online/offline events. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** Close a popover on outside pointer-down or Escape. */
export function useDismiss(ref: RefObject<HTMLElement>, open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open]);
}

export type ApiState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: unknown };

/** GET a path and track loading / data / error. `reload()` refetches; quiet reloads keep the old data on screen. */
export function useApi<T>(path: string | null): ApiState<T> & { reload: (quiet?: boolean) => void } {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });
  const seq = useRef(0);

  const load = useCallback(
    (quiet = false) => {
      if (!path) return;
      const mine = ++seq.current;
      if (!quiet) setState({ status: 'loading' });
      api.get<T>(path).then(
        (data) => {
          if (mine === seq.current) setState({ status: 'ready', data });
        },
        (error: unknown) => {
          if (mine !== seq.current) return;
          setState((prev) => (quiet && prev.status === 'ready' ? prev : { status: 'error', error }));
        },
      );
    },
    [path],
  );

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}
