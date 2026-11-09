// The three-tap outcome log: (1) Log on the card, (2) pick what happened, (3) Save.
// Everything has a sensible default (Visit, EMI amount, "Tomorrow") so the third tap can
// always be Save. The attempt goes into the offline outbox, so saving never waits on signal.
import { useEffect, useId, useRef, useState } from 'react';
import type { AttemptInput, ContactKind, LoanCard, Outcome } from '../../../shared/types';
import { addDays, istDate } from '../../../shared/time';
import { opensLabel, useContactWindow } from '../../components/ContactWindowBanner';
import { Icon, type IconName } from '../../components/Icons';
import { useToast } from '../../components/Toast';
import { formatRupees } from '../../lib/api';
import { now } from '../../lib/clock';
import { formatDateShort, translate, useT, type MsgKey } from '../../lib/i18n';
import { enqueue, newId } from '../../lib/outbox';

const NOTE_MAX = 200;
const PROMISE_MAX_DAYS = 30;

const OUTCOMES: { value: Outcome; icon: IconName }[] = [
  { value: 'paid', icon: 'check' },
  { value: 'promise', icon: 'calendar' },
  { value: 'not_reachable', icon: 'phone-off' },
  { value: 'dispute', icon: 'alert' },
];

type DateChoice = 1 | 3 | 7 | 'other';
const DATE_CHOICES: { value: Exclude<DateChoice, 'other'>; label: MsgKey }[] = [
  { value: 1, label: 'sheet.tomorrow' },
  { value: 3, label: 'sheet.in3' },
  { value: 7, label: 'sheet.in7' },
];

type Geo = { status: 'pending' } | { status: 'ok'; lat: number; lng: number; accuracy: number } | { status: 'off' };

