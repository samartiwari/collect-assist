// /m/import — the morning overdue CSV: choose, check, import. Assignment is previewed before anything is written.
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AssignRule, ImportPreview, ImportResult, ImportSummary, OfficerLoad } from '../../../shared/types';
import { api, HttpError } from '../../lib/api';
import { now } from '../../lib/clock';
import { fmtBytes, fmtDateTime, fmtNum, plural } from './format';
import { useResource, type Resource } from './hooks';
import { EmptyState, ErrorState, Icon, PageHead, SkeletonRows, errorText } from './ui';

const MAX_BYTES = 2 * 1024 * 1024;
const COLUMNS = [
  'loan_id', 'borrower_name', 'business_type', 'phone', 'address', 'pincode',
  'outstanding', 'emi', 'dpd', 'last_payment_date', 'paid_last_3m',
];

interface Picked {
  name: string;
  size: number;
  csv: string;
}

type Stage =
  | { kind: 'choose'; error?: string }
  | { kind: 'checking'; file: Picked }
  | { kind: 'invalid'; file: Picked; error: Error }
  | { kind: 'preview'; file: Picked; preview: ImportPreview; committing: boolean; commitError?: Error }
  | { kind: 'done'; file: Picked; result: ImportResult };

export function ManagerImport() {
  const [stage, setStage] = useState<Stage>({ kind: 'choose' });
  const imports = useResource<{ imports: ImportSummary[] }>('/imports');
  const reset = () => setStage({ kind: 'choose' });

  async function pick(file: File) {
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    if (!isCsv) {
      setStage({ kind: 'choose', error: `“${file.name}” is not a CSV file. In Excel, use File › Save As › CSV (comma delimited), then choose that file.` });
      return;
    }
    if (file.size > MAX_BYTES) {
      setStage({ kind: 'choose', error: `“${file.name}” is ${fmtBytes(file.size)}. The limit is 2 MB. Export only today’s 1–30 DPD list.` });
      return;
    }
    if (file.size === 0) {
      setStage({ kind: 'choose', error: `“${file.name}” is empty.` });
      return;
    }
    const picked: Picked = { name: file.name, size: file.size, csv: await file.text() };
    setStage({ kind: 'checking', file: picked });
    try {
      const preview = await api.post<ImportPreview>('/imports/preview', { filename: picked.name, csv: picked.csv });
      setStage({ kind: 'preview', file: picked, preview, committing: false });
    } catch (e) {
      setStage({ kind: 'invalid', file: picked, error: e instanceof Error ? e : new Error(String(e)) });
    }
  }

  async function commit(s: Extract<Stage, { kind: 'preview' }>) {
    setStage({ ...s, committing: true, commitError: undefined });
    try {
      const result = await api.post<ImportResult>('/imports/commit', { filename: s.file.name, csv: s.file.csv });
      setStage({ kind: 'done', file: s.file, result });
      imports.reload();
    } catch (e) {
      setStage({ ...s, committing: false, commitError: e instanceof Error ? e : new Error(String(e)) });
    }
  }

  const stepIndex = stage.kind === 'choose' ? 0 : stage.kind === 'done' ? 2 : 1;

  return (
    <div className="page mgr">
      <PageHead
        title="Import overdue list"
        sub="Upload this morning’s export from the loan system. Loans are checked and assigned before anything is saved."
      />
      <Stepper current={stepIndex} done={stage.kind === 'done'} />

      {stage.kind === 'choose' && <ChooseFile error={stage.error} onPick={pick} />}

      {stage.kind === 'checking' && (
        <section className="card mgr-section">
          <div className="mgr-checking">
            <span className="spinner" aria-hidden="true" />
            <div>
              <strong>Checking {stage.file.name}</strong>
              <p className="tiny muted">{fmtBytes(stage.file.size)} · validating rows and working out assignments</p>
            </div>
          </div>
        </section>
      )}

      {stage.kind === 'invalid' && <InvalidFile file={stage.file} error={stage.error} onReset={reset} />}

      {stage.kind === 'preview' && <Preview stage={stage} onCommit={() => commit(stage)} onReset={reset} />}

      {stage.kind === 'done' && <Done file={stage.file} result={stage.result} onReset={reset} />}

      <RecentImports res={imports} />
    </div>
  );
}

