// The officer's day: who to contact, in what order, and why.
//
// Live list from the server when there is signal; otherwise the copy saved on the phone.
// Outcomes still in the outbox are laid over the list, so a loan logged offline drops to
// "Done today" at once.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ContactKind, LoanCard, TodayResponse } from '../../../shared/types';
import { istDate, istMinutesOfDay, istTimeLabel } from '../../../shared/time';
import { ContactWindowBanner, useContactWindow } from '../../components/ContactWindowBanner';
import { Icon } from '../../components/Icons';
import { mapHref, outcomeKey, PromiseChip, reasonText, RiskBadge, telHref, timeOnly, useCallAction } from '../../components/LoanBits';
import { Empty, ErrorState, SkeletonList } from '../../components/States';
import { api, businessLine, formatRupeesShort } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { isUnreachable, useNow, useOnline, useOutbox } from '../../lib/hooks';
import { formatDayLong, plural, useT } from '../../lib/i18n';
import { applyPending, cachedToday, cacheToday } from '../../lib/outbox';
import { LogOutcomeSheet } from './LogOutcomeSheet';

const TODAY_SIZE = 12;

type ViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: TodayResponse; source: 'live' | 'cache' }
  | { kind: 'error'; error: unknown; noCache: boolean };

/** Fetch the list; fall back to the saved copy when the server can't be reached. */
function useTodayList(userId: string) {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (quiet: boolean) => {
      const mine = ++seq.current;
      if (quiet) setRefreshing(true);
      try {
        const data = await api.get<TodayResponse>('/officer/today');
        if (mine !== seq.current) return;
        setState({ kind: 'ready', data, source: 'live' });
        cacheToday(userId, data).catch(() => undefined);
      } catch (error) {
        if (mine !== seq.current) return;
        if (isUnreachable(error)) {
          const cached = await cachedToday(userId).catch(() => undefined);
          if (mine !== seq.current) return;
          if (cached) setState({ kind: 'ready', data: cached, source: 'cache' });
          else setState((prev) => (prev.kind === 'ready' ? { ...prev, source: 'cache' } : { kind: 'error', error, noCache: true }));
        } else {
          setState((prev) => (quiet && prev.kind === 'ready' ? prev : { kind: 'error', error, noCache: false }));
        }
      } finally {
        if (mine === seq.current) setRefreshing(false);
      }
    },
    [userId],
  );

  return { state, refreshing, load };
}

function greetingKey(d: Date) {
  const m = istMinutesOfDay(d);
  if (m < 12 * 60) return 'today.greetMorning' as const;
  if (m < 17 * 60) return 'today.greetAfternoon' as const;
  return 'today.greetEvening' as const;
}

export default function Today() {
  const { user } = useAuth();
  const { t, lang } = useT();
  const outbox = useOutbox();
  const online = useOnline();
  const current = useNow(60_000);
  const today = istDate(current);
  const w = useContactWindow();
  const userId = user?.id ?? '';
  const { state, refreshing, load } = useTodayList(userId);
  const [sheet, setSheet] = useState<{ loan: LoanCard; kind: ContactKind } | null>(null);

  useEffect(() => {
    void load(false);
  }, [load]);

  // After the outbox syncs, pull the server's updated list (scores, promises, order).
  const lastSync = useRef(outbox.lastSyncAt);
  useEffect(() => {
    if (outbox.lastSyncAt && outbox.lastSyncAt !== lastSync.current) void load(true);
    lastSync.current = outbox.lastSyncAt;
  }, [outbox.lastSyncAt, load]);

  // Back online while showing the saved list? Fetch the live one.
  const source = state.kind === 'ready' ? state.source : null;
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && source === 'cache') void load(true);
    wasOnline.current = online;
  }, [online, source, load]);

  const openSheet = useCallback((loan: LoanCard, kind: ContactKind = 'visit') => setSheet({ loan, kind }), []);
  const onCall = useCallAction((loan) => openSheet(loan, 'call'));

  const view = useMemo(() => {
    if (state.kind !== 'ready') return null;
    const generated = Date.parse(state.data.generatedAt);
    // Items the server has accepted but that are newer than this copy of the list.
    const synced = outbox.recent
      .filter((d) => (d.result.status === 'accepted' || d.result.status === 'duplicate') && Date.parse(d.item.occurredAt) > generated)
      .map((d) => d.item);
    return applyPending(state.data, [...synced, ...outbox.pending], today);
  }, [state, outbox.pending, outbox.recent, today]);

  const firstName = user?.name.split(' ')[0] ?? '';

  return (
    <div className="page-narrow today">
      <header className="today-head">
        <p className="overline">
          {formatDayLong(today, lang)}
          {user?.branchName ? ` · ${user.branchName}` : ''}
        </p>
        <h1>{t(greetingKey(current), { name: firstName })}</h1>
      </header>

      <ContactWindowBanner />

      {state.kind === 'loading' && (
        <div className="today-loading">
          <div className="skeleton" style={{ height: 76 }} />
          <SkeletonList count={3} />
        </div>
      )}

      {state.kind === 'error' && (
        <div className="card">
          <ErrorState
            title={t('today.loadError')}
            error={state.error}
            message={state.noCache ? t('today.noCache') : undefined}
            onRetry={() => void load(false)}
          />
        </div>
      )}

      {state.kind === 'ready' && view && (
        <>
          {state.source === 'cache' && (
            <div className="banner banner-info" role="status">
              <Icon name="wifi-off" size={18} />
              <span>
                {online
                  ? t('today.unreachable', { time: istTimeLabel(new Date(state.data.generatedAt)) })
                  : t('today.offline', { time: istTimeLabel(new Date(state.data.generatedAt)) })}
                {outbox.pending.length > 0 && ` ${plural(t, outbox.pending.length, 'today.waitingOne', 'today.waiting')}`}
                {state.data.date !== today && ` ${t('today.oldList', { date: formatDayLong(state.data.date, lang) })}`}
              </span>
            </div>
          )}

          <TodayList
            data={view}
            today={today}
            windowOpen={w.open}
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            onCall={onCall}
            onLog={(loan) => openSheet(loan)}
          />
        </>
      )}

      {sheet && <LogOutcomeSheet loan={sheet.loan} initialKind={sheet.kind} onClose={() => setSheet(null)} />}
    </div>
  );
}

