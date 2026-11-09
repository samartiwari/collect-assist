// /m — "the Friday Excel, live": today's KPIs, roll rate by branch, and the model back-test.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BacktestResponse, BranchRollRate, RollRatePoint, RollRatesResponse } from '../../../shared/types';
import { istDate } from '../../../shared/time';
import { formatPct } from '../../lib/api';
import { now } from '../../lib/clock';
import { fmtDayLong, fmtMonth, fmtMonthShort, fmtNum, fmtPts, fmtRate } from './format';
import { useResource, type Resource } from './hooks';
import { ModelCheckCard } from './ModelCheck';
import { RollRateChart, type ChartSeries } from './RollRateChart';
import { ErrorState, Icon, PageHead, Skeleton } from './ui';

export function ManagerOverview() {
  const rr = useResource<RollRatesResponse>('/dashboard/roll-rates');
  const bt = useResource<BacktestResponse>('/dashboard/backtest');
  const today = istDate(now());

  return (
    <div className="page mgr">
      <PageHead
        title="Collections overview"
        sub={
          <>
            {rr.data ? `${scopeLabel(rr.data.branches)} · ` : ''}{fmtDayLong(today)}
          </>
        }
        actions={
          <Link to="/m/import" className="btn btn-sm">
            <Icon name="upload" size={16} /> Import today’s list
          </Link>
        }
      />

      {rr.error ? (
        <section className="card mgr-section">
          <ErrorState error={rr.error} onRetry={rr.reload} what="collection numbers" />
        </section>
      ) : (
        <>
          <KpiTiles rr={rr} />
          <RollRateCard data={rr.data} />
        </>
      )}

      <ModelCheckCard bt={bt} />
    </div>
  );
}

function scopeLabel(branches: BranchRollRate[]): string {
  if (branches.length === 1) return `${branches[0]!.branchName} branch`;
  if (branches.length === 0) return 'Your branch';
  return `All ${branches.length} branches`;
}

// ---------- KPI tiles ----------
interface Tile {
  label: string;
  value: string;
  sub: string;
  to?: string;
  tone?: 'warn';
}

function KpiTiles({ rr }: { rr: Resource<RollRatesResponse> }) {
  if (!rr.data) {
    return (
      <div className="mgr-kpis" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card stat mgr-kpi">
            <Skeleton h={13} w="70%" />
            <Skeleton h={28} w="40%" className="mgr-skel-gap" />
            <Skeleton h={12} w="85%" className="mgr-skel-gap" />
          </div>
        ))}
      </div>
    );
  }
  const k = rr.data.kpis;
  const tiles: Tile[] = [
    { label: 'Promises due today', value: fmtNum(k.promisesDueToday), sub: 'Follow up before 7 pm', to: '/m/promises?status=due_today' },
    {
      label: 'Broken promises',
      value: fmtNum(k.brokenPromises7d),
      sub: 'Last 7 days',
      to: '/m/promises?status=broken',
      tone: k.brokenPromises7d > 0 ? 'warn' : undefined,
    },
    { label: 'Attempts today', value: fmtNum(k.attemptsToday), sub: 'Calls and visits logged', to: '/m/activity' },
    {
      label: 'Logged same day',
      value: formatPct(k.sameDayLoggedPct7d),
      sub: 'Of attempts, last 7 days',
      to: '/m/activity',
      tone: k.sameDayLoggedPct7d < 0.8 ? 'warn' : undefined,
    },
    { label: 'Blocked attempts', value: fmtNum(k.blockedAttempts7d), sub: 'Outside 8 am–7 pm, last 7 days', to: '/m/activity' },
    k.unassignedLoans > 0
      ? { label: 'Unassigned loans', value: fmtNum(k.unassignedLoans), sub: 'No officer yet. Assign them', to: '/m/team/unassigned', tone: 'warn' }
      : { label: 'Unassigned loans', value: '0', sub: 'Every loan has an officer' },
  ];
  return (
    <div className={`mgr-kpis${rr.loading ? ' mgr-refreshing' : ''}`}>
      {tiles.map((t) => {
        const body = (
          <>
            <div className="stat-label">{t.label}</div>
            <div className="stat-value mgr-kpi-value">{t.value}</div>
            <div className={`stat-sub${t.tone === 'warn' ? ' mgr-sub-warn' : ''}`}>{t.sub}</div>
          </>
        );
        return t.to ? (
          <Link key={t.label} to={t.to} className="card stat mgr-kpi mgr-kpi-link">{body}</Link>
        ) : (
          <div key={t.label} className="card stat mgr-kpi">{body}</div>
        );
      })}
    </div>
  );
}