/** Ask for a GPS fix when the sheet opens. Never blocks saving. */
function useGeolocation(): Geo {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const [geo, setGeo] = useState<Geo>(supported ? { status: 'pending' } : { status: 'off' });
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (alive) setGeo({ status: 'ok', lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      () => {
        if (alive) setGeo({ status: 'off' });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
    return () => {
      alive = false;
    };
  }, [supported]);
  return geo;
}

interface Props {
  loan: LoanCard;
  initialKind?: ContactKind;
  onClose: () => void;
  onSaved?: (item: AttemptInput) => void;
}

export function LogOutcomeSheet({ loan, initialKind = 'visit', onClose, onSaved }: Props) {
  const { t, lang } = useT();
  const toast = useToast();
  const w = useContactWindow();
  const geo = useGeolocation();
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);

  const today = istDate(now());
  const maxDate = addDays(today, PROMISE_MAX_DAYS);
  const defaultAmount = Math.max(0, Math.min(loan.emi, loan.outstanding));

  const [kind, setKind] = useState<ContactKind>(initialKind);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [amount, setAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : '');
  const [dateChoice, setDateChoice] = useState<DateChoice>(1);
  const [otherDate, setOtherDate] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  // Escape closes; lock the page behind the sheet; move focus into the dialog (once, on open).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);

  const needsAmount = outcome === 'paid' || outcome === 'promise';
  const amountNum = Number(amount);
  const promiseDate = dateChoice === 'other' ? otherDate : addDays(today, dateChoice);

  const errors: { amount?: string; date?: string; note?: string } = {};
  if (needsAmount) {
    if (amount.trim() === '') errors.amount = t('err.amount');
    else if (!(amountNum > 0)) errors.amount = t('err.amountZero');
    else if (amountNum > loan.outstanding) errors.amount = t('err.amountMax', { max: formatRupees(loan.outstanding) });
  }
  if (outcome === 'promise' && (!/^\d{4}-\d{2}-\d{2}$/.test(promiseDate) || promiseDate < today || promiseDate > maxDate)) {
    errors.date = t('err.date', { max: formatDateShort(maxDate, lang) });
  }
  if (note.length > NOTE_MAX) errors.note = t('err.noteLong');
  else if (outcome === 'dispute' && note.trim() === '') errors.note = t('err.noteRequired');
  const valid = !errors.amount && !errors.date && !errors.note;
  // Show amount/date problems as soon as they exist; the "note required" nudge waits for a Save tap.
  const shown = { ...errors, note: errors.note && (submitted || note.length > NOTE_MAX) ? errors.note : undefined };

  async function save() {
    setSubmitted(true);
    if (!outcome || !w.open || !valid || saving) return;
    setSaving(true);
    const item: AttemptInput = {
      id: newId(),
      loanId: loan.id,
      kind,
      outcome,
      amount: needsAmount ? Math.round(amountNum) : null,
      promiseDate: outcome === 'promise' ? promiseDate : null,
      note: outcome === 'not_reachable' || outcome === 'dispute' ? note.trim() || null : null,
      lat: geo.status === 'ok' ? geo.lat : null,
      lng: geo.status === 'ok' ? geo.lng : null,
      accuracyM: geo.status === 'ok' ? Math.round(geo.accuracy) : null,
      occurredAt: now().toISOString(),
      createdOffline: !navigator.onLine,
    };
    try {
      await enqueue(item);
      onSaved?.(item);
      onClose();
      toast(item.createdOffline ? t('toast.savedOffline') : t('toast.saved'), { tone: 'ok' });
    } catch {
      setSaving(false);
      toast(t('toast.saveFailed'), { tone: 'error' });
    }
  }

  const otherLang = lang === 'hi' ? 'en' : 'hi';

  return (
    <div
      className="sheet-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet log-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={sheetRef} tabIndex={-1}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <div className="grow">
            <h2 id={titleId}>{t('sheet.title')}</h2>
            <p className="small muted truncate">
              {loan.borrowerName} · <span className="mono">{loan.id}</span>
            </p>
          </div>
          <button type="button" className="btn btn-ghost icon-btn" onClick={onClose} aria-label={t('sheet.close')}>
            <Icon name="x" size={22} />
          </button>
        </div>

        {!w.open && (
          <div className="banner banner-warn" role="alert">
            <Icon name="lock" size={18} />
            <span>{t('window.closed', { time: opensLabel(w, t) })}</span>
          </div>
        )}

        <div className="segmented kind-toggle" role="group" aria-label={t('sheet.how')}>
          {(['call', 'visit'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              <Icon name={k === 'call' ? 'phone' : 'map-pin'} size={17} />
              {t(`kind.${k}`)}
            </button>
          ))}
        </div>

        <fieldset className="outcome-set">
          <legend className="label">{t('sheet.outcome')}</legend>
          <div className="outcome-grid">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`outcome-btn outcome-${o.value}`}
              aria-pressed={outcome === o.value}
              onClick={() => setOutcome(o.value)}
            >
              <span className="outcome-icon" aria-hidden="true">
                <Icon name={outcome === o.value ? 'check' : o.icon} size={22} />
              </span>
              <span className="outcome-label">{t(`outcome.${o.value}`)}</span>
              <span className="outcome-alt" lang={otherLang} aria-hidden="true">
                {translate(otherLang, `outcome.${o.value}`)}
              </span>
            </button>
          ))}
          </div>
        </fieldset>

        {needsAmount && (
          <div className="sheet-section">
            <div className="field">
              <label htmlFor="log-amount">{outcome === 'paid' ? t('sheet.amountPaid') : t('sheet.amountPromised')}</label>
              <div className="input-money">
                <span aria-hidden="true">₹</span>
                <input
                  id="log-amount"
                  className="input num"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, '').slice(0, 9))}
                  aria-invalid={shown.amount ? true : undefined}
                  aria-describedby="log-amount-hint"
                />
              </div>
              {shown.amount ? (
                <span id="log-amount-hint" className="field-error">{shown.amount}</span>
              ) : (
                <span id="log-amount-hint" className="hint">
                  {t('sheet.amountHint', { emi: formatRupees(loan.emi), out: formatRupees(loan.outstanding) })}
                </span>
              )}
            </div>
          </div>
        )}

        {outcome === 'promise' && (
          <div className="sheet-section field">
            <span className="label" id="log-when">{t('sheet.when')}</span>
            <div className="date-chips" role="group" aria-labelledby="log-when">
              {DATE_CHOICES.map((c) => (
                <button key={c.value} type="button" className="date-chip" aria-pressed={dateChoice === c.value} onClick={() => setDateChoice(c.value)}>
                  <span>{t(c.label)}</span>
                  <span className="date-chip-sub">{formatDateShort(addDays(today, c.value), lang)}</span>
                </button>
              ))}
              <button type="button" className="date-chip" aria-pressed={dateChoice === 'other'} onClick={() => setDateChoice('other')}>
                <span>{t('sheet.otherDate')}</span>
                <span className="date-chip-sub">{otherDate ? formatDateShort(otherDate, lang) : '…'}</span>
              </button>
            </div>
            {dateChoice === 'other' && (
              <>
                <label htmlFor="log-date" className="sr-only">{t('sheet.otherDate')}</label>
                <input
                  id="log-date"
                  className="input"
                  type="date"
                  min={today}
                  max={maxDate}
                  value={otherDate}
                  onChange={(e) => setOtherDate(e.target.value)}
                  aria-invalid={shown.date ? true : undefined}
                />
              </>
            )}
            {shown.date && <span className="field-error">{shown.date}</span>}
          </div>
        )}

        {(outcome === 'not_reachable' || outcome === 'dispute') && (
          <div className="sheet-section field">
            <div className="row-between">
              <label htmlFor="log-note">{outcome === 'dispute' ? t('sheet.noteRequired') : t('sheet.noteOptional')}</label>
              <span className={`tiny num ${note.length > NOTE_MAX ? 'text-danger' : 'muted'}`}>{t('sheet.chars', { n: note.length })}</span>
            </div>
            <textarea
              id="log-note"
              className="textarea note-input"
              rows={2}
              maxLength={NOTE_MAX + 50}
              placeholder={t('sheet.notePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={shown.note ? true : undefined}
              required={outcome === 'dispute'}
            />
            {shown.note && <span className="field-error">{shown.note}</span>}
          </div>
        )}

        <div className="sheet-foot">
          <p className={`geo geo-${geo.status}`} role="status">
            {geo.status === 'pending' ? <span className="spinner geo-spinner" aria-hidden="true" /> : <Icon name="map-pin" size={15} />}
            {geo.status === 'pending' && t('sheet.locating')}
            {geo.status === 'ok' && t('sheet.located', { m: Math.round(geo.accuracy) })}
            {geo.status === 'off' && t('sheet.locationOff')}
          </p>
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => void save()} disabled={!outcome || !w.open || saving}>
            {!w.open && <Icon name="lock" size={18} />}
            {!w.open ? t('sheet.closed') : saving ? t('sheet.saving') : outcome ? t('sheet.save') : t('sheet.pick')}
          </button>
        </div>
      </div>
    </div>
  );
}