interface ListProps {
  data: TodayResponse;
  today: string;
  windowOpen: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onCall: (loan: LoanCard, e: MouseEvent<HTMLAnchorElement>) => void;
  onLog: (loan: LoanCard) => void;
}

function TodayList({ data, today, windowOpen, refreshing, onRefresh, onCall, onLog }: ListProps) {
  const { t } = useT();
  const open = data.loans.filter((l) => !l.contactedToday);
  const done = data.loans.filter((l) => l.contactedToday);
  const now12 = open.slice(0, TODAY_SIZE);
  const later = open.slice(TODAY_SIZE);
  const atRisk = open.reduce((sum, l) => sum + (l.score?.expectedLoss ?? 0), 0);
  const promisesDue = data.loans.filter(
    (l) => l.openPromise && l.openPromise.status !== 'broken' && (l.openPromise.status === 'due_today' || l.openPromise.promiseDate === today),
  ).length;

  if (data.loans.length === 0) {
    return (
      <div className="card">
        <Empty
          icon="list"
          title={t('today.emptyTitle')}
          body={t('today.emptyBody')}
          action={
            <button type="button" className="btn" onClick={onRefresh} disabled={refreshing}>
              <Icon name="refresh" size={18} className={refreshing ? 'spin' : undefined} />
              {t('today.refresh')}
            </button>
          }
        />
      </div>
    );
  }

  const card = (loan: LoanCard, rank: number) => (
    <LoanItem key={loan.id} loan={loan} rank={rank} today={today} windowOpen={windowOpen} onCall={onCall} onLog={onLog} />
  );

  return (
    <>
      <dl className="summary card">
        <div>
          <dt>{t('today.toContact')}</dt>
          <dd className="num">{open.length}</dd>
        </div>
        <div>
          <dt>{t('today.atRisk')}</dt>
          <dd className="num">{formatRupeesShort(atRisk)}</dd>
        </div>
        <div>
          <dt>{t('today.promisesDue')}</dt>
          <dd className="num">{promisesDue}</dd>
        </div>
      </dl>

      <section className="list-section" aria-labelledby="sec-today">
        <div className="section-head">
          <h2 id="sec-today">
            {t('today.section')} <span className="section-count num">{now12.length}</span>
          </h2>
          <button type="button" className="refresh-btn" onClick={onRefresh} disabled={refreshing} aria-label={t('today.refresh')}>
            <span className="tiny muted">{t('today.updated', { time: istTimeLabel(new Date(data.generatedAt)) })}</span>
            <Icon name="refresh" size={17} className={refreshing ? 'spin' : undefined} />
          </button>
        </div>
        {now12.length > 0 ? (
          <div className="loan-list">{now12.map((loan, i) => card(loan, i + 1))}</div>
        ) : (
          <div className="card">
            <Empty icon="check-circle" title={t('today.allDoneTitle')} body={t('today.allDoneBody')} />
          </div>
        )}
      </section>

      {later.length > 0 && (
        <details className="fold">
          <summary>
            <span>{t('today.later', { n: later.length })}</span>
            <Icon name="chevron" size={20} className="fold-chevron" />
          </summary>
          <div className="loan-list">{later.map((loan, i) => card(loan, TODAY_SIZE + i + 1))}</div>
        </details>
      )}

      {done.length > 0 && (
        <details className="fold">
          <summary>
            <span>{t('today.done', { n: done.length })}</span>
            <Icon name="chevron" size={20} className="fold-chevron" />
          </summary>
          <ul className="done-list card">
            {done.map((loan) => (
              <DoneRow key={loan.id} loan={loan} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

interface ItemProps {
  loan: LoanCard;
  rank: number;
  today: string;
  windowOpen: boolean;
  onCall: (loan: LoanCard, e: MouseEvent<HTMLAnchorElement>) => void;
  onLog: (loan: LoanCard) => void;
}

function LoanItem({ loan, rank, today, windowOpen, onCall, onLog }: ItemProps) {
  const { t, lang } = useT();
  const reasons = loan.score?.reasons ?? [];
  const top = reasons[0];
  const nameId = `loan-${loan.id}`;

  return (
    <article className={`loan-card card${loan.pinned ? ' is-pinned' : ''}`} aria-labelledby={nameId}>
      {loan.pinned && (
        <p className="loan-pin">
          <Icon name="pin" size={15} />
          <span>{t('card.pinned', { name: loan.pinned.byName, reason: loan.pinned.reason })}</span>
        </p>
      )}
      <Link to={`/loan/${loan.id}`} className="loan-main">
        <div className="loan-head">
          <span className="loan-rank num" aria-hidden="true">
            {rank}
          </span>
          <div className="grow">
            <h3 className="loan-name" id={nameId}>
              {loan.borrowerName}
            </h3>
            <p className="loan-sub">{businessLine(loan)}</p>
          </div>
          <RiskBadge score={loan.score} />
        </div>

        <div className="loan-body">
          <div className="loan-facts">
            <span className={`chip chip-dpd${loan.dpd >= 25 ? ' chip-dpd-near' : ''}`}>{t('card.dpd', { n: loan.dpd })}</span>
            <span className="loan-amt num">{t('card.outstanding', { amount: formatRupeesShort(loan.outstanding) })}</span>
          </div>

          {top && (
            <p className={`loan-reason reason-${top.direction}`}>
              <Icon name={top.direction === 'up' ? 'arrow-up' : 'arrow-down'} size={15} className="reason-arrow" />
              <span>
                {reasonText(top, lang)}
                {reasons.length > 1 && <span className="loan-more"> {plural(t, reasons.length - 1, 'card.moreReasonOne', 'card.moreReasons')}</span>}
              </span>
            </p>
          )}

          {(loan.openPromise || loan.score?.confidence === 'low') && (
            <div className="loan-notes">
              {loan.openPromise && <PromiseChip promise={loan.openPromise} today={today} />}
              {loan.score?.confidence === 'low' && (
                <span className="loan-lowconf">
                  <Icon name="info" size={14} />
                  {t('card.lowConfidence')}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>

      <div className="loan-actions">
        <a href={telHref(loan.phone)} className={`act${windowOpen ? '' : ' act-locked'}`} onClick={(e) => onCall(loan, e)}>
          <Icon name={windowOpen ? 'phone' : 'lock'} size={20} />
          <span>{t('card.call')}</span>
        </a>
        <a href={mapHref(loan)} className="act" target="_blank" rel="noopener noreferrer">
          <Icon name="map-pin" size={20} />
          <span>{t('card.map')}</span>
        </a>
        <button type="button" className="act act-log" onClick={() => onLog(loan)}>
          <Icon name="check" size={20} />
          <span>{t('card.log')}</span>
        </button>
      </div>
    </article>
  );
}

function DoneRow({ loan }: { loan: LoanCard }) {
  const { t } = useT();
  const a = loan.lastAttempt;
  return (
    <li>
      <Link to={`/loan/${loan.id}`} className="done-row">
        <span className={`done-icon${a?.outcome === 'paid' ? ' done-paid' : ''}`} aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
        <span className="grow">
          <span className="done-name">{loan.borrowerName}</span>
          {a && <span className="done-meta">{t('card.doneAt', { outcome: t(outcomeKey(a.outcome)), time: timeOnly(a.occurredAt) })}</span>}
        </span>
        <Icon name="chevron-right" size={18} className="muted" />
      </Link>
    </li>
  );
}
