// One loan: key numbers, why it scored the way it did, promises, every contact attempt,
// and approved reminder messages. Officers can act on it; managers see it read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type {
  ActivityRow,
  AttemptInput,
  ContactKind,
  DraftResponse,
  LoanCard,
  LoanDetailResponse,
  LoanScore,
  MessageRow,
  PromiseRow,
  TemplateRow,
} from '../../../shared/types';
import { useContactWindow } from '../../components/ContactWindowBanner';
import { Icon } from '../../components/Icons';
import { mapHref, outcomeKey, PROMISE_BADGE, reasonText, RiskBadge, riskLevel, telHref, useCallAction } from '../../components/LoanBits';
import { ErrorState, Loading, SkeletonList } from '../../components/States';
import { api, businessLine, formatPct, formatRupees, HttpError } from '../../lib/api';
import { homePath, useAuth } from '../../lib/auth';
import { errorMessage, isUnreachable, useApi, useOutbox } from '../../lib/hooks';
import { formatDateMedium, formatDateShort, formatInstant, useT, type MsgKey } from '../../lib/i18n';
import { cachedToday } from '../../lib/outbox';
import { now } from '../../lib/clock';
import { fillTemplate } from '../../../shared/reminders';
import { istDate } from '../../../shared/time';
import { LogOutcomeSheet } from './LogOutcomeSheet';

type DetailState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: LoanDetailResponse; offline: boolean }
  | { kind: 'error'; error: unknown };

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export default function LoanDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const outbox = useOutbox();
  const isOfficer = user?.role === 'officer';
  const [state, setState] = useState<DetailState>({ kind: 'loading' });
  const [sheetKind, setSheetKind] = useState<ContactKind | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (quiet: boolean) => {
      const mine = ++seq.current;
      if (!quiet) setState({ kind: 'loading' });
      try {
        const data = await api.get<LoanDetailResponse>(`/loans/${encodeURIComponent(id)}`);
        if (mine === seq.current) setState({ kind: 'ready', data, offline: false });
      } catch (error) {
        if (mine !== seq.current) return;
        if (isUnreachable(error) && user) {
          const cached = await cachedToday(user.id).catch(() => undefined);
          const loan = cached?.loans.find((l) => l.id === id);
          if (mine !== seq.current) return;
          if (loan) {
            setState({ kind: 'ready', data: { loan, attempts: [], promises: [], messages: [] }, offline: true });
            return;
          }
        }
        setState((prev) => (quiet && prev.kind === 'ready' ? prev : { kind: 'error', error }));
      }
    },
    [id, user],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Refresh history once the outbox has delivered something.
  const lastSync = useRef(outbox.lastSyncAt);
  useEffect(() => {
    if (isOfficer && outbox.lastSyncAt && outbox.lastSyncAt !== lastSync.current) void load(true);
    lastSync.current = outbox.lastSyncAt;
  }, [isOfficer, outbox.lastSyncAt, load]);

  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(user ? homePath(user.role) : '/');
  };

  const onCall = useCallAction(() => setSheetKind('call'));
  const pending = isOfficer ? outbox.pending.filter((p) => p.loanId === id) : [];

  const addMessage = (m: MessageRow) =>
    setState((prev) => (prev.kind === 'ready' ? { ...prev, data: { ...prev.data, messages: [m, ...prev.data.messages] } } : prev));

  return (
    <div className="page-narrow detail">
      <button type="button" className="btn btn-ghost back-btn" onClick={goBack}>
        <Icon name="chevron-left" size={20} />
        {t('detail.back')}
      </button>

      {state.kind === 'loading' && (
        <div className="stack">
          <div className="skeleton" style={{ height: 64 }} />
          <SkeletonList count={3} height={120} />
        </div>
      )}

      {state.kind === 'error' && (
        <div className="card">
          <ErrorState
            title={state.error instanceof HttpError && (state.error.status === 404 || state.error.status === 403) ? t('detail.notFound') : t('detail.loadError')}
            error={state.error}
            onRetry={() => void load(false)}
          />
        </div>
      )}

      {state.kind === 'ready' && (
        <DetailBody
          data={state.data}
          offline={state.offline}
          isOfficer={isOfficer}
          pending={pending}
          onCall={onCall}
          onLog={() => setSheetKind('visit')}
          onMessageSent={addMessage}
        />
      )}

      {state.kind === 'ready' && sheetKind && (
        <LogOutcomeSheet loan={state.data.loan} initialKind={sheetKind} onClose={() => setSheetKind(null)} />
      )}
    </div>
  );
}

