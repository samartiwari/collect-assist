// App chrome shared by both roles: top bar (brand, nav, status, account) and the
// phone tab bar. Pages render inside <Outlet />.
import { useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { Role, SessionUser } from '../../shared/types';
import { homePath, useAuth } from '../lib/auth';
import { useDismiss, useOnline, useOutbox } from '../lib/hooks';
import { plural, useT, type MsgKey } from '../lib/i18n';
import { syncNow } from '../lib/outbox';
import { DemoClock } from './DemoClock';
import { BrandMark, Icon, type IconName } from './Icons';
import { LangToggle } from './LangToggle';
import { StatusPill } from './StatusPill';

interface NavItem {
  to: string;
  label: MsgKey;
  icon: IconName;
  end?: boolean;
  badge?: number;
}

function navFor(role: Role, pending: number): NavItem[] {
  if (role === 'officer') {
    return [
      { to: '/today', label: 'nav.today', icon: 'list' },
      { to: '/promises', label: 'nav.promises', icon: 'calendar' },
      { to: '/sync', label: 'nav.sync', icon: 'refresh', badge: pending },
    ];
  }
  return [
    { to: '/m', label: 'nav.overview', icon: 'chart', end: true },
    { to: '/m/import', label: 'nav.import', icon: 'upload' },
    { to: '/m/promises', label: 'nav.promises', icon: 'calendar' },
    { to: '/m/team', label: 'nav.team', icon: 'users' },
    { to: '/m/activity', label: 'nav.activity', icon: 'activity' },
  ];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function UserMenu({ user }: { user: SessionUser }) {
  const { t } = useT();
  const { logout, offlineSession } = useAuth();
  const outbox = useOutbox();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => {
    setOpen(false);
    setConfirming(false);
  });

  const pending = user.role === 'officer' ? outbox.pending.length : 0;
  const roleLabel = t(`role.${user.role}`);
  const branch = user.branchName ?? t('branch.all');

  function onSignOut() {
    if (pending > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    void logout();
  }

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        type="button"
        className="avatar-btn"
        aria-expanded={open}
        aria-label={t('menu.open')}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
        <span className="avatar-name">{user.name.split(' ')[0]}</span>
      </button>
      {open && (
        <div className="popover user-popover">
          <div className="user-card">
            <span className="avatar avatar-lg" aria-hidden="true">{initials(user.name)}</span>
            <div className="grow">
              <p className="user-name">{user.name}</p>
              <p className="tiny muted">{user.email}</p>
              <p className="small user-role">
                {roleLabel} · {branch}
              </p>
            </div>
          </div>
          {user.role === 'officer' && (
            <div className="menu-row">
              <span className="small">{t('lang.label')}</span>
              <LangToggle />
            </div>
          )}
          {offlineSession && (
            <p className="banner banner-info tiny">
              <Icon name="wifi-off" size={16} />
              {t('menu.savedSession')}
            </p>
          )}
          {confirming && (
            <div className="banner banner-warn small" role="alert">
              <Icon name="alert" size={18} />
              <span>{plural(t, pending, 'menu.unsyncedOne', 'menu.unsynced')}</span>
            </div>
          )}
          {confirming ? (
            <div className="row">
              <button type="button" className="btn btn-primary grow" onClick={() => void syncNow()}>
                <Icon name="refresh" size={16} />
                {t('menu.syncFirst')}
              </button>
              <button type="button" className="btn btn-danger grow" onClick={onSignOut}>
                {t('menu.signOutAnyway')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-block" onClick={onSignOut}>
              <Icon name="log-out" size={18} />
              {t('menu.signOut')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TopBar({ user, items }: { user: SessionUser; items: NavItem[] }) {
  const { t } = useT();
  const isOfficer = user.role === 'officer';
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to={homePath(user.role)} className="brand" aria-label={t('app.name')}>
          <BrandMark />
          <span className="brand-name">{t('app.name')}</span>
        </Link>
        <nav className="topnav" aria-label={t('nav.main')}>
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {t(item.label)}
              {item.badge ? <span className="nav-count num">{item.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          {isOfficer && <StatusPill />}
          <DemoClock />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}

function TabBar({ items }: { items: NavItem[] }) {
  const { t } = useT();
  return (
    <nav className="tabbar" aria-label={t('nav.main')}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end}>
          <span className="tab-icon">
            <Icon name={item.icon} size={22} />
            {item.badge ? <span className="tab-badge num">{item.badge > 99 ? '99+' : item.badge}</span> : null}
          </span>
          <span>{t(item.label)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Officer pages that already explain offline state in detail hide the generic strip. */
function hasOwnOfflineUi(path: string): boolean {
  return path === '/today' || path === '/sync' || path.startsWith('/loan/');
}

export function Shell() {
  const { user, offlineSession } = useAuth();
  const { t } = useT();
  const outbox = useOutbox();
  const online = useOnline();
  const location = useLocation();
  if (!user) return null;

  const items = navFor(user.role, user.role === 'officer' ? outbox.pending.length : 0);
  const showOffline = (!online || offlineSession) && !(user.role === 'officer' && hasOwnOfflineUi(location.pathname));

  return (
    <div className={`app app-${user.role === 'officer' ? 'officer' : 'manager'}`}>
      <a href="#main" className="skip-link">
        {t('app.skip')}
      </a>
      <TopBar user={user} items={items} />
      {showOffline && (
        <div className="offline-strip" role="status">
          <Icon name="wifi-off" size={16} />
          <span>{t('offline.strip')}</span>
        </div>
      )}
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <TabBar items={items} />
    </div>
  );
}
