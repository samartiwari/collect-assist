// /m/promises — every promise to pay in scope, filterable by status, officer and borrower.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { PromiseRow, PromisesResponse, PromiseStatus } from '../../../shared/types';
import { formatRupees } from '../../lib/api';
import { now } from '../../lib/clock';
import { fmtDay, fmtNum, fmtRelative, plural } from './format';
import { useResource } from './hooks';
import { EmptyState, ErrorState, Icon, PageHead, PromiseBadge, SkeletonRows } from './ui';

type Filter = PromiseStatus | 'all';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'due_today', label: 'Due today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'broken', label: 'Broken' },
  { key: 'kept', label: 'Kept' },
  { key: 'all', label: 'All' },
];
const EMPTY_COPY: Record<Filter, string> = {
  due_today: 'No promises fall due today.',
  upcoming: 'No upcoming promises. Officers record them when a borrower commits to a date.',
  broken: 'No broken promises. Every promise due so far has been kept.',
  kept: 'No kept promises yet.',
  all: 'No promises recorded yet. They appear here as officers log them.',
};
const STATUS_ORDER: Record<PromiseStatus, number> = { broken: 0, due_today: 1, upcoming: 2, kept: 3 };

function isFilter(v: string | null): v is Filter {
  return FILTERS.some((f) => f.key === v);
}

function sortPromises(a: PromiseRow, b: PromiseRow): number {
  const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (s !== 0) return s;
  if (a.status === 'broken') return (b.daysLate ?? 0) - (a.daysLate ?? 0);
  if (a.status === 'kept') return b.promiseDate.localeCompare(a.promiseDate);
  return a.promiseDate.localeCompare(b.promiseDate) || b.amount - a.amount;
}

export function ManagerPromises() {
  const res = useResource<PromisesResponse>('/promises?status=all');
  const [params, setParams] = useSearchParams();
  const initial = params.get('status');
  const [status, setStatusState] = useState<Filter>(isFilter(initial) ? initial : 'all');
  const [officer, setOfficer] = useState('');
  const [query, setQuery] = useState('');

  const setStatus = (f: Filter) => {
    setStatusState(f);
    setParams(f === 'all' ? {} : { status: f }, { replace: true });
  };

  const rows = res.data?.promises ?? [];
  const officers = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.officerId, r.officerName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  // officer + search narrow everything, so the status counts always agree with the table
  const narrowed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => (!officer || r.officerId === officer) &&
        (!q || r.borrowerName.toLowerCase().includes(q) || r.loanId.toLowerCase().includes(q)),
    );
  }, [rows, officer, query]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { due_today: 0, upcoming: 0, broken: 0, kept: 0, all: narrowed.length };
    for (const r of narrowed) c[r.status] += 1;
    return c;
  }, [narrowed]);

  const shown = useMemo(
    () => narrowed.filter((r) => status === 'all' || r.status === status).sort(sortPromises),
    [narrowed, status],
  );
  const total = shown.reduce((n, r) => n + r.amount, 0);
  const filtersActive = officer !== '' || query.trim() !== '';
  const today = now();

  return (
    <div className="page mgr">
      <PageHead title="Promises to pay" sub="What borrowers committed to, and whether they kept it." />

      <section className="card mgr-section">
        <div className="card-body mgr-filters">
          <div className="mgr-seg-scroll">
            <div className="segmented" role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" aria-pressed={status === f.key} onClick={() => setStatus(f.key)}>
                  {f.label} <span className="mgr-seg-count">{res.data ? fmtNum(counts[f.key]) : '–'}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mgr-filter-controls">
            <label className="mgr-search">
              <Icon name="search" size={16} />
              <span className="sr-only">Search borrower or loan ID</span>
              <input
                className="input"
                type="search"
                placeholder="Borrower or loan ID"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="mgr-select-wrap">
              <span className="sr-only">Officer</span>
              <select className="select" value={officer} onChange={(e) => setOfficer(e.target.value)}>
                <option value="">All officers</option>
                {officers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          </div>
        </div>

        {res.error ? (
          <ErrorState error={res.error} onRetry={res.reload} what="promises" />
        ) : !res.data ? (
          <div className="card-body"><SkeletonRows rows={8} h={22} /></div>
        ) : shown.length === 0 ? (
          filtersActive ? (
            <EmptyState
              title="No promises match"
              action={<button type="button" className="btn btn-sm" onClick={() => { setOfficer(''); setQuery(''); }}>Clear filters</button>}
            >
              Nothing {status === 'all' ? '' : `${FILTERS.find((f) => f.key === status)?.label.toLowerCase()} `}for this officer or search.
            </EmptyState>
          ) : (
            <EmptyState title="Nothing here">{EMPTY_COPY[status]}</EmptyState>
          )
        ) : (
          <>
            <div className={`table-wrap${res.loading ? ' mgr-refreshing' : ''}`}>
              <table className="table mgr-table mgr-cards">
                <thead>
                  <tr>
                    <th scope="col">Borrower</th>
                    <th scope="col">Loan</th>
                    <th scope="col">Officer</th>
                    <th scope="col" className="right">Amount</th>
                    <th scope="col">Promised for</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="right">Days late</th>
                    <th scope="col">Last reminder</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-title">
                        <Link to={`/loan/${encodeURIComponent(r.loanId)}`} className="mgr-borrower">{r.borrowerName}</Link>
                      </td>
                      <td data-label="Loan"><span className="mono">{r.loanId}</span></td>
                      <td data-label="Officer">{r.officerName}</td>
                      <td data-label="Amount" className="right num">{formatRupees(r.amount)}</td>
                      <td data-label="Promised for" className="num">{fmtDay(r.promiseDate)}</td>
                      <td className="cell-corner"><PromiseBadge status={r.status} /></td>
                      <td data-label="Days late" className={`right num${r.daysLate ? '' : ' cell-hide-sm'}`}>
                        {r.daysLate ? <span className="mgr-bad">{r.daysLate} d</span> : <span className="muted">—</span>}
                      </td>
                      <td data-label="Last reminder" className="small">
                        {r.lastReminderAt ? fmtRelative(r.lastReminderAt, today) : <span className="muted">None</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-body mgr-table-foot tiny muted">
              {plural(shown.length, 'promise')} · {formatRupees(total)} promised
            </div>
          </>
        )}
      </section>
    </div>
  );
}