interface BodyProps {
  data: LoanDetailResponse;
  offline: boolean;
  isOfficer: boolean;
  pending: AttemptInput[];
  onCall: ReturnType<typeof useCallAction>;
  onLog: () => void;
  onMessageSent: (m: MessageRow) => void;
}

function DetailBody({ data, offline, isOfficer, pending, onCall, onLog, onMessageSent }: BodyProps) {
  const { t, lang } = useT();
  const w = useContactWindow();
  const { loan } = data;

  return (
    <div className="stack-lg">
      <header className="detail-head">
        <p className="overline">
          <span className="mono">{loan.id}</span> · {loan.branchName}
        </p>
        <h1>{loan.borrowerName}</h1>
        <p className="muted">
          {businessLine(loan)}
          {!isOfficer && ` · ${loan.officerName ? t('detail.officer', { name: loan.officerName }) : t('detail.unassigned')}`}
        </p>
      </header>

      {offline && (
        <div className="banner banner-info" role="status">
          <Icon name="wifi-off" size={18} />
          <span>{t('detail.offline')}</span>
        </div>
      )}

      {loan.pinned && (
        <div className="banner banner-info">
          <Icon name="pin" size={18} />
          <span>{t('card.pinned', { name: loan.pinned.byName, reason: loan.pinned.reason })}</span>
        </div>
      )}

      <dl className="card keyfacts">
        <div>
          <dt>{t('detail.outstanding')}</dt>
          <dd className="num">{formatRupees(loan.outstanding)}</dd>
        </div>
        <div>
          <dt>{t('detail.emi')}</dt>
          <dd className="num">{formatRupees(loan.emi)}</dd>
        </div>
        <div>
          <dt>{t('detail.dpd')}</dt>
          <dd className={`num${loan.dpd >= 25 ? ' text-warn' : ''}`}>{loan.dpd}</dd>
        </div>
        <div>
          <dt>{t('detail.lastPayment')}</dt>
          <dd>{loan.lastPaymentDate ? formatDateMedium(loan.lastPaymentDate, lang) : t('detail.never')}</dd>
        </div>
      </dl>

      <div className="contact-lines">
        <p>
          <Icon name="map-pin" size={16} />
          <span>
            {loan.address}, {loan.pincode}
          </span>
        </p>
        {isOfficer && loan.phone && (
          <p>
            <Icon name="phone" size={16} />
            <span className="num">{loan.phone}</span>
          </p>
        )}
      </div>

      {isOfficer && (
        <div className="detail-actions">
          <a href={telHref(loan.phone)} className={`btn btn-lg${w.open ? '' : ' act-locked'}`} onClick={(e) => onCall(loan, e)}>
            <Icon name={w.open ? 'phone' : 'lock'} size={20} />
            {t('card.call')}
          </a>
          <a href={mapHref(loan)} className="btn btn-lg" target="_blank" rel="noopener noreferrer">
            <Icon name="map-pin" size={20} />
            {t('card.map')}
          </a>
          <button type="button" className="btn btn-primary btn-lg detail-log" onClick={onLog}>
            <Icon name="check" size={20} />
            {t('detail.logOutcome')}
          </button>
        </div>
      )}

      <ScoreCard score={loan.score} isOfficer={isOfficer} />

      {!offline && <PromisesSection promises={data.promises} />}

      <HistorySection attempts={data.attempts} pending={pending} showOfficer={!isOfficer} offline={offline} loan={loan} />

      {!offline && (
        <section className="detail-section" aria-labelledby="sec-rem">
          <h2 id="sec-rem">{t('rem.title')}</h2>
          <p className="hint">
            <Icon name="info" size={14} /> {t('rem.simulated')}
          </p>
          {isOfficer && <Composer loan={loan} windowOpen={w.open} onSent={onMessageSent} />}
          <MessageList messages={data.messages} />
        </section>
      )}
    </div>
  );
}