// ---------- step indicator ----------
function Stepper({ current, done }: { current: number; done: boolean }) {
  const steps = ['Choose file', 'Check', 'Import'];
  return (
    <ol className="mgr-steps" aria-label="Import steps">
      {steps.map((s, i) => {
        const state = i < current || (done && i === current) ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s} className={`mgr-step mgr-step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="mgr-step-dot">{state === 'done' ? <Icon name="check" size={14} /> : i + 1}</span>
            <span className="mgr-step-label">{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- step 1 ----------
function ChooseFile({ error, onPick }: { error?: string; onPick: (f: File) => void }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A file dropped just outside the zone would otherwise make the browser open it and leave the page.
  useEffect(() => {
    const stop = (e: globalThis.DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onPick(f);
  };

  return (
    <div className="mgr-import-grid">
      <div
        className={`mgr-drop${over ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={onDrop}
      >
        <span className="mgr-drop-icon"><Icon name="upload" size={26} /></span>
        <p className="mgr-drop-title">Drop today’s overdue CSV here</p>
        <p className="muted small">or</p>
        <label className="btn btn-primary mgr-file-btn">
          Choose file
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              if (inputRef.current) inputRef.current.value = '';
            }}
          />
        </label>
        <p className="tiny muted">CSV, up to 2 MB</p>
        {error && (
          <div className="banner banner-error mgr-drop-error" role="alert">
            <Icon name="alert" /> <span>{error}</span>
          </div>
        )}
      </div>

      <aside className="card card-pad mgr-format">
        <h3 className="mgr-h3">Expected columns</h3>
        <p className="tiny muted mgr-h3-sub">Header row first, in this order. One row per overdue loan.</p>
        <div className="mgr-colchips">
          {COLUMNS.map((c) => <code key={c} className="mgr-colchip">{c}</code>)}
        </div>
        <ul className="mgr-rules small">
          <li><code className="mono">dpd</code> between 1 and 30</li>
          <li><code className="mono">pincode</code> covered by an officer in your branch</li>
          <li>Money in whole rupees; dates as YYYY-MM-DD</li>
          <li>Bad rows are listed and skipped. Good rows still import.</li>
        </ul>
        <a className="btn btn-sm" href="/api/imports/sample.csv" download>
          <Icon name="file" size={16} /> Download sample CSV
        </a>
      </aside>
    </div>
  );
}

// ---------- validation failure (400 etc.) ----------
function describe(d: unknown): string {
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    if (typeof o.message === 'string') {
      const where = [o.row !== undefined ? `Row ${String(o.row)}` : null, typeof o.field === 'string' ? o.field : null]
        .filter(Boolean)
        .join(', ');
      return where ? `${where}: ${o.message}` : o.message;
    }
  }
  return JSON.stringify(d);
}

function ErrorDetails({ details }: { details: unknown }) {
  if (details === undefined || details === null) return null;
  const items: ReactNode[] = Array.isArray(details)
    ? details.map((d, i) => <li key={i}>{describe(d)}</li>)
    : typeof details === 'object'
      ? Object.entries(details as Record<string, unknown>).map(([k, v]) => (
          <li key={k}><span className="mono">{k}</span>: {Array.isArray(v) ? v.map(describe).join('; ') : describe(v)}</li>
        ))
      : [<li key="0">{String(details)}</li>];
  return <ul className="mgr-error-list small">{items}</ul>;
}

function InvalidFile({ file, error, onReset }: { file: Picked; error: Error; onReset: () => void }) {
  return (
    <section className="card mgr-section">
      <div className="card-body stack">
        <div className="banner banner-error" role="alert">
          <Icon name="alert" />
          <div className="grow">
            <strong>{file.name} can’t be imported</strong>
            <p>{errorText(error)}</p>
            {error instanceof HttpError && <ErrorDetails details={error.details} />}
          </div>
        </div>
        <p className="small muted">
          Nothing was saved. Fix the file (compare it with the sample CSV) and choose it again.
        </p>
        <div className="row wrap">
          <button type="button" className="btn btn-primary" onClick={onReset}>Choose another file</button>
          <a className="btn" href="/api/imports/sample.csv" download>Download sample CSV</a>
        </div>
      </div>
    </section>
  );
}

// ---------- step 2: preview ----------
const RULES: Record<AssignRule, { label: string; cls: string; order: number }> = {
  unassigned: { label: 'Needs manual assignment', cls: 'badge-high', order: 0 },
  branch_overflow: { label: 'Overflow', cls: 'badge-mid', order: 1 },
  pincode_least_load: { label: 'Pincode match', cls: 'badge-info', order: 2 },
  kept: { label: 'Same officer', cls: 'badge-low', order: 3 },
};

function Preview({ stage, onCommit, onReset }: {
  stage: Extract<Stage, { kind: 'preview' }>;
  onCommit: () => void;
  onReset: () => void;
}) {
  const { file, preview: p, committing, commitError } = stage;
  const unassigned = p.assignments.filter((a) => a.rule === 'unassigned').length;
  const counts: { label: string; value: number; sub?: string; tone?: 'bad' }[] = [
    { label: 'Rows in file', value: p.fileRows },
    { label: 'Valid', value: p.validRows },
    { label: 'Errors', value: p.errors.length, sub: p.errors.length ? 'Will be skipped' : undefined, tone: p.errors.length ? 'bad' : undefined },
    { label: 'New loans', value: p.newLoans },
    { label: 'Updated', value: p.updatedLoans },
    { label: 'Cured', value: p.curedLoans, sub: 'No longer overdue, will be closed' },
  ];

  const summary = [
    `${plural(p.newLoans, 'new loan')} and ${plural(p.updatedLoans, 'update')}.`,
    p.curedLoans > 0 ? `${plural(p.curedLoans, 'loan')} no longer overdue will be closed.` : null,
    p.errors.length > 0 ? `${plural(p.errors.length, 'row')} with errors will be skipped.` : null,
    unassigned > 0 ? `${plural(unassigned, 'loan')} will need manual assignment.` : null,
  ].filter(Boolean).join(' ');

  return (
    <>
      <section className="card mgr-section">
        <div className="card-head">
          <div className="row mgr-file">
            <span className="mgr-file-icon"><Icon name="file" /></span>
            <div className="grow">
              <h2 className="mgr-file-name">{file.name}</h2>
              <p className="tiny muted">{fmtBytes(file.size)} · checked, nothing saved yet</p>
            </div>
          </div>
        </div>
        <div className="card-body stack-lg">
          <div className="mgr-counts">
            {counts.map((c) => (
              <div key={c.label} className="mgr-count">
                <div className="stat-label">{c.label}</div>
                <div className={`mgr-count-value num${c.tone === 'bad' ? ' mgr-bad' : ''}`}>{fmtNum(c.value)}</div>
                {c.sub && <div className="tiny muted">{c.sub}</div>}
              </div>
            ))}
          </div>
          {commitError && (
            <div className="banner banner-error" role="alert">
              <Icon name="alert" />
              <div>
                <strong>Import failed. Nothing was saved.</strong>
                <p>{errorText(commitError)}</p>
                {commitError instanceof HttpError && <ErrorDetails details={commitError.details} />}
              </div>
            </div>
          )}
          <div className="mgr-ready">
            <p className="small">{p.validRows > 0 ? summary : 'No valid rows in this file. Fix the errors below and choose it again.'}</p>
            <div className="row wrap">
              <button type="button" className="btn btn-primary" disabled={p.validRows === 0 || committing} onClick={onCommit}>
                {committing ? <><span className="spinner" aria-hidden="true" /> Importing…</> : `Import ${plural(p.validRows, 'loan')}`}
              </button>
              <button type="button" className="btn" onClick={onReset} disabled={committing}>Choose another file</button>
            </div>
          </div>
        </div>
      </section>

      {p.errors.length > 0 && <RowErrors errors={p.errors} />}
      {p.assignments.length > 0 && <Assignments rows={p.assignments} />}
      {p.officerLoad.length > 0 && <LoadChart loads={p.officerLoad} />}
    </>
  );
}

function RowErrors({ errors }: { errors: ImportPreview['errors'] }) {
  return (
    <section className="card mgr-section" aria-labelledby="err-title">
      <div className="card-head">
        <div>
          <h2 id="err-title">{plural(errors.length, 'row')} will be skipped</h2>
          <p className="tiny muted">Good rows import without them. Fix these in the loan system and they come in with the next file.</p>
        </div>
      </div>
      <div className="table-wrap mgr-scroll-y">
        <table className="table mgr-table">
          <thead>
            <tr>
              <th scope="col" className="right">Row</th>
              <th scope="col">Field</th>
              <th scope="col">Problem</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((e, i) => (
              <tr key={`${e.row}-${e.field}-${i}`}>
                <td className="right num">{e.row}</td>
                <td><code className="mono">{e.field}</code></td>
                <td>{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Assignments({ rows }: { rows: ImportPreview['assignments'] }) {
  const [rule, setRule] = useState<AssignRule | 'all'>('all');
  const [limit, setLimit] = useState(50);
  const byRule = (r: AssignRule) => rows.filter((a) => a.rule === r).length;
  const present = (Object.keys(RULES) as AssignRule[]).filter((r) => byRule(r) > 0);
  const filtered = rows
    .filter((a) => rule === 'all' || a.rule === rule)
    .sort((a, b) => RULES[a.rule].order - RULES[b.rule].order || a.loanId.localeCompare(b.loanId));
  const shown = filtered.slice(0, limit);

  return (
    <section className="card mgr-section" aria-labelledby="assign-title">
      <div className="card-head mgr-head-wrap">
        <div>
          <h2 id="assign-title">Who gets each loan</h2>
          <p className="tiny muted">Same officer if already assigned, else the least-loaded officer covering the pincode.</p>
        </div>
      </div>
      <div className="card-body mgr-filter-row">
        <div className="mgr-seg-scroll">
          <div className="segmented" role="group" aria-label="Filter by rule">
            <button type="button" aria-pressed={rule === 'all'} onClick={() => setRule('all')}>
              All <span className="mgr-seg-count">{fmtNum(rows.length)}</span>
            </button>
            {present.map((r) => (
              <button key={r} type="button" aria-pressed={rule === r} onClick={() => setRule(r)}>
                {RULES[r].label} <span className="mgr-seg-count">{fmtNum(byRule(r))}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table mgr-table mgr-cards">
          <thead>
            <tr>
              <th scope="col">Loan</th>
              <th scope="col">Borrower</th>
              <th scope="col">Pincode</th>
              <th scope="col">Officer</th>
              <th scope="col">Rule</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.loanId}>
                <td className="cell-title"><span className="mono">{a.loanId}</span></td>
                <td data-label="Borrower">{a.borrowerName}</td>
                <td data-label="Pincode" className="num">{a.pincode}</td>
                <td data-label="Officer">{a.officerName ?? <span className="muted">No officer</span>}</td>
                <td className="cell-corner"><span className={`badge ${RULES[a.rule].cls}`}>{RULES[a.rule].label}</span></td>
                <td data-label="Note" className="small muted cell-wide">{a.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > shown.length && (
        <div className="card-body mgr-more">
          <button type="button" className="btn btn-sm" onClick={() => setLimit(filtered.length)}>
            Show all {fmtNum(filtered.length)}
          </button>
        </div>
      )}
    </section>
  );
}

function LoadChart({ loads }: { loads: OfficerLoad[] }) {
  const max = Math.max(1, ...loads.flatMap((l) => [l.before, l.after, l.cap])) * 1.04;
  const pct = (n: number) => `${(n / max) * 100}%`;
  const sorted = [...loads].sort((a, b) => b.after / (b.cap || 1) - a.after / (a.cap || 1));
  return (
    <section className="card mgr-section" aria-labelledby="load-title">
      <div className="card-head mgr-head-wrap">
        <div>
          <h2 id="load-title">Officer workload after import</h2>
          <p className="tiny muted">Open loans per officer against their cap.</p>
        </div>
        <div className="mgr-legend mgr-legend-static tiny" aria-hidden="true">
          <span><span className="mgr-swatch mgr-swatch-muted" /> Before</span>
          <span><span className="mgr-swatch mgr-swatch-accent" /> Added</span>
          <span><span className="mgr-swatch mgr-swatch-released" /> Closed</span>
          <span><span className="mgr-swatch mgr-swatch-cap" /> Cap</span>
        </div>
      </div>
      <ul className="card-body mgr-load">
        {sorted.map((l) => {
          const over = l.after > l.cap;
          return (
            <li key={l.officerId} className="mgr-load-row"
              aria-label={`${l.name}: ${l.before} before, ${l.after} after, cap ${l.cap}${over ? ', over cap' : ''}`}>
              <span className="mgr-load-name small">
                <span className="mgr-load-name-text">{l.name}</span>
                {over && <span className="badge badge-high">Over cap</span>}
              </span>
              <div className="mgr-load-track" aria-hidden="true">
                <div className="mgr-load-bar">
                  <span className="mgr-load-before" style={{ width: pct(Math.min(l.before, l.after)) }} />
                  {l.after > l.before && <span className={over ? 'mgr-load-added is-over' : 'mgr-load-added'} style={{ width: pct(l.after - l.before) }} />}
                  {l.after < l.before && <span className="mgr-load-released" style={{ width: pct(l.before - l.after) }} />}
                </div>
                <span className="mgr-load-cap" style={{ left: pct(l.cap) }} />
              </div>
              <span className="mgr-load-num small num">
                {l.before} → <strong>{l.after}</strong> <span className="muted">/ {l.cap}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- step 3 ----------
function Done({ file, result, onReset }: { file: Picked; result: ImportResult; onReset: () => void }) {
  const cells = [
    { label: 'Imported', value: result.imported },
    { label: 'Assigned', value: result.assigned },
    { label: 'Need assignment', value: result.unassigned, tone: result.unassigned > 0 ? 'bad' : undefined },
    { label: 'Closed (cured)', value: result.cured },
    { label: 'Rescored', value: result.rescored },
  ];
  return (
    <section className="card mgr-section mgr-done" aria-live="polite">
      <div className="card-body stack-lg">
        <div className="row mgr-done-head">
          <span className="mgr-done-icon"><Icon name="check" size={24} /></span>
          <div>
            <h2>Imported {plural(result.imported, 'loan')}</h2>
            <p className="small muted">{file.name} · officers see their updated lists now</p>
          </div>
        </div>
        <div className="mgr-counts mgr-counts-5">
          {cells.map((c) => (
            <div key={c.label} className="mgr-count">
              <div className="stat-label">{c.label}</div>
              <div className={`mgr-count-value num${c.tone === 'bad' ? ' mgr-bad' : ''}`}>{fmtNum(c.value)}</div>
            </div>
          ))}
        </div>
        {result.unassigned > 0 && (
          <div className="banner banner-warn">
            <Icon name="alert" />
            <span>
              {plural(result.unassigned, 'loan')} could not be matched to an officer. They stay unassigned until an officer covers
              their pincode or someone takes them on.
            </span>
          </div>
        )}
        <div className="row wrap">
          <Link to="/m/team" className="btn btn-primary">See team lists</Link>
          <Link to="/m" className="btn">Overview</Link>
          <button type="button" className="btn btn-ghost" onClick={onReset}>Import another file</button>
        </div>
      </div>
    </section>
  );
}

// ---------- history ----------
function RecentImports({ res }: { res: Resource<{ imports: ImportSummary[] }> }) {
  const list = res.data?.imports ?? [];
  const today = now();
  return (
    <section className="card mgr-section" aria-labelledby="recent-title">
      <div className="card-head">
        <h2 id="recent-title">Recent imports</h2>
      </div>
      {res.error ? (
        <ErrorState error={res.error} onRetry={res.reload} what="recent imports" />
      ) : !res.data ? (
        <div className="card-body"><SkeletonRows rows={4} /></div>
      ) : list.length === 0 ? (
        <EmptyState title="No imports yet">Each morning’s file will be listed here once imported.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table mgr-table mgr-cards">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">File</th>
                <th scope="col">By</th>
                <th scope="col" className="right">Rows</th>
                <th scope="col" className="right">Imported</th>
                <th scope="col" className="right">Errors</th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id}>
                  <td className="cell-title num">{fmtDateTime(i.createdAt, today)}</td>
                  <td data-label="File" className="mgr-ellipsis" title={i.filename}>{i.filename}</td>
                  <td data-label="By">{i.uploadedByName}</td>
                  <td data-label="Rows" className="right num">{fmtNum(i.rowsTotal)}</td>
                  <td data-label="Imported" className="right num">{fmtNum(i.rowsOk)}</td>
                  <td data-label="Errors" className="right num">
                    {i.rowsError > 0 ? <span className="badge badge-high">{fmtNum(i.rowsError)}</span> : <span className="muted">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
