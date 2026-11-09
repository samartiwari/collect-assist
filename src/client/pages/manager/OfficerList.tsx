// /m/team/:officerId — exactly the officer's prioritised list, with manager overrides (pin, reassign).
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ActivityResponse, LoanCard, PinRequest, ReassignRequest, TeamOfficer, TeamResponse, TodayResponse } from '../../../shared/types';
import { istDate } from '../../../shared/time';
import { api, businessLine, formatRupees } from '../../lib/api';
import { now } from '../../lib/clock';
import { ActivitySummary, ActivityTable, activityPath } from './Activity';
import { fmtDay, fmtNum, plural } from './format';
import { useToast } from '../../components/Toast';
import { useResource } from './hooks';
import { Dialog, EmptyState, ErrorState, Icon, PageHead, PriorityBadge, PromiseBadge, SkeletonRows, errorText } from './ui';

const REASON_MAX = 120;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function ManagerOfficerList() {
  const { officerId = '' } = useParams();
  const today = istDate(now());
  const list = useResource<TodayResponse>(officerId ? `/team/${encodeURIComponent(officerId)}/list` : null);
  const team = useResource<TeamResponse>('/team');
  const activity = useResource<ActivityResponse>(officerId ? activityPath(today, officerId) : null);
  const toast = useToast();
  const show = useCallback((msg: string) => toast(msg, { tone: 'ok' }), [toast]);
  const [pinFor, setPinFor] = useState<LoanCard | null>(null);
  const [moveFor, setMoveFor] = useState<LoanCard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const officer = team.data?.officers.find((o) => o.id === officerId);
  const name = list.data?.officer.name ?? officer?.name ?? 'Officer';
  const loans = list.data?.loans ?? [];
  const contacted = loans.filter((l) => l.contactedToday).length;

  const pin = useCallback(async (loan: LoanCard, reason: string) => {
    const body: PinRequest = { pinned: true, reason };
    await api.post(`/loans/${encodeURIComponent(loan.id)}/pin`, body);
    setPinFor(null);
    show(`${loan.borrowerName} is now first on ${firstName(name)}’s list`);
    list.reload();
  }, [list, name, show]);

  const unpin = async (loan: LoanCard) => {
    setBusy(loan.id);
    setRowError(null);
    try {
      const body: PinRequest = { pinned: false };
      await api.post(`/loans/${encodeURIComponent(loan.id)}/pin`, body);
      show(`Unpinned ${loan.borrowerName}. The score orders it again.`);
      list.reload();
    } catch (e) {
      setRowError(`Couldn’t unpin ${loan.borrowerName}: ${errorText(e instanceof Error ? e : new Error(String(e)))}`);
    } finally {
      setBusy(null);
    }
  };

  const reassign = useCallback(async (loan: LoanCard, to: TeamOfficer) => {
    const body: ReassignRequest = { officerId: to.id };
    await api.post(`/loans/${encodeURIComponent(loan.id)}/reassign`, body);
    setMoveFor(null);
    show(`${loan.borrowerName} moved to ${to.name}`);
    list.reload();
    team.reload();
  }, [list, team, show]);

  return (
    <div className="page mgr">
      <PageHead
        back={{ to: '/m/team', label: 'Team' }}
        title={list.data || officer ? name : <span className="skeleton mgr-title-skel" aria-label="Loading" />}
        sub={
          list.data
            ? `${officer ? `${officer.branchName} · ` : ''}List for ${fmtDay(list.data.date)} · ${plural(loans.length, 'loan')} · ${fmtNum(contacted)} contacted`
            : 'Today’s prioritised list'
        }
        actions={
          <Link to={`/m/activity?officerId=${encodeURIComponent(officerId)}`} className="btn btn-sm">All activity</Link>
        }
      />

      <section className="card mgr-section" aria-labelledby="list-title">
        <div className="card-head mgr-head-wrap">
          <div>
            <h2 id="list-title">Today’s list</h2>
            <p className="tiny muted">
              The same order {firstName(name)} sees: pinned loans first, then by expected loss. Contacted loans drop to the bottom.
            </p>
          </div>
          {officer && (
            <span className="tiny muted num">
              Workload <strong className="mgr-ink">{fmtNum(officer.openLoans)}</strong> / {fmtNum(officer.cap)}
            </span>
          )}
        </div>
        {rowError && (
          <div className="card-body mgr-banner-slot">
            <div className="banner banner-error" role="alert">
              <Icon name="alert" />
              <span className="grow">{rowError}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRowError(null)}>Dismiss</button>
            </div>
          </div>
        )}
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} what={`${firstName(name)}’s list`} />
        ) : !list.data ? (
          <div className="card-body"><SkeletonRows rows={8} h={24} /></div>
        ) : loans.length === 0 ? (
          <EmptyState title="Nothing on this list today" action={<Link to="/m/import" className="btn btn-sm">Go to import</Link>}>
            No overdue loans are assigned to {firstName(name)}. New loans arrive with the morning import.
          </EmptyState>
        ) : (
          <div className={`table-wrap${list.loading ? ' mgr-refreshing' : ''}`}>
            <table className="table mgr-table mgr-cards mgr-list">
              <thead>
                <tr>
                  <th scope="col" className="right">#</th>
                  <th scope="col">Borrower</th>
                  <th scope="col" className="right">DPD</th>
                  <th scope="col" className="right">Outstanding</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Top reason</th>
                  <th scope="col">Open promise</th>
                  <th scope="col">Contacted</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l, i) => (
                  <ListRow
                    key={l.id}
                    loan={l}
                    rank={i + 1}
                    busy={busy === l.id}
                    onPin={() => setPinFor(l)}
                    onUnpin={() => unpin(l)}
                    onMove={() => setMoveFor(l)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mgr-section" aria-labelledby="act-title">
        <div className="card-head">
          <div>
            <h2 id="act-title">Activity today</h2>
            <p className="tiny muted">Calls and visits {firstName(name)} has logged so far. Times are IST.</p>
          </div>
        </div>
        {activity.error ? (
          <ErrorState error={activity.error} onRetry={activity.reload} what="today’s activity" />
        ) : !activity.data ? (
          <div className="card-body"><SkeletonRows rows={3} /></div>
        ) : activity.data.attempts.length === 0 ? (
          <EmptyState title="No attempts logged yet today">
            If {firstName(name)} is working offline, entries arrive when the phone reconnects.
          </EmptyState>
        ) : (
          <>
            <div className="card-body"><ActivitySummary rows={activity.data.attempts} /></div>
            <ActivityTable rows={activity.data.attempts} showOfficer={false} />
          </>
        )}
      </section>

      {pinFor && <PinDialog loan={pinFor} officerName={name} onClose={() => setPinFor(null)} onConfirm={pin} />}
      {moveFor && (
        <ReassignDialog
          loan={moveFor}
          currentId={officerId}
          currentBranchId={officer?.branchId ?? moveFor.branchId}
          team={team.data?.officers ?? null}
          teamError={team.error}
          onRetryTeam={team.reload}
          onClose={() => setMoveFor(null)}
          onConfirm={reassign}
        />
      )}
    </div>
  );
}

