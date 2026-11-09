import { useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrandMark, Icon } from '../components/Icons';
import { LangToggle } from '../components/LangToggle';
import { HttpError } from '../lib/api';
import { homePath, useAuth } from '../lib/auth';
import { isUnreachable, useOnline } from '../lib/hooks';
import { useT, type MsgKey } from '../lib/i18n';

const DEMO_PASSWORD = 'Demo@1234';

const DEMO_ACCOUNTS: { email: string; name: string; role: MsgKey; note: string }[] = [
  { email: 'rahul@demo.in', name: 'Rahul Chouhan', role: 'role.officer', note: 'Indore City · हिन्दी' },
  { email: 'neha@demo.in', name: 'Neha Solanki', role: 'role.officer', note: 'Indore City · English' },
  { email: 'imran@demo.in', name: 'Imran Qureshi', role: 'role.officer', note: 'Indore City' },
  { email: 'manager.indore@demo.in', name: 'Kavita Jain', role: 'role.manager', note: 'Indore City' },
  { email: 'head@demo.in', name: 'Anil Mehta', role: 'role.head', note: 'All branches' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const { t } = useT();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function validate() {
    const next: typeof errors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = t('login.errEmail');
    if (!password) next.password = t('login.errPassword');
    setErrors(next);
    if (next.email) emailRef.current?.focus();
    else if (next.password) passwordRef.current?.focus();
    return !next.email && !next.password;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const user = await login(email.trim().toLowerCase(), password);
      const from = (location.state as { from?: string } | null)?.from;
      const target = from && (user.role === 'officer' ? !from.startsWith('/m') : from.startsWith('/m') || from.startsWith('/loan/')) ? from : homePath(user.role);
      navigate(target, { replace: true });
    } catch (err) {
      if (isUnreachable(err)) setServerError(t('login.offline'));
      else setServerError(err instanceof HttpError ? err.message : t('state.errorTitle'));
      setBusy(false);
    }
  }

  function fillDemo(addr: string) {
    setEmail(addr);
    setPassword(DEMO_PASSWORD);
    setErrors({});
    setServerError(null);
  }

  return (
    <div className="login">
      <div className="login-top">
        <LangToggle />
      </div>
      <main className="login-main">
        <div className="login-brand">
          <BrandMark size={44} />
          <div>
            <h1>{t('app.name')}</h1>
            <p className="muted">{t('app.tagline')}</p>
          </div>
        </div>

        <form className="card card-pad-lg login-card stack" onSubmit={onSubmit} noValidate>
          <h2>{t('login.title')}</h2>

          {!online && (
            <div className="banner banner-warn" role="status">
              <Icon name="wifi-off" size={18} />
              <span>{t('login.offline')}</span>
            </div>
          )}
          {serverError && (
            <div className="banner banner-error" role="alert">
              <Icon name="alert" size={18} />
              <span>{serverError}</span>
            </div>
          )}

          <div className="field">
            <label htmlFor="login-email">{t('login.email')}</label>
            <input
              ref={emailRef}
              id="login-email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'login-email-err' : undefined}
            />
            {errors.email && (
              <span id="login-email-err" className="field-error">
                {errors.email}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="login-password">{t('login.password')}</label>
            <div className="input-affix">
              <input
                ref={passwordRef}
                id="login-password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? 'login-password-err' : undefined}
              />
              <button
                type="button"
                className="input-affix-btn"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? t('login.hide') : t('login.show')}
              </button>
            </div>
            {errors.password && (
              <span id="login-password-err" className="field-error">
                {errors.password}
              </span>
            )}
          </div>

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('login.busy') : t('login.submit')}
          </button>
        </form>

        <section className="demo-accounts" aria-labelledby="demo-title">
          <h3 id="demo-title">{t('login.demo')}</h3>
          <p className="hint">{t('login.demoHint')}</p>
          <div className="demo-chips">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                className="demo-chip"
                aria-pressed={email === a.email}
                onClick={() => fillDemo(a.email)}
              >
                <span className="demo-chip-name">{a.name}</span>
                <span className="demo-chip-role">
                  {t(a.role)} · {a.note}
                </span>
                <span className="demo-chip-email">{a.email}</span>
              </button>
            ))}
          </div>
        </section>

        <p className="login-footer tiny muted">
          <Icon name="clock" size={14} />
          {t('login.footer')}
        </p>
      </main>
    </div>
  );
}
