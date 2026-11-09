// Small building blocks shared by the manager screens.
import { useEffect, useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PromiseStatus } from '../../../shared/types';
import { HttpError } from '../../lib/api';

// ---------- icons (1.75px stroke, currentColor) ----------
type IconName = 'check' | 'back' | 'upload' | 'pin' | 'file' | 'alert' | 'chev-left' | 'chev-right' | 'search' | 'arrow-right';
const ICON_PATHS: Record<IconName, ReactNode> = {
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  back: <path d="M15 5l-7 7 7 7" />,
  'chev-left': <path d="M14.5 6l-6 6 6 6" />,
  'chev-right': <path d="M9.5 6l6 6-6 6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3" />,
  pin: <path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7" />,
  file: <path d="M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5" />,
  alert: <path d="M12 8v5M12 16.5v.5M10.3 4.3L2.8 17.5A2 2 0 004.5 20.5h15a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z" />,
  search: <path d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4" />,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mgr-icon">
      {ICON_PATHS[name]}
    </svg>
  );
}

// ---------- page head ----------
export function PageHead({ title, sub, actions, back }: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <header className="page-head mgr-head">
      <div className="grow">
        {back && (
          <Link to={back.to} className="mgr-back small">
            <Icon name="back" size={16} /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </header>
  );
}

// ---------- states ----------
export function errorText(error: Error): string {
  if (error instanceof HttpError) {
    if (error.status === 403) return 'Your account does not have access to this.';
    if (error.status === 404) return 'Not found. It may have been removed or moved to another branch.';
  }
  return error.message || 'Something went wrong.';
}

export function ErrorState({ error, onRetry, what = 'this' }: { error: Error; onRetry: () => void; what?: string }) {
  return (
    <div className="mgr-state" role="alert">
      <span className="mgr-state-icon mgr-state-icon-error"><Icon name="alert" size={20} /></span>
      <h3>Couldn’t load {what}</h3>
      <p className="muted small">{errorText(error)}</p>
      <button type="button" className="btn btn-sm" onClick={onRetry}>Retry</button>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty mgr-empty">
      <h3>{title}</h3>
      {children && <p className="small">{children}</p>}
      {action && <div className="mgr-empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', className = '' }: { h?: number; w?: number | string; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height: h, width: w }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 6, h = 20 }: { rows?: number; h?: number }) {
  return (
    <div className="mgr-skel-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={h} w={`${100 - ((i * 13) % 30)}%`} />
      ))}
    </div>
  );
}

// ---------- dialog (bottom sheet on phones, centred on wider screens) ----------
export function Dialog({ title, sub, onClose, children }: {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet mgr-dialog" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="sheet-grip" aria-hidden="true" />
        <h2 id={id}>{title}</h2>
        {sub && <p className="muted small mgr-dialog-sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

// ---------- badges ----------
const PROMISE_BADGE: Record<PromiseStatus, { cls: string; label: string }> = {
  broken: { cls: 'badge-high', label: 'Broken' },
  due_today: { cls: 'badge-mid', label: 'Due today' },
  upcoming: { cls: 'badge-info', label: 'Upcoming' },
  kept: { cls: 'badge-ok', label: 'Kept' },
};

export function PromiseBadge({ status }: { status: PromiseStatus }) {
  const b = PROMISE_BADGE[status];
  return <span className={`badge ${b.cls}`}>{b.label}</span>;
}

export function priorityLevel(priority: number): 'high' | 'mid' | 'low' {
  if (priority >= 50) return 'high';
  if (priority >= 25) return 'mid';
  return 'low';
}

export function PriorityBadge({ priority, title }: { priority: number; title?: string }) {
  const level = priorityLevel(priority);
  const word = level === 'high' ? 'High' : level === 'mid' ? 'Medium' : 'Low';
  return (
    <span className={`badge badge-${level} num`} title={title ?? `${priority}% chance of rolling to 31–60 DPD`}>
      {word} · {priority}
    </span>
  );
}

/** A thin meter: fill / cap, turning amber near the cap and red over it. */
export function LoadMeter({ value, cap, label }: { value: number; cap: number; label: string }) {
  const ratio = cap > 0 ? value / cap : 0;
  const tone = ratio > 1 ? 'over' : ratio >= 0.9 ? 'near' : 'ok';
  return (
    <div className={`mgr-meter mgr-meter-${tone}`} role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={cap} aria-valuenow={value}>
      <div className="mgr-meter-fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
    </div>
  );
}