function ScoreCard({ score, isOfficer }: { score: LoanScore | null; isOfficer: boolean }) {
  const { t, lang } = useT();
  if (!score) {
    return (
      <section className="card card-pad score-card">
        <p className="muted">{t('detail.noScore')}</p>
      </section>
    );
  }
  const level = riskLevel(score.priority);
  return (
    <section className={`card score-card score-${level}`} aria-labelledby="score-title">
      <div className="score-top">
        <p className="score-num num">
          {score.priority}
          <span className="score-of">/100</span>
        </p>
        <div className="grow">
          <p className="score-title" id="score-title">
            <span className="overline">{t('detail.priority')}</span>
            <RiskBadge score={score} showNumber={false} />
          </p>
          <p className="score-line">{t('detail.roll', { pct: formatPct(score.probability) })}</p>
        </div>
      </div>
      <div className="score-meter" aria-hidden="true">
        <span style={{ width: `${Math.max(2, Math.min(100, score.priority))}%` }} />
      </div>

      <h3 className="score-why">{t('detail.why')}</h3>
      <ul className="reasons">
        {score.reasons.map((r) => (
          <li key={r.code} className={`reason reason-${r.direction}`}>
            <span className="reason-icon" aria-hidden="true">
              <Icon name={r.direction === 'up' ? 'arrow-up' : 'arrow-down'} size={15} strokeWidth={2.2} />
            </span>
            <span>
              <span className="sr-only">{r.direction === 'up' ? t('detail.raises') : t('detail.lowers')}: </span>
              {reasonText(r, lang)}
            </span>
          </li>
        ))}
      </ul>

      {score.confidence === 'low' && (
        <p className="score-note">
          <Icon name="info" size={16} />
          <span>
            <strong>{t('card.lowConfidence')}.</strong> {score.confidenceNote}
          </span>
        </p>
      )}

      <p className="score-advisory">{isOfficer ? t('detail.advisory') : t('detail.advisoryManager')}</p>
      <p className="tiny muted">
        {isOfficer
          ? t('detail.updated', { time: formatInstant(score.scoredAt, lang) })
          : t('detail.model', { v: score.modelVersion, time: formatInstant(score.scoredAt, lang) })}
      </p>
    </section>
  );
}

