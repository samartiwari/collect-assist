// What has reached the server, what is still on the phone, and a manual "Sync now".
import { useEffect, useState, type ReactNode } from 'react';
import type { AttemptInput, SyncResult } from '../../../shared/types';
import { istTimeLabel } from '../../../shared/time';
import { Icon, type IconName } from '../../components/Icons';
import { outcomeKey } from '../../components/LoanBits';
import { formatRupees } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { clockState } from '../../lib/clock';
import { useOnline, useOutbox } from '../../lib/hooks';
import { formatDateShort, formatInstant, plural, useT, type MsgKey } from '../../lib/i18n';
import { cachedToday, syncNow } from '../../lib/outbox';

const RESULT_BADGE: Record<SyncResult['status'], { cls: string; key: MsgKey }> = {
  accepted: { cls: 'badge-ok', key: 'sync.accepted' },
  duplicate: { cls: 'badge-low', key: 'sync.duplicate' },
  blocked: { cls: 'badge-mid', key: 'sync.blocked' },
  rejected: { cls: 'badge-high', key: 'sync.rejected' },
};

/** Borrower names from the saved list, so items read as people rather than loan ids. */
function useBorrowerNames(userId: string | undefined): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    cachedToday(userId)
      .then((d) => {
        if (alive && d) setNames(new Map(d.loans.map((l) => [l.id, l.borrowerName])));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId]);
  return names;
}

export default function SyncCenter() {
  const { user } = useAuth();
  const { t } = useT();
  const outbox = useOutbox();
  const browserOnline = useOnline();
  const names = useBorrowerNames(user?.id);
  const online = browserOnline && outbox.online;
  const n = outbox.pending.length;
  const lastSync = outbox.lastSyncAt ?? outbox.recent[0]?.at ?? null;

  let icon: IconName | null;
  let title: string;
  let tone: string;
  if (outbox.syncing) {
    icon = null;
    title = t('sync.syncing');
    tone = 'busy';
  } else if (!online) {
    icon = 'wifi-off';
    title = n > 0 ? plural(t, n, 'sync.offlineOne', 'sync.offline') : t('sync.offlineNone');
    tone = 'offline';
  } else if (n > 0) {
    icon = 'upload';
    title = plural(t, n, 'sync.pendingOne', 'sync.pending');
    tone = 'pending';
  } else {
    icon = 'check-circle';
    title = t('sync.allSent');
    tone = 'ok';
  }

  return (
    <div className="page-narrow sync">
      <header className="page-head">
        <h1>{t('sync.title')}</h1>
      </header>

      <section className={`card sync-status sync-${tone}`} aria-live="polite">
        <div className="sync-status-row">
          <span className="sync-icon" aria-hidden="true">
            {icon ? <Icon name={icon} size={26} /> : <span className="spinner" />}
          </span>
          <div className="grow">
            <h2>{title}</h2>
            <p className="small muted">{lastSync ? t('sync.last', { time: istTimeLabel(new Date(Date.parse(lastSync) + clockState().offsetMs)) }) : t('sync.never')}</p>
          </div>
        </div>
        {outbox.lastError && !outbox.syncing && n > 0 && (
          <p className="field-error">{t('sync.error', { msg: outbox.lastError })}</p>
        )}
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={() => void syncNow()}
          disabled={outbox.syncing || n === 0 || !browserOnline}
        >
          <Icon name="refresh" size={20} className={outbox.syncing ? 'spin' : undefined} />
          {t('sync.now')}
        </button>
        {!browserOnline && n > 0 && <p className="hint">{t('sync.noSignal')}</p>}
      </section>

      <p className="sync-explain">
        <Icon name="info" size={18} />
        <span>{t('sync.explain')}</span>
      </p>

      <section className="detail-section" aria-labelledby="sync-waiting">
        <h2 id="sync-waiting">{t('sync.waitingTitle', { n })}</h2>
        {n === 0 ? (
          <p className="muted small section-empty">{t('sync.waitingEmpty')}</p>
        ) : (
          <ul className="card plain-list">
            {[...outbox.pending].reverse().map((item) => (
              <li key={item.id} className="plain-row">
                <ItemText item={item} name={names.get(item.loanId)}>
                  <span className="badge badge-info">
                    <Icon name="clock" size={13} />
                    {t('sync.waiting')}
                  </span>
                </ItemText>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-section" aria-labelledby="sync-recent">
        <h2 id="sync-recent">{t('sync.recentTitle')}</h2>
        {outbox.recent.length === 0 ? (
          <p className="muted small section-empty">{t('sync.recentEmpty')}</p>
        ) : (
          <ul className="card plain-list">
            {outbox.recent.map(({ item, result }) => {
              const badge = RESULT_BADGE[result.status];
              return (
                <li key={item.id} className="plain-row">
                  <ItemText item={item} name={names.get(item.loanId)}>
                    <span className={`badge ${badge.cls}`}>{t(badge.key)}</span>
                    {result.status === 'rejected' && result.message && <span className="row-error">{result.message}</span>}
                  </ItemText>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function ItemText({ item, name, children }: { item: AttemptInput; name: string | undefined; children?: ReactNode }) {
  const { t, lang } = useT();
  const detail = [
    t(outcomeKey(item.outcome)),
    item.amount ? formatRupees(item.amount) : null,
    item.promiseDate ? formatDateShort(item.promiseDate, lang) : null,
    // A blocked call already says "Call" in its label.
    item.outcome === null ? null : t(`kind.${item.kind}`),
    formatInstant(item.occurredAt, lang),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="grow item-text">
      <span className="row-title">{name ?? item.loanId}</span>
      <span className="row-meta">
        {detail}
        {name && (
          <>
            {' · '}
            <span className="mono nowrap">{item.loanId}</span>
          </>
        )}
      </span>
      {children && <span className="row-badges">{children}</span>}
    </span>
  );
}