// ---------- roll-rate card ----------
function RollRateCard({ data }: { data: RollRatesResponse | null }) {
  return (
    <section className="card mgr-section" aria-labelledby="rr-title">
      <div className="card-head">
        <div>
          <h2 id="rr-title">Roll rate</h2>
          <p className="tiny muted">Loans moving from 1–30 into 31–60 days past due</p>
        </div>
      </div>
      <div className="card-body">
        {data ? <RollRateBody data={data} /> : (
          <div className="stack">
            <div className="mgr-figs">
              {[0, 1, 2].map((i) => <Skeleton key={i} h={52} />)}
            </div>
            <Skeleton h={260} />
          </div>
        )}
      </div>
    </section>
  );
}

interface SeriesStats {
  key: string;
  name: string;
  last: RollRatePoint | null;
  prev: RollRatePoint | null;
  projected: ChartSeries['projected'];
}

function statsOf(s: ChartSeries): SeriesStats {
  const pts = s.points.filter((p): p is RollRatePoint => p !== null);
  return { key: s.key, name: s.name, last: pts[pts.length - 1] ?? null, prev: pts[pts.length - 2] ?? null, projected: s.projected };
}

function buildSeries(data: RollRatesResponse): ChartSeries[] {
  const key = (m: string) => m.slice(0, 7);
  const align = (pts: RollRatePoint[]) => {
    const byMonth = new Map(pts.map((p) => [key(p.month), p]));
    return data.months.map((m) => byMonth.get(key(m)) ?? null);
  };
  const branches: ChartSeries[] = data.branches.map((b) => ({
    key: b.branchId,
    name: b.branchName,
    points: align(b.series),
    projected: { rate: b.current.projectedRate, inBucket: b.current.inBucket, atRisk: b.current.atRisk },
  }));
  if (data.branches.length <= 1) return branches;

  const inBucket = data.branches.reduce((n, b) => n + b.current.inBucket, 0);
  const atRisk = data.branches.reduce((n, b) => n + b.current.atRisk, 0);
  const weighted = data.branches.reduce((n, b) => n + b.current.projectedRate * b.current.inBucket, 0);
  const overall: ChartSeries = {
    key: 'all',
    name: 'All branches',
    points: align(data.overall),
    projected: { rate: inBucket > 0 ? weighted / inBucket : 0, inBucket, atRisk },
  };
  return [overall, ...branches];
}

