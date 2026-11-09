// Demo clock: lets a reviewer move the app's "now" inside or outside the 8 am - 7 pm window.
// Only rendered when the server says demo mode is on.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClockRequest, ClockResponse } from '../../shared/types';
import { istMinutesOfDay, istTimeLabel } from '../../shared/time';
import { api } from '../lib/api';
import { applyClock, clockState, onClockChange } from '../lib/clock';
import { errorMessage, useDismiss, useNow } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { Icon } from './Icons';
import { useToast } from './Toast';

const PRESETS = ['07:55', '08:00', '11:00', '18:55', '19:05'];

function hhmmLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function currentHhmm(d: Date): string {
  const mins = istMinutesOfDay(d);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function useClockState() {
  const [state, setState] = useState(clockState);
  useEffect(() => {
    const off = onClockChange(() => setState(clockState()));
    return () => {
      off();
    };
  }, []);
  return state;
}

export function DemoClock() {
  const { t } = useT();
  const toast = useToast();
  const { demoMode, demoActive } = useClockState();
  const current = useNow(15_000);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  if (!demoMode) return null;

  const label = istTimeLabel(current);

  async function send(body: ClockRequest) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<ClockResponse>('/clock', body);
      applyClock(res);
      setOpen(false);
      toast(body.mode === 'demo' ? t('demo.changed', { time: hhmmLabel(body.istTime) }) : t('demo.resetDone'), { tone: 'ok' });
    } catch (err) {
      setError(t('demo.failed', { msg: errorMessage(err) }));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      setError(t('demo.invalid'));
      return;
    }
    void send({ mode: 'demo', istTime: value });
  }

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        type="button"
        className={`demo-pill${demoActive ? ' demo-pill-active' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setValue(currentHhmm(current));
          setError(null);
          setOpen((o) => !o);
        }}
      >
        <Icon name="clock" size={16} />
        <span className="demo-pill-label">{demoActive ? t('demo.pill', { time: label }) : t('demo.pillOff')}</span>
        <span className="demo-pill-short num">{label}</span>
      </button>

      {open && (
        <div className="popover" role="dialog" aria-label={t('demo.title')}>
          <div className="popover-head">
            <h3>{t('demo.title')}</h3>
            <span className={`badge ${demoActive ? 'badge-mid' : 'badge-low'}`}>
              {demoActive ? t('demo.active', { time: label }) : t('demo.real', { time: label })}
            </span>
          </div>
          <p className="hint">{t('demo.help')}</p>
          <div className="demo-presets">
            {PRESETS.map((p) => (
              <button key={p} type="button" className="btn btn-sm" disabled={busy} onClick={() => void send({ mode: 'demo', istTime: p })}>
                {hhmmLabel(p)}
              </button>
            ))}
          </div>
          <form className="demo-form" onSubmit={onSubmit}>
            <div className="field grow">
              <label htmlFor="demo-time">{t('demo.time')}</label>
              <input id="demo-time" className="input" type="time" value={value} onChange={(e) => setValue(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {t('demo.set')}
            </button>
          </form>
          {error && <p className="field-error" role="alert">{error}</p>}
          {demoActive && (
            <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => void send({ mode: 'real' })}>
              <Icon name="refresh" size={16} />
              {t('demo.reset')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