function PromisesSection({ promises }: { promises: PromiseRow[] }) {
  const { t, lang } = useT();
  return (
    <section className="detail-section" aria-labelledby="sec-prom">
      <h2 id="sec-prom">{t('detail.promises')}</h2>
      {promises.length === 0 ? (
        <p className="muted small section-empty">{t('detail.noPromises')}</p>
      ) : (
        <ul className="card plain-list">
          {promises.map((p) => (
            <li key={p.id} className="plain-row">
              <span className="grow">
                <span className="row-title num">{formatRupees(p.amount)}</span>
                <span className="row-meta">
                  {formatDateMedium(p.promiseDate, lang)}
                  {p.daysLate ? ` · ${p.daysLate === 1 ? t('prom.dayLate') : t('prom.daysLate', { n: p.daysLate })}` : ''}
                </span>
              </span>
              <span className={`badge ${PROMISE_BADGE[p.status]}`}>{t(`prom.${p.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface HistoryProps {
  attempts: ActivityRow[];
  pending: AttemptInput[];
  showOfficer: boolean;
  offline: boolean;
  loan: LoanCard;
}

function HistorySection({ attempts, pending, showOfficer, offline, loan }: HistoryProps) {
  const { t, lang } = useT();
  const sentIds = new Set(attempts.map((a) => a.id));
  const waiting = pending.filter((p) => !sentIds.has(p.id)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  // Offline we only know the last attempt from the saved list.
  const offlineLast = offline && loan.lastAttempt ? loan.lastAttempt : null;
  const empty = attempts.length === 0 && waiting.length === 0 && !offlineLast;

  return (
    <section className="detail-section" aria-labelledby="sec-hist">
      <h2 id="sec-hist">{t('detail.history')}</h2>
      {empty ? (
        <p className="muted small section-empty">{t('detail.noHistory')}</p>
      ) : (
        <ol className="card history">
          {waiting.map((p) => (
            <li key={p.id} className="history-item">
              <span className={`history-icon${p.outcome === null ? ' is-blocked' : ''}`} aria-hidden="true">
                <Icon name={p.kind === 'call' ? 'phone' : 'map-pin'} size={16} />
              </span>
              <div className="grow">
                <p className="history-title">
                  <AttemptTitle outcome={outcomeKey(p.outcome)} amount={p.amount ?? null} promiseDate={p.promiseDate ?? null} />
                </p>
                <p className="history-meta">
                  {formatInstant(p.occurredAt, lang)} · {t(`kind.${p.kind}`)}
                </p>
                {p.note && <p className="history-note">{p.note}</p>}
                <div className="history-tags">
                  <span className="badge badge-info">
                    <Icon name="upload" size={13} />
                    {t('detail.waiting')}
                  </span>
                </div>
              </div>
            </li>
          ))}

          {offlineLast && (
            <li className="history-item">
              <span className={`history-icon${offlineLast.status === 'blocked' ? ' is-blocked' : ''}`} aria-hidden="true">
                <Icon name={offlineLast.kind === 'call' ? 'phone' : 'map-pin'} size={16} />
              </span>
              <div className="grow">
                <p className="history-title">
                  <strong>{t(outcomeKey(offlineLast.outcome))}</strong>
                </p>
                <p className="history-meta">
                  {formatInstant(offlineLast.occurredAt, lang)} · {t(`kind.${offlineLast.kind}`)}
                </p>
              </div>
            </li>
          )}

          {attempts.map((a) => (
            <li key={a.id} className="history-item">
              <span className={`history-icon${a.status === 'blocked' ? ' is-blocked' : ''}`} aria-hidden="true">
                <Icon name={a.kind === 'call' ? 'phone' : 'map-pin'} size={16} />
              </span>
              <div className="grow">
                <p className="history-title">
                  <AttemptTitle outcome={outcomeKey(a.outcome)} amount={a.amount} promiseDate={a.promiseDate} />
                </p>
                <p className="history-meta">
                  {formatInstant(a.occurredAt, lang)} · {t(`kind.${a.kind}`)}
                  {showOfficer && ` · ${t('detail.by', { name: a.officerName })}`}
                </p>
                {a.note && <p className="history-note">{a.note}</p>}
                {(a.status === 'blocked' || a.createdOffline || (a.kind === 'visit' && a.distanceM !== null)) && (
                  <div className="history-tags">
                    {a.status === 'blocked' && <span className="badge badge-high">{t('detail.blocked')}</span>}
                    {a.createdOffline && <span className="badge">{t('detail.offlineBadge')}</span>}
                    {a.kind === 'visit' && a.distanceM !== null && (
                      <span className={`badge ${a.distanceM > 500 ? 'badge-mid' : 'badge-low'}`}>
                        <Icon name="map-pin" size={13} />
                        {t('detail.distance', { d: formatDistance(a.distanceM) })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AttemptTitle({ outcome, amount, promiseDate }: { outcome: MsgKey; amount: number | null; promiseDate: string | null }) {
  const { t, lang } = useT();
  return (
    <>
      <strong>{t(outcome)}</strong>
      {amount !== null && amount > 0 && <span className="num"> · {formatRupees(amount)}</span>}
      {promiseDate && <span> · {formatDateShort(promiseDate, lang)}</span>}
    </>
  );
}

// ---------- reminders ----------

interface ComposerProps {
  loan: LoanCard;
  windowOpen: boolean;
  onSent: (m: MessageRow) => void;
}

/** The template as the borrower would read it, with this loan's values filled in. */
function previewText(body: string, loan: LoanCard): string {
  const due = loan.openPromise?.promiseDate ?? istDate(now());
  return fillTemplate(body, {
    borrower: loan.borrowerName,
    loanId: loan.id,
    amount: (loan.openPromise?.amount ?? loan.emi).toLocaleString('en-IN'),
    date: new Date(`${due}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    officer: loan.officerName ?? '',
    dpd: loan.dpd,
  });
}

function Composer({ loan, windowOpen, onSent }: ComposerProps) {
  const loanId = loan.id;
  const { t, lang } = useT();
  const templates = useApi<{ templates: TemplateRow[] }>('/templates');
  const options = useMemo(() => {
    const list = (templates.data?.templates ?? []).filter((x) => x.audience === 'borrower');
    return [...list].sort((a, b) => Number(a.lang !== lang) - Number(b.lang !== lang));
  }, [templates.data, lang]);

  const [picked, setPicked] = useState('');
  const templateId = options.some((o) => o.id === picked) ? picked : (options[0]?.id ?? '');
  const template = options.find((o) => o.id === templateId);

  const [draft, setDraft] = useState<(DraftResponse & { templateId: string }) | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MessageRow | null>(null);

  async function prepare() {
    if (!templateId) return;
    setBusy('draft');
    setError(null);
    setResult(null);
    try {
      const res = await api.post<DraftResponse>(`/loans/${encodeURIComponent(loanId)}/messages/draft`, { templateId });
      setDraft({ ...res, templateId });
      setBody(res.body);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!draft || !body.trim()) return;
    setBusy('send');
    setError(null);
    try {
      const row = await api.post<MessageRow>(`/loans/${encodeURIComponent(loanId)}/messages`, { templateId: draft.templateId, body: body.trim() });
      setResult(row);
      setDraft(null);
      setBody('');
      onSent(row);
    } catch (err) {
      setError(t('rem.failed', { msg: errorMessage(err) }));
    } finally {
      setBusy(null);
    }
  }

  if (templates.status === 'loading') return <Loading />;
  if (templates.status === 'error') {
    return (
      <div className="banner banner-error">
        <Icon name="alert" size={18} />
        <span className="grow">{t('rem.loadFailed')}</span>
        <button type="button" className="btn btn-sm" onClick={() => templates.reload()}>
          {t('state.retry')}
        </button>
      </div>
    );
  }
  if (options.length === 0) return <p className="muted small">{t('rem.noTemplates')}</p>;

  // Words the server flagged that are still in the edited text.
  const stillBlocked = draft ? draft.blockedWords.filter((wd) => body.toLowerCase().includes(wd.toLowerCase())) : [];

  return (
    <div className="card card-pad composer stack">
      {!windowOpen && (
        <div className="banner banner-warn small">
          <Icon name="lock" size={16} />
          <span>{t('rem.closed')}</span>
        </div>
      )}

      {!draft ? (
        <>
          <div className="field">
            <label htmlFor="rem-template">{t('rem.template')}</label>
            <select id="rem-template" className="select" value={templateId} onChange={(e) => setPicked(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.lang === 'hi' ? 'हिन्दी' : 'English'}
                </option>
              ))}
            </select>
            {template && (
              <p className="template-preview" lang={template.lang}>
                {previewText(template.body, loan)}
              </p>
            )}
          </div>
          <button type="button" className="btn btn-block" onClick={() => void prepare()} disabled={busy !== null}>
            {busy === 'draft' ? <span className="spinner" aria-hidden="true" /> : <Icon name="message" size={18} />}
            {busy === 'draft' ? t('rem.preparing') : t('rem.prepare')}
          </button>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="rem-body">{t('rem.message')}</label>
            <textarea id="rem-body" className="textarea" rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {stillBlocked.length > 0 && (
            <div className="banner banner-error small" role="alert">
              <Icon name="alert" size={16} />
              <span>{t('rem.blockedWords', { words: stillBlocked.join(', ') })}</span>
            </div>
          )}
          <div className="row">
            <button type="button" className="btn grow" onClick={() => setDraft(null)} disabled={busy !== null}>
              {t('rem.discard')}
            </button>
            <button type="button" className="btn btn-primary grow" onClick={() => void send()} disabled={busy !== null || !body.trim()}>
              {busy === 'send' ? <span className="spinner" aria-hidden="true" /> : <Icon name="send" size={18} />}
              {busy === 'send' ? t('rem.sending') : t('rem.send')}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className={`banner ${result.status === 'sent_mock' ? 'banner-ok' : 'banner-error'} small`} role="status">
          <Icon name={result.status === 'sent_mock' ? 'check-circle' : 'alert'} size={16} />
          <span>{result.status === 'sent_mock' ? t('rem.sent') : t('rem.blocked', { reason: result.reason ?? '' })}</span>
        </div>
      )}
    </div>
  );
}

function MessageList({ messages }: { messages: MessageRow[] }) {
  const { t, lang } = useT();
  return (
    <div className="stack">
      <h3 className="subhead">{t('rem.past')}</h3>
      {messages.length === 0 ? (
        <p className="muted small section-empty">{t('rem.none')}</p>
      ) : (
        <ul className="card plain-list">
          {messages.map((m) => (
            <li key={m.id} className="message-row">
              <p className="message-body" lang={m.lang}>
                {m.body}
              </p>
              <div className="row-between wrap">
                <span className="row-meta">
                  {formatInstant(m.createdAt, lang)} · {m.sentByName}
                </span>
                <span className={`badge ${m.status === 'sent_mock' ? 'badge-ok' : 'badge-high'}`}>
                  {m.status === 'sent_mock' ? t('rem.sent') : t('rem.blocked', { reason: m.reason ?? '' })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
