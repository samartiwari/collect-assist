// Small pieces of loan UI shared by the Today list and the loan detail screen.
import { useCallback, useEffect, useRef, type MouseEvent } from 'react';
import type { Lang, LoanCard, LoanScore, Outcome, PromiseStatus, PromiseSummary, ScoreReason } from '../../shared/types';
import { contactWindow, istTimeLabel } from '../../shared/time';
import { formatRupees } from '../lib/api';
import { now } from '../lib/clock';
import { formatDateShort, useT, type MsgKey } from '../lib/i18n';
import { enqueue, newId } from '../lib/outbox';
import { opensLabel } from './ContactWindowBanner';
import { Icon } from './Icons';
import { useToast } from './Toast';

export type RiskLevel = 'high' | 'mid' | 'low';

export function riskLevel(priority: number): RiskLevel {
  if (priority >= 50) return 'high';
  if (priority >= 25) return 'mid';
  return 'low';
}

export function RiskBadge({ score, showNumber = true }: { score: LoanScore | null; showNumber?: boolean }) {
  const { t } = useT();
  if (!score) return <span className="badge">{t('risk.none')}</span>;
  const level = riskLevel(score.priority);
  const name = t(`risk.${level}`);
  if (!showNumber) return <span className={`badge badge-${level}`}>{name}</span>;
  return (
    <span className={`badge badge-${level} risk-badge`} aria-label={t('risk.aria', { level: name, n: score.priority })}>
      {name}
      <span className="risk-num num">{score.priority}</span>
    </span>
  );
}

export const PROMISE_BADGE: Record<PromiseStatus, string> = {
  due_today: 'badge-mid',
  upcoming: 'badge-info',
  broken: 'badge-high',
  kept: 'badge-ok',
};

export function reasonText(r: ScoreReason, lang: Lang): string {
  return lang === 'hi' ? r.textHi : r.text;
}

export function outcomeKey(outcome: Outcome | null): MsgKey {
  return outcome ? `outcome.${outcome}` : 'outcome.blocked';
}

export function PromiseChip({ promise, today }: { promise: PromiseSummary; today: string }) {
  const { t, lang } = useT();
  const amount = formatRupees(promise.amount);
  const dueToday = promise.status === 'due_today' || promise.promiseDate === today;
  if (promise.status === 'broken') {
    return (
      <span className="chip chip-broken">
        <Icon name="calendar" size={15} />
        {t('card.promiseBroken', { amount, date: formatDateShort(promise.promiseDate, lang) })}
      </span>
    );
  }
  return (
    <span className={`chip ${dueToday ? 'chip-due' : 'chip-promise'}`}>
      <Icon name="calendar" size={15} />
      {dueToday ? t('card.promiseToday', { amount }) : t('card.promise', { amount, date: formatDateShort(promise.promiseDate, lang) })}
    </span>
  );
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function mapHref(loan: Pick<LoanCard, 'lat' | 'lng' | 'address' | 'pincode'>): string {
  const query = loan.lat !== null && loan.lng !== null ? `${loan.lat},${loan.lng}` : `${loan.address}, ${loan.pincode}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Tapping Call. Inside RBI hours it lets the tel: link open and then nudges the officer to
 * log the outcome (again when they come back from the dialer). Outside RBI hours it stops
 * the dial, explains why, and records the blocked attempt for audit.
 */
export function useCallAction(onLog: (loan: LoanCard) => void) {
  const { t } = useT();
  const toast = useToast();
  const followUp = useRef<{ loan: LoanCard; at: number } | null>(null);
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  const prompt = useCallback(
    (loan: LoanCard) => {
      toast(t('call.prompt', { name: loan.borrowerName }), {
        id: 'call-follow-up',
        durationMs: 15_000,
        action: { label: t('call.promptAction'), onClick: () => onLogRef.current(loan) },
      });
    },
    [t, toast],
  );

  useEffect(() => {
    const onVisible = () => {
      const f = followUp.current;
      if (document.visibilityState !== 'visible' || !f) return;
      followUp.current = null;
      if (Date.now() - f.at < 30 * 60_000) prompt(f.loan);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [prompt]);

  return useCallback(
    (loan: LoanCard, e: MouseEvent<HTMLAnchorElement>) => {
      const at = now();
      const w = contactWindow(at);
      if (!w.open) {
        e.preventDefault();
        toast(t('call.blocked', { time: opensLabel(w, t) }), { tone: 'warn', id: 'call-blocked' });
        void enqueue({
          id: newId(),
          loanId: loan.id,
          kind: 'call',
          outcome: null,
          occurredAt: at.toISOString(),
          createdOffline: !navigator.onLine,
        });
        return;
      }
      if (!loan.phone) {
        e.preventDefault();
        toast(t('call.noPhone'), { tone: 'error' });
        return;
      }
      followUp.current = { loan, at: Date.now() };
      prompt(loan);
    },
    [prompt, t, toast],
  );
}

/** "11:20 AM" (IST) for an instant. */
export function timeOnly(iso: string): string {
  return istTimeLabel(new Date(iso));
}
