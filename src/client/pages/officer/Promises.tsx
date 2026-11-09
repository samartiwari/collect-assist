// Promises to pay, split by what needs attention: due today, coming up, broken, kept.
// The last answer is kept on the phone so the list still opens with no signal.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PromiseRow, PromisesResponse, PromiseStatus } from '../../../shared/types';
import { istDate, istTimeLabel } from '../../../shared/time';
import { Icon } from '../../components/Icons';
import { PROMISE_BADGE } from '../../components/LoanBits';
import { Empty, ErrorState, SkeletonList } from '../../components/States';
import { formatRupees } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { now } from '../../lib/clock';
import { isUnreachable, useApi, useNow, useOutbox } from '../../lib/hooks';
import { formatRelativeDate, useT } from '../../lib/i18n';

const TABS: PromiseStatus[] = ['due_today', 'upcoming', 'broken', 'kept'];

interface Saved {
  at: string;
  data: PromisesResponse;
}

function readSaved(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function sortFor(status: PromiseStatus) {
  return (a: PromiseRow, b: PromiseRow) => {
    if (status === 'due_today' || status === 'upcoming') {
      return a.promiseDate.localeCompare(b.promiseDate) || b.amount - a.amount;
    }
    return b.promiseDate.localeCompare(a.promiseDate) || b.amount - a.amount;
  };
}

export default function Promises() {
  const { t, lang } = useT();
  const { user } = useAuth();
  const res = useApi<PromisesResponse>('/promises?status=all');
  const outbox = useOutbox();
  const today = istDate(useNow(60_000));
  const [tab, setTab] = useState<PromiseStatus>('due_today');
  const picked = useRef(false);
  const cacheKey = `ca.promises.${user?.id ?? ''}`;
  const [saved] = useState(() => readSaved(cacheKey));

  // Keep the latest answer on the phone.
  useEffect(() => {
    if (res.status !== 'ready') return;
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ at: now().toISOString(), data: res.data } satisfies Saved));
    } catch {
      /* storage full or blocked: the live list still works */
    }
  }, [res.status, res.data, cacheKey]);

  const fromCache = res.status === 'error' && isUnreachable(res.error) && saved !== null;
  const data = res.status === 'ready' ? res.data : fromCache ? saved.data : null;

  // First load: open the first tab that has something in it.
  useEffect(() => {
    if (!data || picked.current) return;
    picked.current = true;
    const first = TABS.find((s) => data.counts[s] > 0);
    if (first) setTab(first);
  }, [data]);

  // A promise logged from the field shows up here once it has synced.
  const lastSync = useRef(outbox.lastSyncAt);
  const { reload } = res;
  useEffect(() => {
    if (outbox.lastSyncAt && outbox.lastSyncAt !== lastSync.current) reload(true);
    lastSync.current = outbox.lastSyncAt;
  }, [outbox.lastSyncAt, reload]);

  const rows = useMemo(() => (data ? data.promises.filter((p) => p.status === tab).sort(sortFor(tab)) : []), [data, tab]);

  return (
    <div className="page-narrow">
      <header className="page-head">
        <div>
          <h1>{t('prom.title')}</h1>
          <p>{t('prom.subtitle')}</p>
        </div>
      </header>

      <div className="tabs-count" role="group" aria-label={t('prom.title')}>
        {TABS.map((s) => (
          <button key={s} type="button" aria-pressed={tab === s} onClick={() => setTab(s)} className={`tab-${s}`}>
            <span className="tabs-count-n num">{data ? data.counts[s] : '–'}</span>
            <span className="tabs-count-label">{t(`prom.${s}`)}</span>
          </button>
        ))}
      </div>

      {res.status === 'loading' && <SkeletonList count={4} height={68} />}

      {fromCache && saved && (
        <div className="banner banner-info stack-gap" role="status">
          <Icon name="wifi-off" size={18} />
          <span className="grow">{t('prom.offline', { time: istTimeLabel(new Date(saved.at)) })}</span>
        </div>
      )}

      {res.status === 'error' && !fromCache && (
        <div className="card">
          <ErrorState title={t('prom.loadError')} error={res.error} onRetry={() => res.reload()} />
        </div>
      )}

      {data &&
        (rows.length === 0 ? (
          <div className="card">
            <Empty icon="calendar" title={t(`prom.empty.${tab}`)} />
          </div>
        ) : (
          <ul className="card plain-list promise-list">
            {rows.map((p) => (
              <li key={p.id}>
                <Link to={`/loan/${p.loanId}`} className="promise-row">
                  <span className="grow">
                    <span className="row-title">{p.borrowerName}</span>
                    <span className="row-meta">
                      <span className="mono">{p.loanId}</span> · {formatRelativeDate(p.promiseDate, today, lang, t)}
                    </span>
                  </span>
                  <span className="promise-right">
                    <span className="row-amount num">{formatRupees(p.amount)}</span>
                    {p.status === 'broken' && p.daysLate ? (
                      <span className="badge badge-high">{p.daysLate === 1 ? t('prom.dayLate') : t('prom.daysLate', { n: p.daysLate })}</span>
                    ) : (
                      <span className={`badge ${PROMISE_BADGE[p.status]}`}>{t(`prom.${p.status}`)}</span>
                    )}
                  </span>
                  <Icon name="chevron-right" size={18} className="row-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