function ListRow({ loan: l, rank, busy, onPin, onUnpin, onMove }: {
  loan: LoanCard;
  rank: number;
  busy: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onMove: () => void;
}) {
  const reason = l.score?.reasons[0];
  return (
    <tr className={l.pinned ? 'mgr-row-pinned' : l.contactedToday ? 'mgr-row-done' : undefined}>
      <td className="right num mgr-rank cell-hide-sm">{rank}</td>
      <td className="cell-title">
        <div className="mgr-borrower-line">
          <span className="mgr-rank-sm num" aria-hidden="true">{rank}.</span>
          <Link to={`/loan/${encodeURIComponent(l.id)}`} className="mgr-borrower">{l.borrowerName}</Link>
        </div>
        <div className="tiny muted"><span className="mono">{l.id}</span> · {businessLine(l)}</div>
        {l.pinned && (
          <div className="mgr-pinned tiny">
            <Icon name="pin" size={13} /> Pinned by {l.pinned.byName}: “{l.pinned.reason}”
          </div>
        )}
      </td>
      <td data-label="DPD" className={`right num${l.dpd >= 25 ? ' mgr-bad' : ''}`}>{l.dpd}</td>
      <td data-label="Outstanding" className="right num">{formatRupees(l.outstanding)}</td>
      <td className="cell-corner">
        {l.score ? (
          <PriorityBadge priority={l.score.priority} title={l.score.confidenceNote ?? undefined} />
        ) : (
          <span className="badge">Not scored</span>
        )}
      </td>
      <td data-label="Top reason" className="small mgr-reason cell-wide">
        {reason ? reason.text : <span className="muted">—</span>}
        {l.score?.confidence === 'low' && <div className="tiny muted">Low confidence{l.score.confidenceNote ? `: ${l.score.confidenceNote}` : ''}</div>}
      </td>
      <td data-label="Open promise" className={`small${l.openPromise ? '' : ' cell-hide-sm'}`}>
        {l.openPromise ? (
          <span className="mgr-promise">
            <span className="num">{formatRupees(l.openPromise.amount)} · {fmtDay(l.openPromise.promiseDate)}</span>
            {(l.openPromise.status === 'broken' || l.openPromise.status === 'due_today') && <PromiseBadge status={l.openPromise.status} />}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td data-label="Contacted">
        {l.contactedToday ? (
          <span className="mgr-check"><Icon name="check" size={16} /> <span className="small">Today</span></span>
        ) : (
          <span className="muted small">Not yet</span>
        )}
      </td>
      <td className="cell-wide mgr-actions">
        <div className="row">
          {l.pinned ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onUnpin} disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="pin" size={15} />} Unpin
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onPin} title="Pin to the top of the officer's list">
              <Icon name="pin" size={15} /> Pin
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={onMove} title="Give this loan to another officer">
            <Icon name="arrow-right" size={15} /> Move
          </button>
        </div>
      </td>
    </tr>
  );
}

