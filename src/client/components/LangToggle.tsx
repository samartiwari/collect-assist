// EN / हिं switch. Saved to the user's profile (PATCH /auth/me) and on this phone.
import type { Lang } from '../../shared/types';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';

const OPTIONS: { value: Lang; label: string; full: string }[] = [
  { value: 'en', label: 'EN', full: 'English' },
  { value: 'hi', label: 'हिं', full: 'हिन्दी' },
];

export function LangToggle() {
  const { setLang } = useAuth();
  const { t, lang } = useT();
  return (
    <div className="segmented lang-toggle" role="group" aria-label={t('lang.label')}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          lang={o.value}
          aria-pressed={lang === o.value}
          aria-label={o.full}
          onClick={() => setLang(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