function RollRateBody({ data }: { data: RollRatesResponse }) {
  const series = useMemo(() => buildSeries(data), [data]);
  const [selected, setSelected] = useState(series[0]?.key ?? 'all');
  const multi = series.length > 1;
  const currentMonth = data.branches[0]?.current.month ?? null;

  if (series.length === 0 || (data.months.length === 0 && !currentMonth)) {
    return (
      <p className="muted small mgr-pad-y">
        Roll rates appear after the first full month of imports. Until then, use today’s numbers above.
      </p>
    );
  }

  const sel = statsOf(series.find((s) => s.key === selected) ?? series[0]!);
  const branchStats = series.filter((s) => s.key !== 'all').map(statsOf);
  const overallStats = multi ? statsOf(series[0]!) : null;

  return (
    <div className="stack-lg">
      <Figures stats={sel} target={data.target} baseline={data.baseline} currentMonth={currentMonth} />

      {multi && (
        <div className="mgr-legend" role="group" aria-label="Highlight a series">
          {series.map((s) => (
            <button key={s.key} type="button" className="mgr-chip" aria-pressed={s.key === selected} onClick={() => setSelected(s.key)}>
              <span className="mgr-line-key" aria-hidden="true" />
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div>
        <RollRateChart
          months={data.months}
          currentMonth={currentMonth}
          series={series}
          selected={selected}
          target={data.target}
          baseline={data.baseline}
        />
        <p className="tiny muted mgr-definition">
          Roll rate = share of loans at 1–30 DPD on the 1st of the month that were at 31–60 DPD on the 1st of the next month.
          {currentMonth && ` ${fmtMonthShort(currentMonth)} is projected from today’s scores.`}
        </p>
      </div>

      <BranchTable rows={branchStats} total={overallStats} currentMonth={currentMonth} onSelect={multi ? setSelected : undefined} selected={selected} />
    </div>
  );
}

function Delta({ last, prev, suffix = '' }: { last: RollRatePoint | null; prev: RollRatePoint | null; suffix?: string }) {
  if (!last || !prev) return <span className="muted">—</span>;
  const d = last.rate - prev.rate;
  if (Math.abs(d) < 0.0005) return <span className="muted">No change{suffix}</span>;
  const better = d < 0; // a lower roll rate is good
  return (
    <span className={`mgr-delta ${better ? 'mgr-good' : 'mgr-bad'}`}>
      <span aria-hidden="true">{better ? '▼' : '▲'}</span> {fmtPts(d)}
      <span className="sr-only">{better ? ' lower' : ' higher'}</span>
      {suffix}
    </span>
  );
}

function Figures({ stats, target, baseline, currentMonth }: {
  stats: SeriesStats;
  target: number;
  baseline: number;
  currentMonth: string | null;
}) {
  const { last, prev, projected } = stats;
  const gapBase = projected?.rate ?? last?.rate ?? null;
  const gap = gapBase === null ? null : gapBase - target;
  return (
    <div className="mgr-figs">
      <div className="mgr-fig">
        <div className="stat-label">{last ? `${fmtMonth(last.month)} roll rate` : 'Last full month'}</div>
        <div className="mgr-fig-value">{last ? fmtRate(last.rate) : '—'}</div>
        <div className="stat-sub">
          {last && prev ? <><Delta last={last} prev={prev} /> vs {fmtMonthShort(prev.month)}</> : stats.name}
        </div>
      </div>
      <div className="mgr-fig">
        <div className="stat-label">{currentMonth ? `${fmtMonthShort(currentMonth)} projected` : 'This month'}</div>
        <div className="mgr-fig-value">{projected ? fmtRate(projected.rate) : '—'}</div>
        <div className="stat-sub">{projected ? `${fmtNum(projected.atRisk)} of ${fmtNum(projected.inBucket)} loans at ≥25 DPD` : 'No loans in bucket'}</div>
      </div>
      <div className="mgr-fig">
        <div className="stat-label">Gap to {formatPct(target)} target</div>
        <div className="mgr-fig-value">
          {gap === null ? '—' : gap <= 0 ? 'On target' : fmtPts(gap)}
        </div>
        <div className="stat-sub">
          {gap === null ? `Baseline ${formatPct(baseline)}` : gap <= 0 ? `${fmtPts(gap)} under target` : `Above target · baseline was ${formatPct(baseline)}`}
        </div>
      </div>
    </div>
  );
}

function BranchTable({ rows, total, currentMonth, onSelect, selected }: {
  rows: SeriesStats[];
  total: SeriesStats | null;
  currentMonth: string | null;
  onSelect?: (key: string) => void;
  selected: string;
}) {
  const sorted = [...rows].sort((a, b) => (b.last?.rate ?? -1) - (a.last?.rate ?? -1));
  const ref = sorted.find((r) => r.last) ?? total;
  const lastLabel = ref?.last ? fmtMonthShort(ref.last.month) : 'Last month';
  const prevLabel = ref?.prev ? fmtMonthShort(ref.prev.month) : 'previous';
  const curLabel = currentMonth ? fmtMonthShort(currentMonth) : 'This month';

  const row = (r: SeriesStats, isTotal: boolean) => (
    <tr key={r.key} className={isTotal ? 'mgr-total' : r.key === selected && onSelect ? 'mgr-row-selected' : undefined}>
      <th scope="row">
        {onSelect && !isTotal ? (
          <button type="button" className="mgr-linkbtn" onClick={() => onSelect(r.key)} title="Highlight in chart">{r.name}</button>
        ) : r.name}
      </th>
      <td className="right num">{r.last ? fmtRate(r.last.rate) : '—'}</td>
      <td className="right num"><Delta last={r.last} prev={r.prev} /></td>
      <td className="right num">{r.projected ? fmtRate(r.projected.rate) : '—'}</td>
      <td className="right num">{r.projected ? fmtNum(r.projected.atRisk) : '—'}</td>
      <td className="right num">{r.projected ? fmtNum(r.projected.inBucket) : '—'}</td>
    </tr>
  );

  return (
    <div className="table-wrap mgr-table-wrap">
      <table className="table mgr-table">
        <caption className="sr-only">Roll rate by branch</caption>
        <thead>
          <tr>
            <th scope="col">Branch</th>
            <th scope="col" className="right">{lastLabel} rate</th>
            <th scope="col" className="right">vs {prevLabel}</th>
            <th scope="col" className="right">{curLabel} projected</th>
            <th scope="col" className="right" title="Loans at 25 DPD or more, a few days from rolling">At risk ≥25 DPD</th>
            <th scope="col" className="right">In bucket</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => row(r, false))}
          {total && row(total, true)}
        </tbody>
      </table>
    </div>
  );
}
