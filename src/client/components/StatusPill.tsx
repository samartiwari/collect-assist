// Connection + sync state in the top bar. Tapping it opens the sync centre.
import { Link } from 'react-router-dom';
import { useOnline, useOutbox } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { Icon } from './Icons';

export function StatusPill() {
  const { t } = useT();
  const outbox = useOutbox();
  const browserOnline = useOnline();
  const online = browserOnline && outbox.online;
  const n = outbox.pending.length;

  let tone: 'ok' | 'busy' | 'pending' | 'offline';
  let label: string;
  if (!online) {
    tone = 'offline';
    label = n > 0 ? `${t('status.offline')} · ${n}` : t('status.offline');
  } else if (outbox.syncing) {
    tone = 'busy';
    label = t('status.syncing');
  } else if (n > 0) {
    tone = 'pending';
    label = t('status.waiting', { n });
  } else {
    tone = 'ok';
    label = t('status.synced');
  }

  return (
    <Link to="/sync" className={`status-pill status-${tone}`} aria-label={t('status.aria', { state: label })}>
      {tone === 'busy' ? (
        <span className="spinner status-spinner" aria-hidden="true" />
      ) : tone === 'offline' ? (
        <Icon name="wifi-off" size={16} />
      ) : tone === 'pending' ? (
        <Icon name="upload" size={16} />
      ) : (
        <span className="status-dot" aria-hidden="true" />
      )}
      <span className="status-label">{label}</span>
      {n > 0 && <span className="status-count num" aria-hidden="true">{n}</span>}
    </Link>
  );
}
