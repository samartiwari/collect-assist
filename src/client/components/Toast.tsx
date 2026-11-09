// Toasts: short, non-blocking confirmations ("Saved"), with an optional action button.
//
//   const toast = useToast();
//   toast('Saved');                                   // or toast.show('Saved')
//   toast('Calls are blocked', { tone: 'warn' });
//   toast('Log the outcome?', { action: { label: 'Log', onClick } });
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icons';

export type ToastTone = 'default' | 'ok' | 'warn' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** Defaults to 3.5 s, or 9 s when there is an action. */
  durationMs?: number;
  /** A toast with the same id replaces the previous one instead of stacking. */
  id?: string;
}

interface ToastItem extends ToastOptions {
  key: string;
  message: string;
}

type ShowFn = (message: string, opts?: ToastOptions) => void;
export type ToastFn = ShowFn & { show: ShowFn; dismiss: (id: string) => void };

const ToastContext = createContext<ToastFn | null>(null);

const TONE_ICON: Record<ToastTone, IconName | null> = {
  default: null,
  ok: 'check-circle',
  warn: 'clock',
  error: 'alert',
};

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
    const timer = timers.current.get(key);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(key);
  }, []);

  const show = useCallback<ShowFn>(
    (message, opts = {}) => {
      const key = opts.id ?? `t${++counter}`;
      const duration = opts.durationMs ?? (opts.action ? 9_000 : 3_500);
      const existing = timers.current.get(key);
      if (existing) window.clearTimeout(existing);
      timers.current.set(key, window.setTimeout(() => dismiss(key), duration));
      setItems((prev) => [...prev.filter((i) => i.key !== key), { ...opts, key, message }].slice(-3));
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const api = useMemo<ToastFn>(() => Object.assign(((m, o) => show(m, o)) as ShowFn, { show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {items.map((item) => {
          const icon = TONE_ICON[item.tone ?? 'default'];
          return (
            <div key={item.key} className={`toast toast-${item.tone ?? 'default'}`}>
              {icon && <Icon name={icon} size={18} className="toast-icon" />}
              <span className="toast-msg">{item.message}</span>
              {item.action && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    item.action?.onClick();
                    dismiss(item.key);
                  }}
                >
                  {item.action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
