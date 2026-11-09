// Loading, empty and error states. Every screen that fetches uses these so they look the same.
import type { ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { errorMessage, isUnreachable } from '../lib/hooks';
import { Icon, type IconName } from './Icons';

export function Loading({ label }: { label?: string }) {
  const { t } = useT();
  return (
    <div className="state state-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label ?? t('state.loading')}</span>
    </div>
  );
}

/** Placeholder blocks shaped like the content that is loading. */
export function SkeletonList({ count = 4, height = 148 }: { count?: number; height?: number }) {
  const { t } = useT();
  return (
    <div className="stack" aria-busy="true">
      <span className="sr-only" role="status">{t('state.loading')}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, opacity: 1 - i * 0.18 }} />
      ))}
    </div>
  );
}

interface EmptyProps {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}

export function Empty({ icon = 'check-circle', title, body, action }: EmptyProps) {
  return (
    <div className="empty">
      <span className="state-icon" aria-hidden="true">
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      {body && <p className="small">{body}</p>}
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  error?: unknown;
  message?: string;
  onRetry?: () => void;
}

/** Shows "No signal" for network problems and the server's message for everything else. */
export function ErrorState({ title, error, message, onRetry }: ErrorStateProps) {
  const { t } = useT();
  const offline = error !== undefined && isUnreachable(error);
  return (
    <div className="empty state-error" role="alert">
      <span className="state-icon state-icon-warn" aria-hidden="true">
        <Icon name={offline ? 'wifi-off' : 'alert'} size={24} />
      </span>
      <h3>{offline ? t('state.offlineTitle') : (title ?? t('state.errorTitle'))}</h3>
      <p className="small">{message ?? (offline ? t('state.offlineBody') : error ? errorMessage(error) : '')}</p>
      {onRetry && (
        <div className="state-action">
          <button type="button" className="btn" onClick={onRetry}>
            <Icon name="refresh" size={18} />
            {t('state.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