function PinDialog({ loan, officerName, onClose, onConfirm }: {
  loan: LoanCard;
  officerName: string;
  onClose: () => void;
  onConfirm: (loan: LoanCard, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const trimmed = reason.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      setError('Add a reason so the officer knows why this comes first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(loan, trimmed);
    } catch (err) {
      setError(errorText(err instanceof Error ? err : new Error(String(err))));
      setSaving(false);
    }
  };

  return (
    <Dialog
      title="Pin to top"
      sub={<>{loan.borrowerName} goes first on {firstName(officerName)}’s list, above the score order, until you unpin it.</>}
      onClose={onClose}
    >
      <form onSubmit={submit} className="stack" noValidate>
        <div className="field">
          <label htmlFor="pin-reason">Reason</label>
          <textarea
            id="pin-reason"
            className="textarea"
            maxLength={REASON_MAX}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. Owner travelling from Thursday; collect before then"
            aria-invalid={error ? true : undefined}
            aria-describedby="pin-reason-hint"
            autoFocus
            rows={3}
          />
          <div className="row-between" id="pin-reason-hint">
            <span className="field-error" role={error ? 'alert' : undefined}>{error ?? ''}</span>
            <span className={`tiny num ${reason.length >= REASON_MAX ? 'mgr-warn' : 'muted'}`}>{reason.length}/{REASON_MAX}</span>
          </div>
          <p className="hint">Saved with the pin, so anyone looking at the list knows why it comes first.</p>
        </div>
        <div className="mgr-dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving && <span className="spinner" aria-hidden="true" />} Pin to top
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ReassignDialog({ loan, currentId, currentBranchId, team, teamError, onRetryTeam, onClose, onConfirm }: {
  loan: LoanCard;
  currentId: string;
  currentBranchId: string;
  team: TeamOfficer[] | null;
  teamError: Error | null;
  onRetryTeam: () => void;
  onClose: () => void;
  onConfirm: (loan: LoanCard, to: TeamOfficer) => Promise<void>;
}) {
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const others = (team ?? []).filter((o) => o.id !== currentId);
  const byLoad = (a: TeamOfficer, b: TeamOfficer) => a.openLoans / (a.cap || 1) - b.openLoans / (b.cap || 1);
  const same = others.filter((o) => o.branchId === currentBranchId).sort(byLoad);
  const elsewhere = others.filter((o) => o.branchId !== currentBranchId).sort(byLoad);
  const chosen = others.find((o) => o.id === to);
  const covers = chosen?.pincodes.includes(loan.pincode);

  const label = (o: TeamOfficer) =>
    `${o.name} · ${o.openLoans}/${o.cap}${o.openLoans >= o.cap ? ' (full)' : ''}${o.pincodes.includes(loan.pincode) ? ' · covers pincode' : ''}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) {
      setError('Choose an officer.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(loan, chosen);
    } catch (err) {
      setError(errorText(err instanceof Error ? err : new Error(String(err))));
      setSaving(false);
    }
  };

  return (
    <Dialog title="Reassign loan" sub={<>{loan.borrowerName} · <span className="mono">{loan.id}</span> · pincode {loan.pincode}</>} onClose={onClose}>
      {teamError && !team ? (
        <ErrorState error={teamError} onRetry={onRetryTeam} what="officers" />
      ) : !team ? (
        <SkeletonRows rows={2} h={40} />
      ) : others.length === 0 ? (
        <p className="muted small">There is no other officer to move this loan to.</p>
      ) : (
        <form onSubmit={submit} className="stack" noValidate>
          <div className="field">
            <label htmlFor="reassign-to">New officer</label>
            <select
              id="reassign-to"
              className="select"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setError(null);
              }}
              autoFocus
            >
              <option value="">Choose an officer…</option>
              {same.length > 0 && (
                <optgroup label="Same branch">
                  {same.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
                </optgroup>
              )}
              {elsewhere.length > 0 && (
                <optgroup label="Other branches">
                  {elsewhere.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
                </optgroup>
              )}
            </select>
            {error && <span className="field-error" role="alert">{error}</span>}
            {chosen && !covers && (
              <p className="hint">{chosen.name} doesn’t usually cover {loan.pincode}. Visits may take longer.</p>
            )}
            {chosen && chosen.openLoans >= chosen.cap && (
              <p className="hint mgr-warn">{chosen.name} is at their cap of {chosen.cap} loans.</p>
            )}
          </div>
          <div className="mgr-dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving && <span className="spinner" aria-hidden="true" />} Reassign
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
