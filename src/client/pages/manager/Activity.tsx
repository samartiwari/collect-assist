// /m/activity — every call and visit attempt, with where visits were logged from.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ActivityResponse, ActivityRow, TeamResponse } from '../../../shared/types';
import { addDays, istDate } from '../../../shared/time';
import { formatPct, formatRupees } from '../../lib/api';
import { now } from '../../lib/clock';
import { fmtDay, fmtDayWeek, fmtDistance, fmtNum, fmtTime } from './format';
import { useResource } from './hooks';
import { EmptyState, ErrorState, Icon, PageHead, SkeletonRows } from './ui';

const AT_SITE_M = 300;

export function activityPath(date: string, officerId: string): string {
  const q = new URLSearchParams({ date });
  if (officerId) q.set('officerId', officerId);
  return `/activity?${q.toString()}`;
}

export function ManagerActivity() {
  const today = istDate(now());
  const [params, setParams] = useSearchParams();
  const paramDate = params.get('date');
  const [date, setDateState] = useState(paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate) && paramDate <= today ? paramDate : today);
  const [officerId, setOfficerState] = useState(params.get('officerId') ?? '');
  const team = useResource<TeamResponse>('/team');
  const res = useResource<ActivityResponse>(activityPath(date, officerId));

  const sync = (d: string, o: string) => {
    const next: Record<string, string> = {};
    if (d !== today) next.date = d;
    if (o) next.officerId = o;
    setParams(next, { replace: true });
  };
  const setDate = (d: string) => {
    setDateState(d);
    sync(d, officerId);
  };
  const setOfficer = (o: string) => {
    setOfficerState(o);
    sync(date, o);
  };

  const officers = [...(team.data?.officers ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const isToday = date === today;

  return (
    <div className="page mgr">
      <PageHead title="Activity" sub="Calls and visits as officers logged them. Times are IST." />

      <div className="mgr-toolbar">
        <div className="mgr-datenav" role="group" aria-label="Day">
          <button type="button" className="btn btn-sm icon-btn mgr-icon-sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
            <Icon name="chev-left" />
          </button>
          <span className="mgr-datenav-label num" aria-live="polite">
            {isToday ? `Today, ${fmtDay(date)}` : date === addDays(today, -1) ? `Yesterday, ${fmtDay(date)}` : fmtDayWeek(date)}
          </span>
          <button type="button" className="btn btn-sm icon-btn mgr-icon-sm" onClick={() => setDate(addDays(date, 1))} disabled={isToday} aria-label="Next day">
            <Icon name="chev-right" />
          </button>
          {!isToday && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDate(today)}>Today</button>}
        </div>
        <label className="mgr-select-wrap">
          <span className="sr-only">Officer</span>
          <select className="select" value={officerId} onChange={(e) => setOfficer(e.target.value)} disabled={!team.data && !team.error}>
            <option value="">All officers</option>
            {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      </div>

      {res.error ? (
        <section className="card"><ErrorState error={res.error} onRetry={res.reload} what="activity" /></section>
      ) : !res.data ? (
        <>
          <div className="mgr-summary" aria-busy="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton mgr-summary-skel" />)}</div>
          <section className="card"><div className="card-body"><SkeletonRows rows={8} h={22} /></div></section>
        </>
      ) : (
        <div className={res.loading ? 'mgr-refreshing' : undefined}>
          <ActivitySummary rows={res.data.attempts} />
          <section className="card mgr-section">
            {res.data.attempts.length === 0 ? (
              <EmptyState title={`No attempts ${isToday ? 'yet today' : `on ${fmtDay(date)}`}`}>
                {isToday
                  ? 'Calls and visits appear here as officers log them. Offline entries arrive when their phone reconnects.'
                  : 'Nothing was logged on this day. Try another day or officer.'}
              </EmptyState>
            ) : (
              <ActivityTable rows={res.data.attempts} showOfficer={!officerId} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ---------- shared pieces (also used on the officer list page) ----------

export function ActivitySummary({ rows }: { rows: ActivityRow[] }) {
  const visits = rows.filter((r) => r.kind === 'visit');
  const withGps = visits.filter((r) => r.distanceM !== null);
  const atSite = withGps.filter((r) => (r.distanceM ?? Infinity) <= AT_SITE_M).length;
  const sameDay = rows.filter((r) => r.sameDay).length;
  const blocked = rows.filter((r) => r.status === 'blocked').length;
  const items = [
    { label: 'Attempts', value: fmtNum(rows.length), sub: `${fmtNum(rows.length - visits.length)} calls` },
    { label: 'Visits', value: fmtNum(visits.length), sub: `${fmtNum(withGps.length)} with GPS` },
    { label: 'At site', value: withGps.length ? formatPct(atSite / withGps.length) : '—', sub: `Within ${AT_SITE_M} m of address` },
    { label: 'Logged same day', value: rows.length ? formatPct(sameDay / rows.length) : '—', sub: 'Synced the day it happened' },
    { label: 'Blocked', value: fmtNum(blocked), sub: 'Outside 8 am–7 pm', warn: blocked > 0 },
  ];
  return (
    <div className="mgr-summary">
      {items.map((i) => (
        <div key={i.label} className="mgr-summary-item">
          <div className="stat-label">{i.label}</div>
          <div className={`mgr-summary-value${i.warn ? ' mgr-bad' : ''}`}>{i.value}</div>
          <div className="tiny muted">{i.sub}</div>
        </div>
      ))}
    </div>
  );
}

function outcomeText(r: ActivityRow): string {
  switch (r.outcome) {
    case 'paid':
      return r.amount ? `Paid ${formatRupees(r.amount)}` : 'Paid';
    case 'promise':
      return `Promise${r.amount ? ` ${formatRupees(r.amount)}` : ''}${r.promiseDate ? ` for ${fmtDay(r.promiseDate)}` : ''}`;
    case 'not_reachable':
      return 'Not reachable';
    case 'dispute':
      return 'Dispute';
    default:
      return '—';
  }
}

function Location({ r }: { r: ActivityRow }) {
  if (r.lat === null || r.lng === null) {
    return r.kind === 'visit' ? <span className="badge">No GPS</span> : <span className="muted">—</span>;
  }
  const map = (
    <a className="mgr-maplink tiny" href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">
      Map
    </a>
  );
  if (r.distanceM === null) return <span className="mgr-loc"><span className="muted small">GPS recorded</span> {map}</span>;
  return (
    <span className="mgr-loc">
      {r.distanceM <= AT_SITE_M ? (
        <span className="badge badge-ok">At site ({fmtDistance(r.distanceM)})</span>
      ) : (
        <span className="badge badge-mid">{fmtDistance(r.distanceM)} from address</span>
      )}
      {map}
    </span>
  );
}

export function ActivityTable({ rows, showOfficer }: { rows: ActivityRow[]; showOfficer: boolean }) {
  const sorted = [...rows].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return (
    <div className="table-wrap">
      <table className="table mgr-table mgr-cards mgr-activity">
        <thead>
          <tr>
            <th scope="col">Time</th>
            {showOfficer && <th scope="col">Officer</th>}
            <th scope="col">Borrower</th>
            <th scope="col">Type</th>
            <th scope="col">Outcome</th>
            <th scope="col">Status</th>
            <th scope="col">Location</th>
            <th scope="col">Flags</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const flags = [r.createdOffline && 'Logged offline', !r.sameDay && 'Synced next day'].filter(Boolean);
            return (
              <tr key={r.id} className={r.status === 'blocked' ? 'mgr-row-blocked' : undefined}>
                <td className="cell-corner num small mgr-nowrap">{fmtTime(r.occurredAt)}</td>
                {showOfficer && <td data-label="Officer" className="mgr-nowrap">{r.officerName}</td>}
                <td className="cell-title mgr-col-borrower">
                  <Link to={`/loan/${encodeURIComponent(r.loanId)}`} className="mgr-borrower">{r.borrowerName}</Link>
                  <div className="tiny muted mono">{r.loanId}</div>
                </td>
                <td data-label="Type">{r.kind === 'visit' ? 'Visit' : 'Call'}</td>
                <td data-label="Outcome">
                  {r.status === 'blocked' ? <span className="muted">Not applied</span> : outcomeText(r)}
                  {r.note && <div className="tiny muted mgr-note-line" title={r.note}>{r.note}</div>}
                </td>
                <td data-label="Status" className={r.status === 'blocked' ? undefined : 'cell-hide-sm'}>
                  {r.status === 'blocked' ? (
                    <span className="badge badge-high">Blocked · outside hours</span>
                  ) : (
                    <span className="muted small">Recorded</span>
                  )}
                </td>
                <td data-label="Location" className={r.kind === 'call' && r.lat === null ? 'cell-hide-sm' : undefined}><Location r={r} /></td>
                <td data-label="Flags" className={flags.length ? undefined : 'cell-hide-sm'}>
                  {flags.length ? (
                    <span className="mgr-flags">
                      {r.createdOffline && <span className="badge">Logged offline</span>}
                      {!r.sameDay && <span className="badge badge-mid">Synced next day</span>}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
