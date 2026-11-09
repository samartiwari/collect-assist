// "Does the priority score work?" — the weekly back-test, in plain English.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BacktestResponse } from '../../../shared/types';
import { istDate } from '../../../shared/time';
import { formatPct } from '../../lib/api';
import { fmtDay, fmtMonth, fmtMonthShort, fmtNum, fmtSigned } from './format';
import { useElementWidth, type Resource } from './hooks';
import { ErrorState, Skeleton } from './ui';

export function ModelCheckCard({ bt }: { bt: Resource<BacktestResponse> }) {
  return (
    <section className="card mgr-section" aria-labelledby="model-title">
      <div className="card-head">
        <div>
          <h2 id="model-title">Does the priority score work?</h2>
          <p className="tiny muted">Scores from past months checked against what actually happened</p>
        </div>
        {bt.data && <span className="badge mono">{bt.data.modelVersion}</span>}
      </div>
      <div className="card-body">
        {bt.error ? (
          <ErrorState error={bt.error} onRetry={bt.reload} what="the back-test" />
        ) : bt.data ? (
          <ModelBody data={bt.data} />
        ) : (
          <div className="stack">
            <div className="grid-2"><Skeleton h={88} /><Skeleton h={88} /></div>
            <div className="grid-2"><Skeleton h={220} /><Skeleton h={220} /></div>
          </div>
        )}
      </div>
    </section>
  );
}

function monthRange(months: string[]): string {
  if (months.length === 0) return '—';
  const first = months[0]!;
  const last = months[months.length - 1]!;
  if (months.length === 1) return fmtMonth(first);
  return first.slice(0, 4) === last.slice(0, 4) ? `${fmtMonthShort(first)}–${fmtMonth(last)}` : `${fmtMonth(first)}–${fmtMonth(last)}`;
}

function ModelBody({ data }: { data: BacktestResponse }) {
  const aucPct = Math.round(data.auc * 100);
  const trained = istDate(new Date(data.trainedAt));
  return (
    <div className="stack-lg">
      <div className="mgr-figs mgr-figs-2">
        <div className="mgr-fig">
          <div className="stat-label">Ranking accuracy (AUC)</div>
          <div className="mgr-fig-value">{data.auc.toFixed(2)}</div>
          <div className="stat-sub">
            Ranks a loan that rolled above one that didn’t {aucPct}% of the time. 0.50 would be a coin toss.
          </div>
        </div>
        <div className="mgr-fig">
          <div className="stat-label">Top-fifth capture</div>
          <div className="mgr-fig-value">{formatPct(data.topFifthCapture)}</div>
          <div className="stat-sub">
            Top 20% of scores caught {formatPct(data.topFifthCapture)} of loans that rolled. Picking at random would catch 20%.
          </div>
        </div>
      </div>

      <div className="mgr-model-grid">
        <div>
          <h3 className="mgr-h3">Predicted vs actual, by score band</h3>
          <p className="tiny muted mgr-h3-sub">Close pairs mean the score’s percentages can be taken at face value.</p>
          {data.calibration.length > 0 ? (
            <CalibrationChart rows={data.calibration} />
          ) : (
            <p className="muted small">Not enough test loans to compare bands yet.</p>
          )}
        </div>
        <div>
          <h3 className="mgr-h3">What moves the score</h3>
          <p className="tiny muted mgr-h3-sub">Model weights. Longer bars matter more.</p>
          <Weights weights={data.weights} />
        </div>
      </div>

      <div className="mgr-model-foot">
        <p className="tiny muted">
          Model <span className="mono">{data.modelVersion}</span> · trained {fmtDay(trained)} {trained.slice(0, 4)} on{' '}
          {monthRange(data.trainMonths)} · tested on {monthRange(data.testMonths)} ({fmtNum(data.testCount)} loans)
        </p>
        <p className="mgr-note small">
          The score is advisory. If it looks wrong for a borrower, pin that loan for the officer from the{' '}
          <Link to="/m/team">Team page</Link>.
        </p>
      </div>
    </div>
  );
}

// ---------- calibration: paired columns per band ----------
type Band = BacktestResponse['calibration'][number];

function colPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function CalibrationChart({ rows }: { rows: Band[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const H = 196;
  const pad = { top: 10, right: 4, bottom: 26, left: 38 };
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const slot = plotW / rows.length;
  const bw = Math.max(6, Math.min(20, slot * 0.3));
  const maxV = Math.max(0.1, ...rows.flatMap((r) => [r.predicted, r.actual]));
  const stepP = maxV > 0.5 ? 20 : 10;
  const hiP = Math.ceil((maxV * 100) / stepP) * stepP;
  const ticks: number[] = [];
  for (let t = 0; t <= hiP; t += stepP) ticks.push(t);
  const yAt = (v: number) => pad.top + (1 - (v * 100) / hiP) * plotH;
  const base = pad.top + plotH;
  const hovered = hover !== null ? rows[hover] : undefined;

  return (
    <div>
      <div className="mgr-legend mgr-legend-static" aria-hidden="true">
        <span><span className="mgr-swatch mgr-swatch-muted" /> Predicted</span>
        <span><span className="mgr-swatch mgr-swatch-accent" /> Actual</span>
      </div>
      <div ref={ref} className="mgr-chart">
        {width > 0 && (
          <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="mgr-svg" role="img"
            aria-label="Predicted and actual roll rate for each score band. A table version follows.">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={pad.left + plotW} y1={yAt(t / 100)} y2={yAt(t / 100)} stroke="var(--line)" />
                <text x={pad.left - 8} y={yAt(t / 100)} dy="0.32em" textAnchor="end" className="mgr-axis">{t}%</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cx = pad.left + slot * i + slot / 2;
              const hp = base - yAt(r.predicted);
              const ha = base - yAt(r.actual);
              return (
                <g key={r.band}>
                  {hover === i && <rect x={cx - slot / 2 + 2} y={pad.top} width={slot - 4} height={plotH} fill="var(--surface-2)" rx={6} />}
                  {hp > 0 && <path d={colPath(cx - bw - 1, yAt(r.predicted), bw, hp)} fill="var(--mgr-series-muted)" />}
                  {ha > 0 && <path d={colPath(cx + 1, yAt(r.actual), bw, ha)} fill="var(--accent)" />}
                  <text x={cx} y={base + 17} textAnchor="middle" className="mgr-axis">{r.band}</text>
                  <rect
                    x={cx - slot / 2} y={0} width={slot} height={H} fill="transparent"
                    tabIndex={0}
                    aria-label={`Band ${r.band}: predicted ${formatPct(r.predicted)}, actual ${formatPct(r.actual)}, ${r.count} loans`}
                    onPointerEnter={() => setHover(i)}
                    onPointerDown={() => setHover(i)}
                    onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    style={{ outline: 'none' }}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {hovered && hover !== null && (
          <div
            className="mgr-tip"
            style={
              (pad.left + slot * hover + slot / 2) > width * 0.55
                ? { right: width - (pad.left + slot * hover) + 6, top: 4 }
                : { left: pad.left + slot * (hover + 1) - 6, top: 4 }
            }
          >
            <div className="mgr-tip-head">Score band {hovered.band}</div>
            <div className="mgr-tip-rows">
              <div className="mgr-tip-row">
                <span className="mgr-tip-key" style={{ background: 'var(--mgr-series-muted)' }} />
                <strong className="num">{formatPct(hovered.predicted)}</strong>
                <span className="mgr-tip-name">Predicted</span>
                <span />
              </div>
              <div className="mgr-tip-row">
                <span className="mgr-tip-key" style={{ background: 'var(--accent)' }} />
                <strong className="num">{formatPct(hovered.actual)}</strong>
                <span className="mgr-tip-name">Actually rolled</span>
                <span />
              </div>
            </div>
            <div className="tiny muted mgr-tip-foot">{fmtNum(hovered.count)} test loans</div>
          </div>
        )}
      </div>
      <details className="mgr-details">
        <summary className="tiny">Show as table</summary>
        <div className="table-wrap">
          <table className="table mgr-table mgr-table-compact">
            <thead>
              <tr>
                <th scope="col">Score band</th>
                <th scope="col" className="right">Predicted</th>
                <th scope="col" className="right">Actual</th>
                <th scope="col" className="right">Loans</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.band}>
                  <td>{r.band}</td>
                  <td className="right num">{formatPct(r.predicted, 1)}</td>
                  <td className="right num">{formatPct(r.actual, 1)}</td>
                  <td className="right num">{fmtNum(r.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ---------- weights: diverging bars around zero ----------
function Weights({ weights }: { weights: BacktestResponse['weights'] }) {
  if (weights.length === 0) return <p className="muted small">No weights published for this model.</p>;
  const sorted = [...weights].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const max = Math.max(...sorted.map((w) => Math.abs(w.weight)), 1e-9);
  return (
    <div>
      <div className="mgr-weights-legend tiny muted" aria-hidden="true">
        <span><span className="mgr-swatch mgr-swatch-down" /> Lowers risk</span>
        <span><span className="mgr-swatch mgr-swatch-up" /> Raises risk</span>
      </div>
      <ul className="mgr-weights">
        {sorted.map((w) => (
          <li key={w.feature} aria-label={`${w.label}: ${w.weight >= 0 ? 'raises' : 'lowers'} risk, weight ${fmtSigned(w.weight)}`}>
            <span className="mgr-w-label small">{w.label}</span>
            <span className="mgr-w-bar" aria-hidden="true">
              <span
                className={w.weight >= 0 ? 'mgr-w-up' : 'mgr-w-down'}
                style={{ width: `${(Math.abs(w.weight) / max) * 50}%` }}
              />
            </span>
            <span className="mgr-w-val num small">{fmtSigned(w.weight)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
