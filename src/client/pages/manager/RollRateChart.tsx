// Monthly roll rate per branch: inline SVG line chart drawn at the container's true pixel width.
// Emphasis encoding: the selected series wears the accent, every other series is a quiet grey.
// Completed months are solid; the current month is a dashed segment to a hollow "projected" point.
import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { RollRatePoint } from '../../../shared/types';
import { fmtMonth, fmtMonthShort, fmtNum, fmtRate } from './format';
import { useElementWidth } from './hooks';

export interface ChartSeries {
  key: string;
  name: string;
  points: (RollRatePoint | null)[]; // aligned with `months`
  projected: { rate: number; inBucket: number; atRisk: number } | null;
}

interface Props {
  months: string[]; // completed months, oldest first
  currentMonth: string | null;
  series: ChartSeries[];
  selected: string;
  target: number;
  baseline: number;
}

const ACCENT = 'var(--accent)';
const MUTED = 'var(--mgr-series-muted)';

export function RollRateChart(props: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="mgr-chart">
      {width > 0 && <Plot {...props} width={width} />}
    </div>
  );
}

function Plot({ months, currentMonth, series, selected, target, baseline, width }: Props & { width: number }) {
  const [hover, setHover] = useState<number | null>(null);

  const narrow = width < 560;
  const single = series.length === 1;
  const H = narrow ? 236 : 284;
  const pad = { top: 18, right: narrow ? 58 : 124, bottom: 42, left: 42 };
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const cols = months.length + (currentMonth ? 1 : 0);
  const step = cols > 1 ? plotW / (cols - 1) : 0;
  const xAt = (i: number) => (cols > 1 ? pad.left + i * step : pad.left + plotW / 2);
  const lastCol = cols - 1;
  const projCol = currentMonth ? lastCol : -1;

  // y-domain in whole percent, padded and snapped to 5-point steps
  const values: number[] = [target, baseline];
  for (const s of series) {
    for (const p of s.points) if (p) values.push(p.rate);
    if (s.projected) values.push(s.projected.rate);
  }
  const loP = Math.max(0, Math.floor((Math.min(...values) * 100 - 2) / 5) * 5);
  const hiP = Math.ceil((Math.max(...values) * 100 + 2) / 5) * 5;
  const tickStepP = hiP - loP > 30 ? 10 : 5;
  const ticks: number[] = [];
  for (let t = loP; t <= hiP; t += tickStepP) ticks.push(t);
  const yAt = (rate: number) => pad.top + (1 - (rate * 100 - loP) / (hiP - loP || 1)) * plotH;

  const colorOf = (key: string) => (key === selected ? ACCENT : MUTED);
  const drawOrder = [...series].sort((a, b) => Number(a.key === selected) - Number(b.key === selected));

  // ---- end labels: selected first, others only where they don't collide (and never on phones)
  type EndLabel = { key: string; x: number; y: number; name: string; value: string | null; strong: boolean };
  const endLabels: EndLabel[] = [];
  const taken: [number, number][] = [];
  const endOf = (s: ChartSeries): { x: number; y: number; rate: number } | null => {
    if (s.projected && projCol >= 0) return { x: xAt(projCol), y: yAt(s.projected.rate), rate: s.projected.rate };
    for (let i = s.points.length - 1; i >= 0; i--) {
      const p = s.points[i];
      if (p) return { x: xAt(i), y: yAt(p.rate), rate: p.rate };
    }
    return null;
  };
  for (const s of [...drawOrder].reverse()) {
    const end = endOf(s);
    if (!end) continue;
    const strong = s.key === selected;
    if (!strong && narrow) continue;
    const span: [number, number] = strong ? [end.y - 9, end.y + (single ? 9 : 23)] : [end.y - 8, end.y + 8];
    if (taken.some(([a, b]) => span[0] < b && span[1] > a)) continue;
    taken.push(span);
    const maxChars = narrow ? 8 : 15;
    const name = s.name.length > maxChars ? `${s.name.slice(0, maxChars - 1)}…` : s.name;
    endLabels.push({
      key: s.key,
      x: end.x + 10,
      y: end.y,
      name: single ? fmtRate(end.rate) : name,
      value: strong && !single ? fmtRate(end.rate) : null,
      strong,
    });
  }

  // ---- paths
  const pathFor = (s: ChartSeries) => {
    let d = '';
    let pen = false;
    s.points.forEach((p, i) => {
      if (!p) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p.rate).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const projPathFor = (s: ChartSeries) => {
    if (!s.projected || projCol < 0) return null;
    for (let i = s.points.length - 1; i >= 0; i--) {
      const p = s.points[i];
      if (p) return `M${xAt(i).toFixed(1)},${yAt(p.rate).toFixed(1)}L${xAt(projCol).toFixed(1)},${yAt(s.projected.rate).toFixed(1)}`;
    }
    return null;
  };

  // ---- interaction
  const setFromClientX = (clientX: number, svg: SVGSVGElement) => {
    const px = clientX - svg.getBoundingClientRect().left;
    const i = cols > 1 ? Math.round((px - pad.left) / step) : 0;
    setHover(Math.max(0, Math.min(lastCol, i)));
  };
  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (svg) setFromClientX(e.clientX, svg);
  };
  const onLeave = (e: PointerEvent<SVGRectElement>) => {
    if (e.pointerType === 'mouse') setHover(null);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? lastCol) - 1));
    else if (e.key === 'ArrowRight') setHover((h) => Math.min(lastCol, (h ?? lastCol - 1) + 1));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const labelEvery = narrow && cols > 7 ? 2 : 1;
  const monthAt = (i: number) => (i === projCol && currentMonth ? currentMonth : months[i] ?? '');
  const sel = series.find((s) => s.key === selected) ?? series[0];
  const selEnd = sel ? endOf(sel) : null;
  const ariaLabel = sel && selEnd
    ? `Roll rate by month for ${sel.name}. Latest ${fmtRate(selEnd.rate)}${sel.projected ? ' projected' : ''}. Target ${fmtRate(target)}. Use left and right arrow keys to read each month.`
    : 'Roll rate by month';

  // reference lines: keep their labels apart when the lines are close
  const yTarget = yAt(target);
  const yBase = yAt(baseline);
  const close = Math.abs(yTarget - yBase) < 16;

  return (
    <>
      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        className="mgr-svg"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => setHover((h) => h ?? Math.max(0, projCol >= 0 ? lastCol - 1 : lastCol))}
        onBlur={() => setHover(null)}
      >
        {/* projected column wash */}
        {projCol >= 0 && cols > 1 && (
          <rect x={xAt(projCol) - step / 2} y={pad.top - 6} width={step / 2 + 6} height={plotH + 6}
            fill="var(--surface-2)" opacity={0.7} rx={4} />
        )}

        {/* grid + y ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={pad.left + plotW} y1={yAt(t / 100)} y2={yAt(t / 100)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.left - 8} y={yAt(t / 100)} dy="0.32em" textAnchor="end" className="mgr-axis">{t}%</text>
          </g>
        ))}

        {/* x labels */}
        {Array.from({ length: cols }, (_, i) => {
          if ((lastCol - i) % labelEvery !== 0) return null;
          const m = monthAt(i);
          const isProj = i === projCol;
          const showYear = i === 0 || m.slice(5, 7) === '01';
          return (
            <text key={i} x={xAt(i)} y={pad.top + plotH + 18} textAnchor="middle" className="mgr-axis">
              {fmtMonthShort(m)}
              {(isProj || showYear) && (
                <tspan x={xAt(i)} dy="14" className="mgr-axis-sub">{isProj ? 'so far' : m.slice(0, 4)}</tspan>
              )}
            </text>
          );
        })}

        {/* reference lines */}
        <line x1={pad.left} x2={pad.left + plotW} y1={yBase} y2={yBase} stroke="var(--muted)" strokeWidth={1.25} strokeDasharray="2 4" strokeLinecap="round" />
        <line x1={pad.left} x2={pad.left + plotW} y1={yTarget} y2={yTarget} stroke="var(--ok)" strokeWidth={1.5} strokeDasharray="6 4" />
        <text x={pad.left + 6} y={yBase - 6} className="mgr-ref">Baseline {fmtRate(baseline).replace('.0%', '%')}</text>
        <text x={pad.left + 6} y={close && yTarget > yBase ? yTarget + 14 : yTarget - 6} className="mgr-ref mgr-ref-target">
          Target {fmtRate(target).replace('.0%', '%')}
        </text>

        {/* series */}
        {drawOrder.map((s) => {
          const isSel = s.key === selected;
          const color = colorOf(s.key);
          const proj = projPathFor(s);
          return (
            <g key={s.key}>
              <path d={pathFor(s)} fill="none" stroke={color} strokeWidth={isSel ? 2.25 : 1.5} strokeLinejoin="round" strokeLinecap="round" />
              {proj && <path d={proj} fill="none" stroke={color} strokeWidth={isSel ? 2 : 1.5} strokeDasharray="4 4" strokeLinecap="round" />}
              {isSel && s.points.map((p, i) => p && (
                <circle key={i} cx={xAt(i)} cy={yAt(p.rate)} r={3.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
              ))}
              {s.projected && projCol >= 0 && (
                <circle cx={xAt(projCol)} cy={yAt(s.projected.rate)} r={isSel ? 4.5 : 3.5} fill="var(--surface)" stroke={color} strokeWidth={2} />
              )}
            </g>
          );
        })}

        {/* direct end labels */}
        {endLabels.map((l) => (
          <text key={l.key} x={l.x} y={l.y} dy="0.32em" className={l.strong ? 'mgr-end mgr-end-strong' : 'mgr-end'}>
            {l.name}
            {l.value && <tspan x={l.x} dy="15" className="mgr-end-value">{l.value}</tspan>}
          </text>
        ))}

        {/* crosshair */}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.top - 6} y2={pad.top + plotH} stroke="var(--ink-2)" strokeWidth={1} opacity={0.35} />
            {series.map((s) => {
              const rate = hover === projCol ? s.projected?.rate : s.points[hover]?.rate;
              if (rate === undefined) return null;
              return (
                <circle key={s.key} cx={xAt(hover)} cy={yAt(rate)} r={4.5}
                  fill={hover === projCol ? 'var(--surface)' : colorOf(s.key)}
                  stroke={hover === projCol ? colorOf(s.key) : 'var(--surface)'} strokeWidth={2} />
              );
            })}
          </g>
        )}

        {/* hit layer: the crosshair finds the month, the pointer never has to land on a line */}
        <rect
          x={pad.left - step / 2 - 4}
          y={0}
          width={plotW + step + 8}
          height={H}
          fill="transparent"
          style={{ touchAction: 'pan-y' }}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={onLeave}
        />
      </svg>

      {hover === null && narrow && <p className="mgr-tip-hint tiny muted">Tap the chart to read a month.</p>}
      {hover !== null && (
        <Tooltip
          x={xAt(hover)}
          width={width}
          top={pad.top}
          month={monthAt(hover)}
          projected={hover === projCol}
          rows={series
            .map((s) => {
              if (hover === projCol) {
                const p = s.projected;
                return p ? { s, rate: p.rate, detail: `${fmtNum(p.atRisk)} at risk of ${fmtNum(p.inBucket)}` } : null;
              }
              const p = s.points[hover];
              return p ? { s, rate: p.rate, detail: `${fmtNum(p.rolled)} of ${fmtNum(p.inBucket)} loans` } : null;
            })
            .filter((r): r is { s: ChartSeries; rate: number; detail: string } => r !== null)
            .sort((a, b) => Number(b.s.key === selected) - Number(a.s.key === selected) || b.rate - a.rate)
            .map((r) => ({ key: r.s.key, name: r.s.name, color: colorOf(r.s.key), rate: r.rate, detail: r.detail }))}
        />
      )}
    </>
  );
}

function Tooltip({ x, width, top, month, projected, rows }: {
  x: number;
  width: number;
  top: number;
  month: string;
  projected: boolean;
  rows: { key: string; name: string; color: string; rate: number; detail: string }[];
}) {
  // On phones the readout docks under the chart instead of floating over it.
  const docked = width < 560;
  const flip = x > width * 0.55;
  const style = docked ? undefined : flip ? { right: Math.max(0, width - x + 14), top } : { left: x + 14, top };
  return (
    <div className={docked ? 'mgr-tip mgr-tip-docked' : 'mgr-tip'} style={style} aria-live="polite">
      <div className="mgr-tip-head">
        {fmtMonth(month)}
        {projected && <span className="muted"> · projected</span>}
      </div>
      <div className="mgr-tip-rows">
        {rows.map((r) => (
          <div key={r.key} className="mgr-tip-row">
            <span className="mgr-tip-key" style={{ background: r.color }} />
            <strong className="num">{fmtRate(r.rate)}</strong>
            <span className="mgr-tip-name">{r.name}</span>
            <span className="muted num">{r.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
