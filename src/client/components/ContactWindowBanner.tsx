// RBI contact hours (8 am - 7 pm IST). Always computed from the app clock in IST,
// never from the phone's timezone setting.
import { contactWindow, istTimeLabel, type ContactWindowState } from '../../shared/time';
import { useNow } from '../lib/hooks';
import { formatDuration, useT, type TFn } from '../lib/i18n';
import { Icon } from './Icons';

/** "8:00 AM" or "8:00 AM tomorrow". */
export function opensLabel(w: Extract<ContactWindowState, { open: false }>, t: TFn): string {
  const time = istTimeLabel(w.opensAt);
  return w.reason === 'after_window' ? t('window.tomorrow', { time }) : time;
}

/** Current contact window, refreshed every 30 s and whenever the demo clock moves. */
export function useContactWindow(): ContactWindowState {
  return contactWindow(useNow(30_000));
}

export function ContactWindowBanner({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const w = useContactWindow();

  if (!w.open) {
    return (
      <div className="banner banner-warn window-banner" role="status">
        <Icon name="lock" size={18} className="banner-icon" />
        <span>{t('window.closed', { time: opensLabel(w, t) })}</span>
      </div>
    );
  }

  const time = istTimeLabel(w.closesAt);
  const left = formatDuration(w.minutesLeft, t);
  const closing = w.minutesLeft <= 30;
  return (
    <div className={`window-open${closing ? ' window-closing' : ''}${compact ? ' window-compact' : ''}`} role="status">
      <span className="window-dot" aria-hidden="true" />
      <span>{closing ? t('window.closing', { time, left }) : t('window.open', { time, left })}</span>
    </div>
  );
}
