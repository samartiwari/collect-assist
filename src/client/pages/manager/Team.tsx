// /m/team — one card per field officer: workload, today's effort, promise health.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TeamOfficer, TeamResponse } from '../../../shared/types';
import { formatPct } from '../../lib/api';
import { now } from '../../lib/clock';
import { fmtDateTime, fmtNum, fmtRelative, plural } from './format';
import { useResource } from './hooks';
import { EmptyState, ErrorState, Icon, LoadMeter, PageHead, Skeleton } from './ui';

type SortKey = 'workload' | 'broken' | 'name';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'workload', label: 'Workload' },
  { key: 'broken', label: 'Broken promises' },
  { key: 'name', label: 'Name' },
];

const sorters: Record<SortKey, (a: TeamOfficer, b: TeamOfficer) => number> = {
  workload: (a, b) => b.openLoans / (b.cap || 1) - a.openLoans / (a.cap || 1) || a.name.localeCompare(b.name),
  broken: (a, b) => b.brokenPromises - a.brokenPromises || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

export function ManagerTeam() {
  const res = useResource<TeamResponse>('/team');
  const [sort, setSort] = useState<SortKey>('workload');
  const [query, setQuery] = useState('');
  const officers = res.data?.officers ?? [];

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = officers
      .filter((o) => !q || o.name.toLowerCase().includes(q) || o.pincodes.some((p) => p.includes(q)))
      .sort(sorters[sort]);
    const byBranch = new Map<string, { name: string; officers: TeamOfficer[] }>();
    for (const o of list) {
      const g = byBranch.get(o.branchId) ?? { name: o.branchName, officers: [] };
      g.officers.push(o);
      byBranch.set(o.branchId, g);
    }
    return [...byBranch.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [officers, sort, query]);

  const multiBranch = new Set(officers.map((o) => o.branchId)).size > 1;
  const totals = officers.reduce(
    (t, o) => ({ loans: t.loans + o.openLoans, attempts: t.attempts + o.attemptsToday, broken: t.broken + o.brokenPromises }),
    { loans: 0, attempts: 0, broken: 0 },
  );

  return (
    <div className="page mgr">
      <PageHead
        title="Team"
        sub={
          res.data
            ? `${plural(officers.length, 'officer')} · ${plural(totals.loans, 'open loan')} · ${plural(totals.attempts, 'attempt')} today`
            : 'Field officers, their lists and today’s work'
        }
      />

      <div className="mgr-toolbar">
        <div className="mgr-sort">
          <span className="tiny muted" id="sort-label">Sort by</span>
          <div className="mgr-seg-scroll">
            <div className="segmented" role="group" aria-labelledby="sort-label">
              {SORTS.map((s) => (
                <button key={s.key} type="button" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>{s.label}</button>
              ))}
            </div>
          </div>
        </div>
        {officers.length > 8 && (
          <label className="mgr-search mgr-search-sm">
            <Icon name="search" size={16} />
            <span className="sr-only">Find officer or pincode</span>
            <input className="input" type="search" placeholder="Officer or pincode" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}
      </div>

      {res.error ? (
        <section className="card"><ErrorState error={res.error} onRetry={res.reload} what="the team" /></section>
      ) : !res.data ? (
        <div className="mgr-officer-grid" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card mgr-officer">
              <Skeleton h={32} w="60%" />
              <Skeleton h={8} />
              <Skeleton h={44} />
            </div>
          ))}
        </div>
      ) : officers.length === 0 ? (
        <section className="card">
          <EmptyState title="No field officers yet">Officers appear here once they are set up for your branch.</EmptyState>
        </section>
      ) : groups.length === 0 ? (
        <section className="card">
          <EmptyState title={`No officer matches “${query}”`} action={<button type="button" className="btn btn-sm" onClick={() => setQuery('')}>Clear search</button>} />
        </section>
      ) : (
        <div className={`stack-lg${res.loading ? ' mgr-refreshing' : ''}`}>
          {groups.map((g) => (
            <section key={g.name} aria-label={g.name}>
              {multiBranch && (
                <h2 className="mgr-group-title">
                  {g.name} <span className="muted tiny">{plural(g.officers.length, 'officer')}</span>
                </h2>
              )}
              <div className="mgr-officer-grid">
                {g.officers.map((o) => <OfficerCard key={o.id} o={o} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function OfficerCard({ o }: { o: TeamOfficer }) {
  const t = now();
  const recent = o.lastActivityAt !== null && t.getTime() - new Date(o.lastActivityAt).getTime() < 60 * 60 * 1000;
  return (
    <Link to={`/m/team/${encodeURIComponent(o.id)}`} className="card mgr-officer mgr-officer-link">
      <div className="mgr-officer-top">
        <span className="mgr-avatar" aria-hidden="true">{initials(o.name)}</span>
        <div className="grow">
          <h3 className="mgr-officer-name">{o.name}</h3>
          <p className="tiny muted">{o.branchName}</p>
        </div>
        <span className="tiny muted mgr-last" title={o.lastActivityAt ? `Last activity ${fmtDateTime(o.lastActivityAt, t)} IST` : undefined}>
          <span className={recent ? 'mgr-dot mgr-dot-on' : 'mgr-dot'} aria-hidden="true" />
          {o.lastActivityAt ? fmtRelative(o.lastActivityAt, t) : 'No activity yet'}
        </span>
      </div>

      {o.pincodes.length > 0 && (
        <div className="mgr-pins" aria-label="Pincodes covered">
          {o.pincodes.map((p) => <span key={p} className="mgr-pin-chip num">{p}</span>)}
        </div>
      )}

      <div>
        <div className="row-between tiny mgr-meter-label">
          <span className="muted">Workload</span>
          <span className="num"><strong>{fmtNum(o.openLoans)}</strong> <span className="muted">/ {fmtNum(o.cap)} loans</span></span>
        </div>
        <LoadMeter value={o.openLoans} cap={o.cap} label={`${o.name} workload: ${o.openLoans} of ${o.cap}`} />
      </div>

      <p className="small mgr-today">
        <span className="muted">Today</span> {plural(o.attemptsToday, 'attempt')} · {plural(o.visitsToday, 'visit')}
      </p>

      <dl className="mgr-officer-stats">
        <div>
          <dt>Open promises</dt>
          <dd className="num">{fmtNum(o.openPromises)}</dd>
        </div>
        <div>
          <dt>Broken</dt>
          <dd className={`num${o.brokenPromises > 0 ? ' mgr-bad' : ''}`}>{fmtNum(o.brokenPromises)}</dd>
        </div>
        <div>
          <dt title="Share of attempts synced the same day, last 7 days">Logged same day</dt>
          <dd className={`num${o.sameDayPct7d < 0.8 ? ' mgr-warn' : ''}`}>{formatPct(o.sameDayPct7d)}</dd>
        </div>
      </dl>

      <span className="mgr-officer-cta tiny">
        Open list <Icon name="arrow-right" size={14} />
      </span>
    </Link>
  );
}
